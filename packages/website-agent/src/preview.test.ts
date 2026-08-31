import { describe, expect, it, vi } from 'vitest';
import type { PreviewObservation } from '@cloudcrane/preview-protocol';
import type { PreviewObservationContext } from './preview.js';
import { createPreviewTools } from './preview.js';

const observation: PreviewObservation = {
  url: 'https://preview.example/',
  path: '/',
  title: 'Preview',
  viewport: { width: 100, height: 100, devicePixelRatio: 1 },
  scroll: { x: 0, y: 0 },
  dom: [],
  domTruncated: false,
  visibleText: 'Hello CloudCrane',
  consoleErrors: [],
  windowErrors: [],
  capturedAt: new Date().toISOString(),
};

describe('Preview Agent tools', () => {
  it('passes the active Run context to preview_refresh and returns observation', async () => {
    const refresh = vi.fn(async () => observation);
    const tools = createPreviewTools(
      {
        observe: vi.fn(async () => observation),
        refresh,
        navigate: vi.fn(async () => observation),
      },
      () => ({
        websiteId: '00000000-0000-4000-8000-000000000001',
        websiteSessionId: '00000000-0000-4000-8000-000000000002',
        runId: '00000000-0000-4000-8000-000000000003',
        traceId: '00000000-0000-4000-8000-000000000004',
        previewClientId: '00000000-0000-4000-8000-000000000005',
      }),
    );
    const result = await tools.preview_refresh.execute(
      'call-1',
      {},
      undefined,
      undefined,
      undefined as never,
    );
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ previewClientId: expect.any(String) }),
    );
    expect(JSON.stringify(result.content)).toContain('Hello CloudCrane');
  });

  it('rejects missing clients and arbitrary navigation before the provider', async () => {
    const navigate = vi.fn(async (context: PreviewObservationContext, path: string) => {
      void context;
      void path;
      return observation;
    });
    const tools = createPreviewTools(
      { observe: vi.fn(), refresh: vi.fn(), navigate },
      () => undefined,
    );
    await expect(
      tools.preview_observe.execute('call-1', {}, undefined, undefined, undefined as never),
    ).rejects.toMatchObject({
      code: 'CLIENT_UNAVAILABLE',
    });
    const available = createPreviewTools({ observe: vi.fn(), refresh: vi.fn(), navigate }, () => ({
      websiteId: '00000000-0000-4000-8000-000000000001',
      websiteSessionId: '00000000-0000-4000-8000-000000000002',
      runId: '00000000-0000-4000-8000-000000000003',
      traceId: '00000000-0000-4000-8000-000000000004',
      previewClientId: '00000000-0000-4000-8000-000000000005',
    }));
    for (const path of [
      'https://evil.example',
      '//evil.example',
      'javascript:alert(1)',
      'data:text/html,evil',
      '\\\\evil',
      '/bad\npath',
    ]) {
      await expect(
        available.preview_navigate.execute(
          'call-2',
          { path },
          undefined,
          undefined,
          undefined as never,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it('passes a valid Website-relative path from Pi input to the provider', async () => {
    const navigate = vi.fn(async (context: PreviewObservationContext, path: string) => {
      void context;
      void path;
      return observation;
    });
    const context = {
      websiteId: '00000000-0000-4000-8000-000000000001',
      websiteSessionId: '00000000-0000-4000-8000-000000000002',
      runId: '00000000-0000-4000-8000-000000000003',
      traceId: '00000000-0000-4000-8000-000000000004',
      previewClientId: '00000000-0000-4000-8000-000000000005',
    };
    const tools = createPreviewTools(
      { observe: vi.fn(), refresh: vi.fn(), navigate },
      () => context,
    );

    for (const [index, path] of [
      '/about?from=agent',
      '/',
      '/products',
      '/products?id=1',
      '/path#section',
    ].entries())
      await tools.preview_navigate.execute(
        `call-${index + 3}`,
        { path },
        undefined,
        undefined,
        undefined as never,
      );

    expect(navigate).toHaveBeenCalledTimes(5);
    expect(navigate.mock.calls.map(([receivedContext, path]) => [receivedContext, path])).toEqual(
      ['/about?from=agent', '/', '/products', '/products?id=1', '/path#section'].map((path) => [
        context,
        path,
      ]),
    );
  });
});
