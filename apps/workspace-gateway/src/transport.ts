import { runnerHeartbeatSchema, runnerRegisterSchema } from '@cloudcrane/workspace-protocol';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import { RunnerRegistry } from './infrastructure/runner-registry.js';
import type { ControlPlaneStore } from './ports/control-plane-store.js';
import type { GatewayConfig } from './config.js';

export function attachRunnerTransport(
  app: FastifyInstance,
  config: GatewayConfig,
  registry: RunnerRegistry,
  store: ControlPlaneStore,
) {
  const server = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
  app.server.on('upgrade', (request, socket, head) => {
    if (new URL(request.url ?? '/', 'http://gateway').pathname !== '/v1/runners/connect') return;
    if (request.headers.authorization !== `Bearer ${config.runnerToken}`) {
      socket.destroy();
      return;
    }
    server.handleUpgrade(request, socket, head, (ws) => server.emit('connection', ws, request));
  });
  server.on('connection', (socket: WebSocket) => {
    let runnerId: string | undefined;
    socket.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as { type?: string };
        if (data.type === 'runner.register') {
          const register = runnerRegisterSchema.parse(data);
          const previous = registry.register(register, socket);
          if (previous?.socket !== socket && previous?.socket.readyState === 1)
            previous.socket.close(4001, 'replaced');
          runnerId = register.runnerId;
          await store.registerRunner(register);
          socket.send(
            JSON.stringify({
              type: 'runner.registered',
              runnerId,
              heartbeatIntervalMs: config.heartbeatIntervalMs,
              serverTime: new Date().toISOString(),
            }),
          );
        } else if (data.type === 'runner.heartbeat') {
          const heartbeat = runnerHeartbeatSchema.parse(data);
          if (heartbeat.runnerId !== runnerId) return;
          registry.heartbeat(heartbeat.runnerId, heartbeat.timestamp);
          await store.heartbeatRunner(heartbeat.runnerId, heartbeat.timestamp);
        }
      } catch {
        socket.close(4002, 'invalid protocol message');
      }
    });
    socket.on('close', () => {
      if (runnerId) {
        const wasCurrent = registry.unregister(runnerId, socket);
        if (wasCurrent) void store.setRunnerStatus(runnerId, 'offline');
      }
    });
  });
  const monitor = setInterval(() => {
    for (const runnerId of registry.staleBefore(new Date(Date.now() - config.offlineTimeoutMs))) {
      const runner = registry.get(runnerId);
      runner?.socket.close(4003, 'heartbeat timeout');
    }
  }, config.heartbeatIntervalMs);
  app.addHook('onClose', async () => {
    clearInterval(monitor);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return server;
}
