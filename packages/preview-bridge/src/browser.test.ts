import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type FakeText = { nodeType: number; textContent: string; parentElement: FakeElement };

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly childNodes: Array<FakeElement | FakeText> = [];
  parentElement: FakeElement | null = null;
  constructor(
    readonly tagName: string,
    private readonly attributes: Record<string, string> = {},
    private readonly style: { display?: string; visibility?: string } = {},
  ) {}

  append(...children: Array<FakeElement | string>): this {
    for (const child of children) {
      if (typeof child === 'string') {
        const text: FakeText = { nodeType: 3, textContent: child, parentElement: this };
        this.childNodes.push(text);
      } else {
        child.parentElement = this;
        this.children.push(child);
        this.childNodes.push(child);
      }
    }
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  getStyle(): { display?: string; visibility?: string } {
    return this.style;
  }
}

function textNodes(root: FakeElement): FakeText[] {
  return root.childNodes.flatMap((child) => ('nodeType' in child ? [child] : textNodes(child)));
}

async function runBridge(body: FakeElement | null = null) {
  const script = await readFile(path.join(process.cwd(), 'dist', 'browser.js'), 'utf8');
  const messages: unknown[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const targetOrigins: unknown[] = [];
  const parent = {
    postMessage: (message: unknown, targetOrigin: unknown) => {
      messages.push(message);
      targetOrigins.push(targetOrigin);
    },
  };
  const consoleValue = {
    error: (...args: unknown[]) => {
      void args;
      return undefined;
    },
    warn: (...args: unknown[]) => {
      void args;
      return undefined;
    },
  };
  const windowValue = {
    parent,
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    scrollX: 0,
    scrollY: 12,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    getComputedStyle: (element: FakeElement) => ({
      display: element.getStyle().display ?? 'block',
      visibility: element.getStyle().visibility ?? 'visible',
    }),
  };
  class FakeScript {}
  const currentScript = Object.assign(new FakeScript(), {
    dataset: { cloudcraneParentOrigin: 'http://localhost:3000' },
  });
  const context = {
    window: windowValue,
    document: {
      currentScript,
      body,
      title: 'CloudCrane Preview',
      createTreeWalker: () => {
        const nodes = body ? textNodes(body) : [];
        let index = -1;
        return { nextNode: () => nodes[++index] ?? null };
      },
    },
    HTMLScriptElement: FakeScript,
    URL,
    Node: { TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 },
    console: consoleValue,
    location: { href: 'http://site.example/', pathname: '/', search: '', hash: '' },
    Date,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(script, context);
  return { messages, listeners, parent, targetOrigins, windowValue, consoleValue };
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
    bridge.listeners.get('message')?.({
      source: {},
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.connect.request',
        requestId: 'wrong-connect-source',
        payload: {},
      },
    });
    bridge.listeners.get('message')?.({
      source: bridge.windowValue.parent,
      origin: 'http://evil.example',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.connect.request',
        requestId: 'wrong-connect-origin',
        payload: {},
      },
    });
    expect(bridge.messages).toHaveLength(before);

    bridge.listeners.get('message')?.({
      source: bridge.windowValue.parent,
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.connect.request',
        requestId: 'connect-1',
        payload: {},
      },
    });
    expect(bridge.messages.at(-1)).toMatchObject({
      type: 'bridge.ready',
      requestId: 'connect-1',
    });
    expect(bridge.targetOrigins.every((origin) => origin === 'http://localhost:3000')).toBe(true);

    const duplicateBefore = bridge.messages.length;
    bridge.listeners.get('message')?.({
      source: bridge.windowValue.parent,
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.connect.request',
        requestId: 'connect-1',
        payload: {},
      },
    });
    expect(bridge.messages).toHaveLength(duplicateBefore + 1);
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

  it('preserves wrapper siblings, filters hidden ancestors and sensitive input values', async () => {
    const body = new FakeElement('BODY').append(
      new FakeElement('DIV').append(
        new FakeElement('H1').append('Title'),
        new FakeElement('P').append('Description'),
        new FakeElement('DIV', { hidden: '' }).append(
          new FakeElement('SPAN').append('secret hidden text'),
        ),
        new FakeElement('DIV', { 'aria-hidden': 'true' }).append(
          new FakeElement('P').append('aria hidden text'),
        ),
        new FakeElement('P').append('Visible sibling'),
        new FakeElement('INPUT', { type: 'password', value: 'super-secret' }),
        new FakeElement('A', { href: 'https://user:password@example.com/path?token=abc' }).append(
          'Link',
        ),
      ),
    );
    const bridge = await runBridge(body);
    bridge.listeners.get('message')?.({
      source: bridge.windowValue.parent,
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.observe.request',
        requestId: 'dom-1',
      },
    });
    const response = bridge.messages.at(-1) as {
      payload: { observation: { dom: unknown[]; visibleText: string } };
    };
    const serialized = JSON.stringify(response);
    expect(response.payload.observation.dom.map((node) => (node as { tag: string }).tag)).toEqual([
      'h1',
      'p',
      'p',
      'input',
      'a',
    ]);
    expect(response.payload.observation.visibleText).toContain('Visible sibling');
    expect(response.payload.observation.visibleText).not.toContain('hidden text');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('user:password');
    expect(serialized).not.toContain('abc');
  });

  it('bounds and redacts console and unhandled rejection entries', async () => {
    const bridge = await runBridge();
    for (let index = 0; index < 45; index += 1)
      bridge.consoleValue.error({ apiKey: `secret-${index}`, authorization: 'Bearer abc123' });
    bridge.listeners.get('unhandledrejection')?.({ reason: { password: 'reject-secret' } });
    bridge.listeners.get('message')?.({
      source: bridge.windowValue.parent,
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.observe.request',
        requestId: 'console-1',
      },
    });
    const response = bridge.messages.at(-1) as {
      payload: { observation: { consoleErrors: unknown[]; windowErrors: unknown[] } };
    };
    const serialized = JSON.stringify(response);
    expect(response.payload.observation.consoleErrors).toHaveLength(40);
    expect(response.payload.observation.windowErrors).toHaveLength(1);
    expect(serialized).not.toContain('secret-44');
    expect(serialized).not.toContain('abc123');
    expect(serialized).not.toContain('reject-secret');
    expect(serialized).toContain('[redacted]');
  });

  it('keeps DOM node, depth and character limits global after flattening wrappers', async () => {
    const manyNodes = new FakeElement('BODY').append(
      new FakeElement('DIV').append(
        ...Array.from({ length: 301 }, (_, index) => new FakeElement('P').append(String(index))),
      ),
    );
    const nodeBridge = await runBridge(manyNodes);
    nodeBridge.listeners.get('message')?.({
      source: nodeBridge.windowValue.parent,
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.observe.request',
        requestId: 'nodes-1',
      },
    });
    const nodeObservation = (
      nodeBridge.messages.at(-1) as {
        payload: { observation: { dom: unknown[]; domTruncated: boolean } };
      }
    ).payload.observation;
    expect(nodeObservation.dom).toHaveLength(300);
    expect(nodeObservation.domTruncated).toBe(true);

    let deep = new FakeElement('H1').append('Too deep');
    for (let index = 0; index < 10; index += 1) deep = new FakeElement('DIV').append(deep);
    const depthBridge = await runBridge(new FakeElement('BODY').append(deep));
    depthBridge.listeners.get('message')?.({
      source: depthBridge.windowValue.parent,
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.observe.request',
        requestId: 'depth-1',
      },
    });
    expect(
      (depthBridge.messages.at(-1) as { payload: { observation: { domTruncated: boolean } } })
        .payload.observation.domTruncated,
    ).toBe(true);

    const charsBridge = await runBridge(
      new FakeElement('BODY').append(
        new FakeElement('DIV').append(
          ...Array.from({ length: 100 }, () => new FakeElement('P').append('x'.repeat(512))),
        ),
      ),
    );
    charsBridge.listeners.get('message')?.({
      source: charsBridge.windowValue.parent,
      origin: 'http://localhost:3000',
      data: {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.observe.request',
        requestId: 'chars-1',
      },
    });
    expect(
      (charsBridge.messages.at(-1) as { payload: { observation: { domTruncated: boolean } } })
        .payload.observation.domTruncated,
    ).toBe(true);
  });
});
