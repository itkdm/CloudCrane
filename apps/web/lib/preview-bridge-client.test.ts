import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_READY_TIMEOUT_MS, PreviewBridgeClient } from './preview-bridge-client';

const capabilities = [
  'DOM_SNAPSHOT',
  'VISIBLE_TEXT',
  'CONSOLE',
  'WINDOW_ERRORS',
  'VIEWPORT',
  'CURRENT_URL',
] as const;

function observation(url: string) {
  const parsed = new URL(url);
  return {
    url,
    path: `${parsed.pathname}${parsed.search}${parsed.hash}`,
    title: 'Preview',
    viewport: { width: 1280, height: 720, devicePixelRatio: 1 },
    scroll: { x: 0, y: 0 },
    dom: [],
    domTruncated: false,
    visibleText: '',
    consoleErrors: [],
    windowErrors: [],
    capturedAt: new Date().toISOString(),
  };
}

function setup() {
  const listeners = new Map<string, (event: MessageEvent<unknown>) => void>();
  const iframeWindow = { postMessage: vi.fn() };
  const iframe = {
    contentWindow: iframeWindow,
    src: 'https://preview.example/',
  } as unknown as HTMLIFrameElement;
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  });
  const emit = (source: object, data: unknown, origin = 'https://preview.example') =>
    listeners.get('message')?.({ source, origin, data } as MessageEvent<unknown>);
  return { iframe, iframeWindow, emit };
}

function ready(emit: ReturnType<typeof setup>['emit'], source: object, requestId = 'ready-1') {
  emit(source, {
    version: 'cloudcrane.preview.v1',
    type: 'bridge.ready',
    requestId,
    payload: { capabilities },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('PreviewBridgeClient lifecycle', () => {
  it('fails with a bounded timeout when Bridge READY never arrives', async () => {
    vi.useFakeTimers();
    const { iframe } = setup();
    const client = new PreviewBridgeClient(iframe, 'https://preview.example/');

    const pending = client.observe();
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'CLIENT_PREVIEW_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(PREVIEW_READY_TIMEOUT_MS);

    await assertion;
    client.dispose();
  });

  it('isolates stale READY messages and routes navigate input to the new generation', async () => {
    const { iframe, iframeWindow: oldWindow, emit } = setup();
    const client = new PreviewBridgeClient(iframe, 'https://preview.example/');
    const navigation = client.navigate('/about?from=agent');
    const newWindow = { postMessage: vi.fn() };
    (iframe as { contentWindow: object }).contentWindow = newWindow;

    ready(emit, oldWindow, 'bridge:0');
    expect(newWindow.postMessage).not.toHaveBeenCalled();
    ready(emit, newWindow, 'bridge:0');
    expect(newWindow.postMessage).not.toHaveBeenCalled();
    ready(emit, newWindow);
    await Promise.resolve();
    await Promise.resolve();
    expect(newWindow.postMessage).toHaveBeenCalledTimes(1);
    const request = newWindow.postMessage.mock.calls[0]?.[0] as { requestId: string };
    emit(newWindow, {
      version: 'cloudcrane.preview.v1',
      type: 'bridge.observe.response',
      requestId: request.requestId,
      payload: { observation: observation('https://preview.example/about?from=agent') },
    });

    await expect(navigation).resolves.toMatchObject({ path: '/about?from=agent' });
    expect(iframe.src).toBe('https://preview.example/about?from=agent');
    client.dispose();
  });

  it('refreshes the observed current URL instead of reverting to the initial URL', async () => {
    const { iframe, iframeWindow, emit } = setup();
    const client = new PreviewBridgeClient(iframe, 'https://preview.example/');
    ready(emit, iframeWindow);

    const firstObserve = client.observe();
    await Promise.resolve();
    await Promise.resolve();
    const firstRequest = iframeWindow.postMessage.mock.calls[0]?.[0] as { requestId: string };
    emit(iframeWindow, {
      version: 'cloudcrane.preview.v1',
      type: 'bridge.observe.response',
      requestId: firstRequest.requestId,
      payload: { observation: observation('https://preview.example/about') },
    });
    await firstObserve;

    const refresh = client.refresh();
    await Promise.resolve();
    await Promise.resolve();
    const currentRequest = iframeWindow.postMessage.mock.calls[1]?.[0] as { requestId: string };
    emit(iframeWindow, {
      version: 'cloudcrane.preview.v1',
      type: 'bridge.observe.response',
      requestId: currentRequest.requestId,
      payload: { observation: observation('https://preview.example/about') },
    });
    await Promise.resolve();
    await Promise.resolve();
    const refreshedWindow = { postMessage: vi.fn() };
    (iframe as { contentWindow: object }).contentWindow = refreshedWindow;
    ready(emit, refreshedWindow);
    await Promise.resolve();
    await Promise.resolve();
    const refreshedRequest = refreshedWindow.postMessage.mock.calls[0]?.[0] as {
      requestId: string;
    };
    emit(refreshedWindow, {
      version: 'cloudcrane.preview.v1',
      type: 'bridge.observe.response',
      requestId: refreshedRequest.requestId,
      payload: { observation: observation('https://preview.example/about') },
    });

    await expect(refresh).resolves.toMatchObject({ path: '/about' });
    expect(iframe.src).toBe('https://preview.example/about');
    client.dispose();
  });
});
