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
    addEventListener: (type: string, listener: () => void) =>
      listeners.set(type, listener as never),
    removeEventListener: (type: string) => listeners.delete(type),
  } as unknown as HTMLIFrameElement;
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (event: MessageEvent<unknown>) => void) =>
      listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  });
  const emit = (source: object, data: unknown, origin = 'https://preview.example') =>
    listeners.get('message')?.({ source, origin, data } as MessageEvent<unknown>);
  const load = () => listeners.get('load')?.({} as never);
  return { iframe, iframeWindow, emit, load };
}

function ready(emit: ReturnType<typeof setup>['emit'], source: object, requestId: string) {
  emit(source, {
    version: 'cloudcrane.preview.v1',
    type: 'bridge.ready',
    requestId,
    payload: { capabilities },
  });
}

function latestRequest(
  iframeWindow: { postMessage: ReturnType<typeof vi.fn> },
  type: string,
): { type: string; requestId: string } {
  const request = [...iframeWindow.postMessage.mock.calls]
    .reverse()
    .map((call) => call[0] as { type?: string; requestId?: string })
    .find((message) => message.type === type);
  if (!request?.requestId) throw new Error(`${type} was not posted`);
  return { type, requestId: request.requestId };
}

async function resolveObserve(
  client: PreviewBridgeClient,
  iframeWindow: { postMessage: ReturnType<typeof vi.fn> },
  emit: ReturnType<typeof setup>['emit'],
) {
  const pending = client.observe();
  await Promise.resolve();
  await Promise.resolve();
  const request = latestRequest(iframeWindow, 'bridge.observe.request');
  emit(iframeWindow, {
    version: 'cloudcrane.preview.v1',
    type: 'bridge.observe.response',
    requestId: request.requestId,
    payload: { observation: observation('https://preview.example/') },
  });
  return pending;
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
    const { iframe, iframeWindow: oldWindow, emit, load } = setup();
    const client = new PreviewBridgeClient(iframe, 'https://preview.example/');
    const initialConnect = oldWindow.postMessage.mock.calls[0]?.[0] as { requestId: string };
    ready(emit, oldWindow, initialConnect.requestId);
    const navigation = client.navigate('/about?from=agent');
    await Promise.resolve();
    await Promise.resolve();
    const newWindow = { postMessage: vi.fn() };
    (iframe as { contentWindow: object }).contentWindow = newWindow;

    ready(emit, oldWindow, 'bridge:0');
    expect(newWindow.postMessage).not.toHaveBeenCalled();
    ready(emit, newWindow, 'bridge:0');
    expect(newWindow.postMessage).not.toHaveBeenCalled();
    load();
    const connect = newWindow.postMessage.mock.calls.at(-1)?.[0] as { requestId: string };
    ready(emit, newWindow, connect.requestId);
    await Promise.resolve();
    await Promise.resolve();
    const request = latestRequest(newWindow, 'bridge.observe.request');
    emit(newWindow, {
      version: 'cloudcrane.preview.v1',
      type: 'bridge.observe.response',
      requestId: request.requestId,
      payload: { observation: observation('https://preview.example/about?from=agent') },
    });

    await expect(navigation).resolves.toMatchObject({ path: '/about?from=agent' });
    expect(oldWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'bridge.navigate.request',
        payload: { path: '/about?from=agent' },
      }),
      'https://preview.example',
    );
    client.dispose();
  });

  it('refreshes the observed current URL instead of reverting to the initial URL', async () => {
    const { iframe, iframeWindow, emit, load } = setup();
    const client = new PreviewBridgeClient(iframe, 'https://preview.example/');
    const initialConnect = iframeWindow.postMessage.mock.calls[0]?.[0] as { requestId: string };
    ready(emit, iframeWindow, initialConnect.requestId);

    const firstObserve = client.observe();
    await Promise.resolve();
    await Promise.resolve();
    const firstRequest = latestRequest(iframeWindow, 'bridge.observe.request');
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
    const refreshRequest = latestRequest(iframeWindow, 'bridge.refresh.request');
    expect(refreshRequest.type).toBe('bridge.refresh.request');
    const refreshedWindow = { postMessage: vi.fn() };
    (iframe as { contentWindow: object }).contentWindow = refreshedWindow;
    load();
    const refreshedConnect = refreshedWindow.postMessage.mock.calls[0]?.[0] as {
      requestId: string;
    };
    ready(emit, refreshedWindow, refreshedConnect.requestId);
    await Promise.resolve();
    await Promise.resolve();
    const refreshedRequest = latestRequest(refreshedWindow, 'bridge.observe.request');
    emit(refreshedWindow, {
      version: 'cloudcrane.preview.v1',
      type: 'bridge.observe.response',
      requestId: refreshedRequest.requestId,
      payload: { observation: observation('https://preview.example/about') },
    });

    await expect(refresh).resolves.toMatchObject({ path: '/about' });
    expect(iframe.src).toBe('https://preview.example/');
    client.dispose();
  });

  it('recovers when the initial Bridge READY was sent before the parent listener', async () => {
    const { iframe, iframeWindow, emit } = setup();
    const onReady = vi.fn();
    const onLocationChange = vi.fn();
    const client = new PreviewBridgeClient(iframe, 'https://preview.example/', {
      onReady,
      onLocationChange,
    });
    const connect = iframeWindow.postMessage.mock.calls[0]?.[0] as { requestId: string };
    ready(emit, iframeWindow, connect.requestId);
    emit(iframeWindow, {
      version: 'cloudcrane.preview.v1',
      type: 'bridge.location.changed',
      requestId: 'location-1',
      payload: { url: 'https://preview.example/contact', path: '/contact' },
    });
    expect(onLocationChange).toHaveBeenCalledWith({
      url: 'https://preview.example/contact',
      path: '/contact',
    });

    await expect(resolveObserve(client, iframeWindow, emit)).resolves.toMatchObject({
      title: 'Preview',
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('uses iframe load handshake when the parent is ready first and ignores wrong source or origin', async () => {
    const { iframe, iframeWindow, emit, load } = setup();
    const onReady = vi.fn();
    const client = new PreviewBridgeClient(iframe, 'https://preview.example/', onReady);

    emit(
      {},
      {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.ready',
        requestId: 'wrong-source',
        payload: { capabilities },
      },
    );
    emit(
      iframeWindow,
      {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.ready',
        requestId: 'wrong-origin',
        payload: { capabilities },
      },
      'https://evil.example',
    );
    load();
    const connect = iframeWindow.postMessage.mock.calls.at(-1)?.[0] as { requestId: string };
    ready(emit, iframeWindow, connect.requestId);

    await expect(resolveObserve(client, iframeWindow, emit)).resolves.toMatchObject({
      title: 'Preview',
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    client.dispose();
  });
});
