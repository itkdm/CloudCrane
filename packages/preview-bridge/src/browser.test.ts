import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

async function runBridge() {
  const script = await readFile(path.join(process.cwd(), 'dist', 'browser.js'), 'utf8');
  const messages: unknown[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const parent = { postMessage: (message: unknown) => messages.push(message) };
  const windowValue = {
    parent,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 12,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
  };
  class FakeScript {}
  const currentScript = Object.assign(new FakeScript(), {
    dataset: { cloudcraneParentOrigin: 'http://localhost:3000' },
  });
  const context = {
    window: windowValue,
    document: { currentScript, body: null, title: 'CloudCrane Preview' },
    HTMLScriptElement: FakeScript,
    URL,
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 },
    console: { error: () => undefined, warn: () => undefined },
    location: { href: 'http://site.example/', pathname: '/', search: '', hash: '' },
    Date,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(script, context);
  return { messages, listeners, parent, windowValue };
}

describe('Preview Bridge browser boundary', () => {
  it('announces bounded capabilities and rejects wrong source or parent origin', async () => {
    const bridge = await runBridge();
    expect(bridge.messages[0]).toMatchObject({
      version: 'cloudcrane.preview.v1',
      type: 'bridge.ready',
      payload: {
        capabilities: expect.arrayContaining(['DOM_SNAPSHOT', 'VISIBLE_TEXT', 'CONSOLE']),
      },
    });
    const before = bridge.messages.length;
    bridge.listeners.get('message')?.({
      source: {},
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.observe.request',
        requestId: 'wrong-source',
      },
    });
    bridge.listeners.get('message')?.({
      source: bridge.windowValue.parent,
      origin: 'http://evil.example',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.observe.request',
        requestId: 'wrong-origin',
      },
    });
    expect(bridge.messages).toHaveLength(before);
  });

  it('correlates observe requests and returns bounded typed state without screenshot claims', async () => {
    const bridge = await runBridge();
    bridge.listeners.get('message')?.({
      source: bridge.windowValue.parent,
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.observe.request',
        requestId: 'observe-1',
      },
    });
    expect(bridge.messages.at(-1)).toMatchObject({
      type: 'bridge.observe.response',
      requestId: 'observe-1',
      payload: {
        observation: {
          title: 'CloudCrane Preview',
          visibleText: '',
          dom: [],
          domTruncated: false,
          scroll: { y: 12 },
        },
      },
    });
    expect(JSON.stringify(bridge.messages.at(-1))).not.toContain('SCREENSHOT');
  });
});
