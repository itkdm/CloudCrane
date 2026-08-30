import { describe, expect, it } from 'vitest';
import { envelopeSchema, processExecRequestSchema, workspaceErrorCodeSchema } from './index.js';
import { remoteErrorSchema } from './errors.js';
import { clientOperationSchema } from './remote.js';
import {
  runnerAcceptedSchema,
  runnerCompletedSchema,
  runnerErrorSchema,
  runnerHeartbeatSchema,
  runnerRegisterSchema,
  runnerRegisteredSchema,
  runnerOperationSchema,
} from './runner/messages.js';
import { isMutationOperation, workspaceOperationSchema } from './workspace/operations.js';

describe('workspace envelope', () => {
  it('accepts the shared envelope fields', () => {
    const result = envelopeSchema.parse({
      type: 'health.check',
      requestId: 'req-1',
      websiteId: 'site-1',
      timestamp: '2026-08-30T00:00:00.000Z',
      payload: { ok: true },
    });

    expect(result.type).toBe('health.check');
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('rejects an envelope without a website id', () => {
    expect(() =>
      envelopeSchema.parse({
        type: 'health.check',
        requestId: 'req-1',
        timestamp: new Date(),
        payload: null,
      }),
    ).toThrow();
  });

  it('validates runtime contracts and standard errors', () => {
    expect(workspaceErrorCodeSchema.parse('FILE_CHANGED')).toBe('FILE_CHANGED');
    expect(
      processExecRequestSchema.parse({
        command: 'php',
        executionId: '00000000-0000-4000-8000-000000000000',
      }),
    ).toMatchObject({ cwd: '/workspace', timeoutMs: 120000 });
  });

  it('validates runner registration and heartbeat contracts', () => {
    const runnerId = '00000000-0000-4000-8000-000000000001';
    expect(
      runnerRegisterSchema.parse({
        type: 'runner.register',
        runnerId,
        name: 'runner-local',
        version: '0.1.0',
        capabilities: ['runtime.create', 'fs.read'],
      }),
    ).toMatchObject({ runnerId });
    expect(
      runnerRegisteredSchema.parse({
        type: 'runner.registered',
        runnerId,
        heartbeatIntervalMs: 10_000,
        serverTime: new Date().toISOString(),
      }).serverTime,
    ).toBeInstanceOf(Date);
    expect(
      runnerHeartbeatSchema.parse({
        type: 'runner.heartbeat',
        runnerId,
        timestamp: new Date().toISOString(),
      }),
    ).toMatchObject({ runnerId });
  });

  it('validates operation envelopes and central mutation classification', () => {
    const operation = {
      type: 'workspace.operation' as const,
      operation: 'fs.write' as const,
      requestId: '00000000-0000-4000-8000-000000000010',
      traceId: '00000000-0000-4000-8000-000000000011',
      websiteId: '00000000-0000-4000-8000-000000000012',
      workspaceId: '00000000-0000-4000-8000-000000000013',
      deadlineMs: 30_000,
      idempotencyKey: 'write-1',
      payload: { path: 'index.php', content: '<?php echo 1;' },
    };
    expect(
      workspaceOperationSchema.parse({
        operation: operation.operation,
        payload: operation.payload,
      }),
    ).toEqual({
      operation: 'fs.write',
      payload: operation.payload,
    });
    expect(clientOperationSchema.parse(operation)).toMatchObject({ operation: 'fs.write' });
    expect(runnerOperationSchema.parse(operation)).toMatchObject({
      requestId: operation.requestId,
    });
    expect(isMutationOperation('fs.write')).toBe(true);
    expect(isMutationOperation('fs.read')).toBe(false);
  });

  it('validates completed, failed, and unknown outcomes', () => {
    const base = {
      requestId: '00000000-0000-4000-8000-000000000020',
      traceId: '00000000-0000-4000-8000-000000000021',
    };
    expect(runnerAcceptedSchema.parse({ type: 'runner.accepted', ...base })).toMatchObject(base);
    expect(
      runnerCompletedSchema.parse({
        type: 'runner.completed',
        ...base,
        result: null,
        durationMs: 1,
      }),
    ).toMatchObject({ durationMs: 1 });
    expect(
      runnerErrorSchema.parse({
        type: 'runner.error',
        ...base,
        error: { code: 'UNKNOWN_RESULT', message: 'connection lost' },
        durationMs: 2,
        outcome: 'UNKNOWN',
      }),
    ).toMatchObject({ outcome: 'UNKNOWN' });
    expect(() => remoteErrorSchema.parse({ code: 'NOPE', message: 'bad' })).toThrow();
  });
});
