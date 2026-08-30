import os from 'node:os';
import { performance } from 'node:perf_hooks';
import Fastify from 'fastify';
import {
  runtimeInfoSchema,
  fsMkdirRequestSchema,
  fsPathSchema,
  fsReadRequestSchema,
  fsWriteRequestSchema,
  processCancelRequestSchema,
  processExecRequestSchema,
} from '@cloudcrane/workspace-protocol';
import { createLogger } from '@cloudcrane/shared';
import { FilesystemService } from './filesystem-service.js';
import { ProcessService } from './process-service.js';
import { toWorkspaceError, WorkspaceDaemonError } from './errors.js';
import { WorkspacePathResolver } from './workspace-path-resolver.js';

const logger = createLogger('workspace-daemon');
const resolver = new WorkspacePathResolver();
const filesystem = new FilesystemService(resolver);
const processes = new ProcessService(resolver);
const app = Fastify({ loggerInstance: logger });
const requestStarts = new WeakMap<object, number>();

app.addHook('onRequest', async (request) => {
  requestStarts.set(request, performance.now());
});
app.addHook('onResponse', async (request, reply) => {
  logger.info(
    {
      requestId: request.id,
      operation: `${request.method} ${request.url}`,
      durationMs: Math.round(performance.now() - (requestStarts.get(request) ?? performance.now())),
      status: reply.statusCode,
    },
    'workspace daemon request completed',
  );
});

app.setErrorHandler((error, request, reply) => {
  const normalized = toWorkspaceError(error);
  logger.error(
    {
      requestId: request.id,
      operation: request.method,
      status: normalized.code,
      errorCode: normalized.code,
      err: error,
    },
    'workspace daemon request failed',
  );
  void reply
    .code(
      normalized.code === 'FILE_CHANGED'
        ? 409
        : normalized.code === 'PROCESS_TIMEOUT'
          ? 408
          : normalized.code === 'PATH_OUT_OF_SCOPE'
            ? 403
            : normalized.code === 'FILE_NOT_FOUND'
              ? 404
              : 400,
    )
    .send({
      error: { code: normalized.code, message: normalized.message, details: normalized.details },
    });
});

app.get('/v1/health', async () => ({ service: 'workspace-daemon', status: 'ok' }));
app.get('/v1/runtime/info', async () =>
  runtimeInfoSchema.parse({
    service: 'workspace-daemon',
    version: '0.1.0',
    workspaceRoot: '/workspace',
    user: os.userInfo().username,
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    gid: typeof process.getgid === 'function' ? process.getgid() : 0,
    platform: process.platform,
    nodeVersion: process.version,
  }),
);
app.post('/v1/fs/read', async (request) =>
  filesystem.read(fsReadRequestSchema.parse(request.body)),
);
app.post('/v1/fs/write', async (request) =>
  filesystem.write(fsWriteRequestSchema.parse(request.body)),
);
app.post('/v1/fs/stat', async (request) => filesystem.stat(fsPathSchema.parse(request.body)));
app.post('/v1/fs/list', async (request) => filesystem.list(fsPathSchema.parse(request.body)));
app.post('/v1/fs/mkdir', async (request) =>
  filesystem.mkdir(fsMkdirRequestSchema.parse(request.body)),
);
app.post('/v1/process/exec', async (request) =>
  processes.exec(processExecRequestSchema.parse(request.body)),
);
app.post('/v1/process/cancel', async (request) =>
  processes.cancel(processCancelRequestSchema.parse(request.body).executionId),
);

const port = Number(process.env.WORKSPACE_DAEMON_PORT ?? 7070);
const close = async (signal: string) => {
  logger.info({ signal }, 'shutdown requested');
  await app.close();
  process.exit(0);
};
process.once('SIGINT', () => void close('SIGINT'));
process.once('SIGTERM', () => void close('SIGTERM'));
try {
  await app.listen({ host: process.env.WORKSPACE_DAEMON_HOST ?? '127.0.0.1', port });
  logger.info(
    { port, workspaceId: process.env.WORKSPACE_ID, operation: 'daemon.start', status: 'ok' },
    'workspace daemon listening',
  );
} catch (error) {
  logger.error(
    { error, operation: 'daemon.start', status: 'error' },
    'workspace daemon failed to start',
  );
  process.exit(1);
}

export { app, filesystem, processes, resolver, WorkspaceDaemonError };
