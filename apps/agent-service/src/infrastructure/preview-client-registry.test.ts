import { describe, expect, it } from 'vitest';
import type { AgentWireMessage } from '@cloudcrane/agent-protocol';
import type { PreviewCapability, PreviewObservation } from '@cloudcrane/preview-protocol';
import { PreviewClientRegistry } from './preview-client-registry.js';

const websiteA = '00000000-0000-4000-8000-000000000001';
const websiteB = '00000000-0000-4000-8000-000000000002';
const clientA = '00000000-0000-4000-8000-000000000011';
const clientB = '00000000-0000-4000-8000-000000000012';
const context = (websiteId: string, previewClientId: string) => ({
  websiteId,
  websiteSessionId: '00000000-0000-4000-8000-000000000021',
  runId: '00000000-0000-4000-8000-000000000022',
  traceId: '00000000-0000-4000-8000-000000000023',
  previewClientId,
});
const capabilities: PreviewCapability[] = [
  'DOM_SNAPSHOT',
  'VISIBLE_TEXT',
  'CONSOLE',
  'WINDOW_ERRORS',
  'VIEWPORT',
  'CURRENT_URL',
];
const observation = {
  url: 'https://preview.example/',
  path: '/',
  title: 'Preview',
  viewport: { width: 100, height: 100, devicePixelRatio: 1 },
  scroll: { x: 0, y: 0 },
  dom: [],
  domTruncated: false,
  visibleText: '',
  consoleErrors: [],
  windowErrors: [],
  capturedAt: new Date().toISOString(),
} satisfies PreviewObservation;

describe('PreviewClientRegistry', () => {
  it('routes a request to the active client and validates the response', async () => {
    const registry = new PreviewClientRegistry({ observeMs: 100 });
    const sent: AgentWireMessage[] = [];
    const connection = { send: (message: AgentWireMessage) => sent.push(message) };
    registry.register(websiteA, clientA, capabilities, connection);
    const pending = registry.observe(context(websiteA, clientA));
    expect(sent[0]).toMatchObject({ type: 'preview.request', payload: { operation: 'observe' } });
    expect(
      registry.respond(
        websiteA,
        clientA,
        sent[0]!.requestId,
        { ok: true, observation },
        connection,
      ),
    ).toBe(true);
    await expect(pending).resolves.toEqual(observation);
  });

  it('replaces a reconnecting client and releases pending requests', async () => {
    const registry = new PreviewClientRegistry({ observeMs: 100 });
    const first = { send: () => undefined };
    const second = { send: () => undefined };
    registry.register(websiteA, clientA, capabilities, first);
    const pending = registry.observe(context(websiteA, clientA));
    registry.register(websiteA, clientA, capabilities, second);
    await expect(pending).rejects.toMatchObject({
      code: 'CLIENT_UNAVAILABLE',
    });
    expect(registry.getCapabilities(websiteA, clientA)).toEqual(capabilities);
  });

  it('does not select another website client and handles capability errors', async () => {
    const registry = new PreviewClientRegistry({ observeMs: 20 });
    const sentB: AgentWireMessage[] = [];
    registry.register(websiteB, clientB, capabilities, {
      send: (message) => sentB.push(message),
    });
    await expect(registry.observe(context(websiteA, clientA))).rejects.toMatchObject({
      code: 'CLIENT_UNAVAILABLE',
    });
    registry.register(websiteA, clientA, ['CURRENT_URL'], { send: () => undefined });
    await expect(registry.observe(context(websiteA, clientA))).rejects.toMatchObject({
      code: 'PREVIEW_CAPABILITY_UNAVAILABLE',
    });
    expect(sentB).toHaveLength(0);
  });

  it('times out and cleans the pending request', async () => {
    const registry = new PreviewClientRegistry({ observeMs: 10 });
    registry.register(websiteA, clientA, capabilities, { send: () => undefined });
    await expect(registry.observe(context(websiteA, clientA))).rejects.toMatchObject({
      code: 'CLIENT_PREVIEW_TIMEOUT',
    });
  });
});
