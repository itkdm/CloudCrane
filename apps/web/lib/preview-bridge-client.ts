import {
  bridgeMessageSchema,
  isWebsiteRelativePath,
  type PreviewCapability,
  type PreviewObservation,
} from '@cloudcrane/preview-protocol';

export const PREVIEW_READY_TIMEOUT_MS = 10_000;
const PREVIEW_OBSERVE_TIMEOUT_MS = 10_000;

export class PreviewBridgeClientError extends Error {
  constructor(
    public readonly code: 'PREVIEW_PROTOCOL_ERROR' | 'CLIENT_PREVIEW_TIMEOUT' | 'INVALID_ARGUMENT',
    message: string,
  ) {
    super(message);
    this.name = 'PreviewBridgeClientError';
  }
}

type Pending = {
  timer: ReturnType<typeof setTimeout>;
  resolve: (observation: PreviewObservation) => void;
  reject: (error: PreviewBridgeClientError) => void;
};

export class PreviewBridgeClient {
  private ready: Promise<PreviewCapability[]>;
  private resolveReady!: (capabilities: PreviewCapability[]) => void;
  private rejectReady!: (error: PreviewBridgeClientError) => void;
  private readyGeneration = 0;
  private readyStartedAt = 0;
  private readyRequestId = '';
  private readyNotifiedGeneration = 0;
  private readonly pending = new Map<string, Pending>();
  private capabilities: PreviewCapability[] = [];
  private currentUrl: string;

  constructor(
    private readonly iframe: HTMLIFrameElement,
    previewUrl: string,
    private readonly onReady?: (capabilities: PreviewCapability[]) => void,
  ) {
    this.currentUrl = cleanPreviewUrl(previewUrl);
    this.ready = this.createReadyPromise();
    window.addEventListener('message', this.handleMessage);
    this.iframe.addEventListener('load', this.handleLoad);
    this.sendConnectRequest();
  }

  dispose(): void {
    window.removeEventListener('message', this.handleMessage);
    this.iframe.removeEventListener('load', this.handleLoad);
    this.rejectAll(
      new PreviewBridgeClientError('PREVIEW_PROTOCOL_ERROR', 'Preview Client disposed'),
    );
    this.rejectReady(
      new PreviewBridgeClientError('PREVIEW_PROTOCOL_ERROR', 'Preview Bridge closed'),
    );
  }

  observe(): Promise<PreviewObservation> {
    return this.request();
  }

  async refresh(): Promise<PreviewObservation> {
    await this.observe();
    this.invalidateReady();
    this.iframe.src = cleanPreviewUrl(this.currentUrl);
    await this.ready;
    return this.observe();
  }

  async navigate(path: string): Promise<PreviewObservation> {
    if (!isWebsiteRelativePath(path))
      throw new PreviewBridgeClientError(
        'INVALID_ARGUMENT',
        'preview_navigate path must be a Website-relative path',
      );
    const target = new URL(path, this.currentUrl);
    this.invalidateReady();
    this.currentUrl = target.toString();
    this.iframe.src = this.currentUrl;
    await this.ready;
    return this.observe();
  }

  private request(): Promise<PreviewObservation> {
    return this.ready.then(
      () =>
        new Promise<PreviewObservation>((resolve, reject) => {
          const requestId = crypto.randomUUID();
          const timer = setTimeout(() => {
            this.pending.delete(requestId);
            reject(
              new PreviewBridgeClientError('CLIENT_PREVIEW_TIMEOUT', 'Preview Bridge timed out'),
            );
          }, PREVIEW_OBSERVE_TIMEOUT_MS);
          this.pending.set(requestId, { timer, resolve, reject });
          this.iframe.contentWindow?.postMessage(
            {
              version: 'cloudcrane.preview.v1',
              type: 'bridge.observe.request',
              requestId,
              payload: {},
            },
            this.origin(),
          );
        }),
    );
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.iframe.contentWindow || event.origin !== this.origin()) return;
    const parsed = bridgeMessageSchema.safeParse(event.data);
    if (!parsed.success) return;
    if (parsed.data.type === 'bridge.ready') {
      const readyTimestamp = parseReadyTimestamp(parsed.data.requestId);
      if (
        parsed.data.requestId !== this.readyRequestId &&
        (readyTimestamp === undefined || readyTimestamp < this.readyStartedAt)
      )
        return;
      this.capabilities = parsed.data.payload.capabilities;
      this.resolveReady(this.capabilities);
      if (this.readyNotifiedGeneration !== this.readyGeneration) {
        this.readyNotifiedGeneration = this.readyGeneration;
        this.onReady?.(this.capabilities);
      }
      return;
    }
    if (parsed.data.type === 'bridge.observe.response') {
      const pending = this.pending.get(parsed.data.requestId);
      if (!pending) return;
      this.pending.delete(parsed.data.requestId);
      clearTimeout(pending.timer);
      this.currentUrl = cleanPreviewUrl(parsed.data.payload.observation.url);
      pending.resolve(parsed.data.payload.observation);
      return;
    }
    if (parsed.data.type === 'bridge.error') {
      const pending = this.pending.get(parsed.data.requestId);
      if (!pending) return;
      this.pending.delete(parsed.data.requestId);
      clearTimeout(pending.timer);
      pending.reject(
        new PreviewBridgeClientError('PREVIEW_PROTOCOL_ERROR', parsed.data.payload.message),
      );
    }
  };

  private invalidateReady(): void {
    this.rejectAll(
      new PreviewBridgeClientError('PREVIEW_PROTOCOL_ERROR', 'Preview page reloading'),
    );
    this.rejectReady(
      new PreviewBridgeClientError('PREVIEW_PROTOCOL_ERROR', 'Preview page reloading'),
    );
    this.ready = this.createReadyPromise();
  }

  private readonly handleLoad = (): void => {
    this.sendConnectRequest();
  };

  private sendConnectRequest(): void {
    this.iframe.contentWindow?.postMessage(
      {
        version: 'cloudcrane.preview.v1',
        type: 'bridge.connect.request',
        requestId: this.readyRequestId,
        payload: {},
      },
      this.origin(),
    );
  }

  private createReadyPromise(): Promise<PreviewCapability[]> {
    const generation = ++this.readyGeneration;
    this.readyStartedAt = Date.now();
    this.readyRequestId = `connect:${crypto.randomUUID()}`;
    const promise = new Promise<PreviewCapability[]>((resolve, reject) => {
      let settled = false;
      const settleResolve = (capabilities: PreviewCapability[]) => {
        if (settled || generation !== this.readyGeneration) return;
        settled = true;
        clearTimeout(timer);
        resolve(capabilities);
      };
      const settleReject = (error: PreviewBridgeClientError) => {
        if (settled || generation !== this.readyGeneration) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(
        () =>
          settleReject(
            new PreviewBridgeClientError(
              'CLIENT_PREVIEW_TIMEOUT',
              'Preview Bridge did not become ready',
            ),
          ),
        PREVIEW_READY_TIMEOUT_MS,
      );
      this.resolveReady = settleResolve;
      this.rejectReady = settleReject;
    });
    void promise.catch(() => undefined);
    return promise;
  }

  private rejectAll(error: PreviewBridgeClientError): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private origin(): string {
    return new URL(this.currentUrl).origin;
  }
}

function cleanPreviewUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.delete('token');
  return url.toString();
}

function parseReadyTimestamp(requestId: string): number | undefined {
  const match = /^bridge:(\d+)$/.exec(requestId);
  if (!match) return undefined;
  const timestamp = Number(match[1]);
  return Number.isSafeInteger(timestamp) ? timestamp : undefined;
}
