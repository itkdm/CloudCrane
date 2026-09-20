import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  createLogger,
  createSpanId,
  createTraceId,
  getLogContext,
  loadObservabilityConfig,
  parseBooleanEnv,
  parseTraceparent,
  runWithLogContext,
  sanitizeSpanAttributes,
  sanitizeRequestPath,
  sanitizeText,
  serializeError,
  withSpan,
} from './index.js';

describe('observability foundation', () => {
  it('parses deployment metadata and safe defaults from environment', () => {
    const config = loadObservabilityConfig('test-service', {
      NODE_ENV: 'production',
      CLOUDCRANE_VERSION: '2026.09.20',
      CLOUDCRANE_COMMIT_SHA: 'abc123',
      LOG_LEVEL: 'invalid-level',
    });
    expect(config).toMatchObject({
      service: 'test-service',
      environment: 'production',
      version: '2026.09.20',
      commitSha: 'abc123',
      level: 'info',
    });
    expect(parseBooleanEnv('yes')).toBe(true);
    expect(parseBooleanEnv('off')).toBe(false);
  });

  it('keeps legacy business trace IDs separate from OTel trace IDs', () => {
    const legacyRunId = '00000000-0000-4000-8000-000000000001';
    const traceId = createTraceId();
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(traceId).not.toBe(legacyRunId);
    expect(createSpanId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('parses valid W3C traceparent values, including unsampled flags', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01')).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
    });
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00')).toEqual({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentSpanId: '00f067aa0ba902b7',
    });
    expect(parseTraceparent('not-a-traceparent')).toBeUndefined();
  });

  it('isolates async contexts', async () => {
    const seen: string[] = [];
    await Promise.all([
      Promise.resolve().then(() =>
        runWithLogContext({ requestId: 'a' }, () => seen.push(getLogContext().requestId!)),
      ),
      Promise.resolve().then(() =>
        runWithLogContext({ requestId: 'b' }, () => seen.push(getLogContext().requestId!)),
      ),
    ]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('redacts secrets and bounds error metadata', () => {
    expect(
      sanitizeText('Authorization: Bearer abc123 password=topsecret https://example.test/x'),
    ).toBe('Authorization=[REDACTED] [REDACTED] password=[REDACTED] [URL]');
    expect(serializeError(new Error('token: abc123'))).toMatchObject({
      message: 'token=[REDACTED]',
    });
  });

  it('creates a JSON logger with service metadata', () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createLogger('test-observability', { environment: 'test', stream });
    expect(logger.level).toBe('info');
    logger.info({ event: 'test.metadata' }, 'metadata event');
    expect(JSON.parse(output)).toMatchObject({
      service: 'test-observability',
      environment: 'test',
      event: 'test.metadata',
    });
  });

  it('redacts sensitive structured fields in emitted JSON', () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createLogger('test-redaction', { environment: 'test', stream });
    logger.info(
      {
        authorization: 'SUPER_SECRET_TEST_VALUE',
        cookie: 'SUPER_SECRET_TEST_VALUE',
        password: 'SUPER_SECRET_TEST_VALUE',
        token: 'SUPER_SECRET_TEST_VALUE',
        secret: 'SUPER_SECRET_TEST_VALUE',
        apiKey: 'SUPER_SECRET_TEST_VALUE',
        prompt: 'SUPER_SECRET_TEST_VALUE',
        response: 'SUPER_SECRET_TEST_VALUE',
        toolInput: 'SUPER_SECRET_TEST_VALUE',
        toolOutput: 'SUPER_SECRET_TEST_VALUE',
        command: 'SUPER_SECRET_TEST_VALUE',
        stdout: 'SUPER_SECRET_TEST_VALUE',
        stderr: 'SUPER_SECRET_TEST_VALUE',
        environment: { SECRET: 'SUPER_SECRET_TEST_VALUE' },
        req: {
          headers: { authorization: 'SUPER_SECRET_TEST_VALUE', cookie: 'SUPER_SECRET_TEST_VALUE' },
        },
        safeBytes: 12,
        tool_name: 'workspace.read',
        tool_call_id: 'call-123',
      },
      'safe event',
    );
    expect(output).not.toContain('SUPER_SECRET_TEST_VALUE');
    expect(output).toContain('safeBytes');
    expect(output).toContain('workspace.read');
    expect(output).toContain('call-123');
  });

  it('creates and closes a no-op span when no exporter is configured', async () => {
    await withSpan('test.operation', { secret: 'SUPER_SECRET_TEST_VALUE' }, async (span) => {
      expect(span.isRecording()).toBe(false);
    });
  });

  it('does not export sensitive span attributes', () => {
    expect(
      sanitizeSpanAttributes({
        operation: 'workspace.read',
        prompt: 'SUPER_SECRET_TEST_VALUE',
        command: 'cat secret.txt',
        token: 'SUPER_SECRET_TEST_VALUE',
        tool_name: 'workspace.read',
        tool_call_id: 'call-123',
        tool_input: 'SUPER_SECRET_TEST_VALUE',
        stdout: 'SUPER_SECRET_TEST_VALUE',
        safeBytes: 12,
      }),
    ).toEqual({
      operation: 'workspace.read',
      tool_name: 'workspace.read',
      tool_call_id: 'call-123',
      safeBytes: 12,
    });
  });

  it('removes query strings from request paths', () => {
    expect(sanitizeRequestPath('/preview?token=SUPER_SECRET_TEST_VALUE')).toBe('/preview');
  });
});
