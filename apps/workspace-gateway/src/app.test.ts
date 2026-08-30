import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildGatewayApp } from './app.js';
import type { GatewayConfig } from './config.js';
import type { ControlPlaneStore } from './ports/control-plane-store.js';

const config: GatewayConfig = {
  port: 0,
  clientToken: 'client',
  runnerToken: 'runner',
  heartbeatIntervalMs: 10_000,
  requestTimeoutMs: 120_000,
  offlineTimeoutMs: 30_000,
};
const store: ControlPlaneStore = {
  findWorkspace: async () => null,
  registerRunner: async () => undefined,
  heartbeatRunner: async () => undefined,
  setRunnerStatus: async () => undefined,
  findAvailableRunner: async () => null,
  updateWorkspace: async () => undefined,
};

describe('workspace gateway app', () => {
  it('exposes a health endpoint and protects operation HTTP with the client token', async () => {
    const app = buildGatewayApp(config, store);
    await expect(app.inject({ method: 'GET', url: '/health' })).resolves.toMatchObject({
      statusCode: 200,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/workspaces/00000000-0000-4000-8000-000000000001/operations',
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('keeps client and runner credentials separate', async () => {
    const app = buildGatewayApp(config, store);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (!address || typeof address === 'string')
      throw new Error('gateway did not expose a TCP address');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const controlPlaneResponse = await fetch(
      `${baseUrl}/v1/workspaces/00000000-0000-4000-8000-000000000001/operations`,
      { method: 'POST', headers: { authorization: 'Bearer runner' }, body: '{}' },
    );
    expect(controlPlaneResponse.status).toBe(401);
    const rejected = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/v1/runners/connect`, {
        headers: { authorization: 'Bearer client' },
      });
      let opened = false;
      socket.once('open', () => {
        opened = true;
        socket.close();
      });
      socket.once('error', () => resolve(!opened));
      socket.once('close', () => resolve(!opened));
    });
    expect(rejected).toBe(true);
    await app.close();
  });
});
