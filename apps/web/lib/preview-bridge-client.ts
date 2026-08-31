import {
  bridgeMessageSchema,
  isWebsiteRelativePath,
  type PreviewCapability,
  type PreviewObservation,
} from '@cloudcrane/preview-protocol';

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
  }

  dispose(): void {
    window.removeEventListener('message', this.handleMessage);
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
          }, 10_000);
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
      this.capabilities = parsed.data.payload.capabilities;
      this.resolveReady(this.capabilities);
      this.onReady?.(this.capabilities);
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
    this.ready = this.createReadyPromise();
  }

  private createReadyPromise(): Promise<PreviewCapability[]> {
    return new Promise<PreviewCapability[]>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
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
