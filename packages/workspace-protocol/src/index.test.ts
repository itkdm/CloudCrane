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
  isRunnerMutationOperation,
} from './runner/messages.js';
import { isMutationOperation, workspaceOperationSchema } from './workspace/operations.js';
import {
  isProductionMutationOperation,
  productionOperationSchema,
} from './production/operations.js';
import {
  productionClientOperationSchema,
  productionRunnerOperationSchema,
} from './production/remote.js';

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

  it('treats Production content refresh as a typed mutation', () => {
    const refresh = productionOperationSchema.parse({
      operation: 'production.refresh',
      payload: {
        productionSlug: 'production-website',
        refreshId: '00000000-0000-4000-8000-000000000001',
      },
    });
    expect(refresh.operation).toBe('production.refresh');
    expect(isProductionMutationOperation(refresh.operation)).toBe(true);
  });

  it('requires a durable idempotency key for Production CMS content creation', () => {
    const operation = {
      operation: 'cms.content.create' as const,
      requestId: '00000000-0000-4000-8000-000000000021',
      traceId: '00000000-0000-4000-8000-000000000022',
      websiteId: '00000000-0000-4000-8000-000000000023',
      workspaceId: '00000000-0000-4000-8000-000000000024',
      deadlineMs: 120_000,
      payload: { categoryCode: 'news01', title: 'New article' },
    };
    expect(productionClientOperationSchema.safeParse(operation).success).toBe(false);
    const withKey = { ...operation, idempotencyKey: 'cms-create-operation-1' };
    expect(productionClientOperationSchema.parse(withKey).idempotencyKey).toBe(
      'cms-create-operation-1',
    );
    expect(
      productionRunnerOperationSchema.safeParse({
        ...withKey,
        type: 'production.operation',
      }).success,
    ).toBe(true);
  });

  it('requires a durable idempotency key for Production CMS media upload', () => {
    const operation = {
      operation: 'cms.media.upload' as const,
      requestId: '00000000-0000-4000-8000-000000000025',
      traceId: '00000000-0000-4000-8000-000000000026',
      websiteId: '00000000-0000-4000-8000-000000000027',
      workspaceId: '00000000-0000-4000-8000-000000000028',
      deadlineMs: 120_000,
      payload: {
        attachmentId: '00000000-0000-4000-8000-000000000029',
        mimeType: 'image/png',
        contentSha256: 'a'.repeat(64),
        contentBase64: 'aGVsbG8=',
      },
    };
    expect(productionClientOperationSchema.safeParse(operation).success).toBe(false);
    expect(
      productionClientOperationSchema.safeParse({ ...operation, idempotencyKey: 'media-key-1' })
        .success,
    ).toBe(true);
  });

  it('requires a durable idempotency key for Production CMS category creation', () => {
    const operation = {
      operation: 'cms.category.create' as const,
      requestId: '00000000-0000-4000-8000-000000000031',
      traceId: '00000000-0000-4000-8000-000000000032',
      websiteId: '00000000-0000-4000-8000-000000000033',
      workspaceId: '00000000-0000-4000-8000-000000000034',
      deadlineMs: 120_000,
      payload: { parentCode: 'news01', name: 'Industry News' },
    };
    expect(productionClientOperationSchema.safeParse(operation).success).toBe(false);
    const withKey = { ...operation, idempotencyKey: 'cms-category-operation-1' };
    expect(productionClientOperationSchema.parse(withKey).idempotencyKey).toBe(
      'cms-category-operation-1',
    );
    expect(
      productionRunnerOperationSchema.safeParse({
        ...withKey,
        type: 'production.operation',
      }).success,
    ).toBe(true);
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

  it('validates production operation contracts separately from workspace operations', () => {
    const common = {
      requestId: '00000000-0000-4000-8000-000000000020',
      traceId: '00000000-0000-4000-8000-000000000021',
      websiteId: '00000000-0000-4000-8000-000000000022',
      workspaceId: '00000000-0000-4000-8000-000000000023',
      deadlineMs: 120_000,
      idempotencyKey: 'publish-1',
    };
    const operation = {
      operation: 'production.deploy' as const,
      payload: {
        releaseId: '00000000-0000-4000-8000-000000000024',
        productionSlug: 'production-website',
        sequence: 1,
        artifactStorageKey: 'release-00000000-0000-4000-8000-000000000024.zip',
        artifactSha256: 'a'.repeat(64),
        artifactSize: 1024,
        firstPublish: false,
      },
    };
    expect(productionOperationSchema.parse(operation)).toEqual(operation);
    expect(isProductionMutationOperation('production.deploy')).toBe(true);
    expect(isProductionMutationOperation('production.status')).toBe(false);
    expect(() =>
      productionOperationSchema.parse({
        ...operation,
        payload: { ...operation.payload, artifactStorageKey: '../outside.zip' },
      }),
    ).toThrow();
    const runnerOperation = { type: 'production.operation' as const, ...common, ...operation };
    const parsedRunnerOperation = runnerOperationSchema.parse(runnerOperation);
    expect(parsedRunnerOperation).toMatchObject({ type: 'production.operation' });
    expect(isRunnerMutationOperation(parsedRunnerOperation)).toBe(true);
    expect(common.websiteId).not.toBe(common.workspaceId);
  });
});
