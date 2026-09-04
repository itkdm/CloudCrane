import { AlertTriangle, ExternalLink, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import {
  calculatePreviewViewportLayout,
  getPreviewViewport,
  type PreviewViewportMode,
} from './preview-viewport';
import type { PreviewState } from './types';
import { resolvePreviewSource } from '@/lib/preview-source';

export type PreviewPaneProps = {
  preview: PreviewState;
  /** Defaults to true for compatibility with the existing always-open caller. */
  open?: boolean;
  previewKey: number;
  frameRef: RefObject<HTMLIFrameElement | null>;
  bridgeStatus: string;
  onRefresh: () => void;
  /** Opens the preview in a separate browser window (legacy prop semantics). */
  onOpen: () => void;
  /** Closes the panel and allows the parent to dispose the bridge. */
  onClose?: () => void;
  /** Current page path supplied by the parent after preview navigation. */
  currentPath?: string;
  /** Optional current page URL supplied by the parent. */
  currentUrl?: string;
  /** Fixed logical viewport used by the embedded preview. */
  previewViewportMode: PreviewViewportMode;
  onPreviewViewportModeChange: (mode: PreviewViewportMode) => void;
};

export function PreviewPane({
  preview,
  open = true,
  previewKey,
  frameRef,
  bridgeStatus,
  onRefresh,
  onOpen,
  onClose,
  currentPath,
  currentUrl,
  previewViewportMode,
  onPreviewViewportModeChange,
}: PreviewPaneProps) {
  const t = useTranslations('workbench');
  const path = resolvePreviewPath(preview, currentPath, currentUrl);
  const previewSource = resolvePreviewSource(preview.url, currentUrl);
  const isUnavailable = preview.status === 'unavailable' || preview.status === 'stopped';
  const bridgeIssue = bridgeIssueMessage(bridgeStatus, t);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const viewport = getPreviewViewport(previewViewportMode);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const viewportLayout = calculatePreviewViewportLayout(
    canvasSize.width,
    canvasSize.height,
    viewport,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const updateSize = (width: number, height: number) => {
      setCanvasSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    const initialSize = canvas.getBoundingClientRect();
    const computedStyle = window.getComputedStyle(canvas);
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
    updateSize(initialSize.width, initialSize.height - paddingTop - paddingBottom);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [open]);

  if (open === false) {
    return null;
  }

  return (
    <aside className="preview-pane" aria-label={t('livePreview')}>
      <header className="preview-header">
        <div>
          <div className="preview-title-row">
            <h2>{t('livePreview')}</h2>
            <span className="preview-path">{path}</span>
            {preview.status !== 'ready' ? (
              <span className={`preview-state ${preview.status}`}>
                <span className="state-dot" aria-hidden="true" />
                {previewLabel(preview.status, t)}
              </span>
            ) : null}
          </div>
        </div>
        <div className="preview-viewport-tools">
          <div className="preview-viewport-controls" aria-label={t('previewSize')}>
            <button
              type="button"
              className={previewViewportMode === 'desktop' ? 'active' : ''}
              aria-pressed={previewViewportMode === 'desktop'}
              onClick={() => onPreviewViewportModeChange('desktop')}
              title={t('desktopTitle')}
            >
              {t('desktop')}
            </button>
            <button
              type="button"
              className={previewViewportMode === 'mobile' ? 'active' : ''}
              aria-pressed={previewViewportMode === 'mobile'}
              onClick={() => onPreviewViewportModeChange('mobile')}
              title={t('mobileTitle')}
            >
              {t('mobile')}
            </button>
          </div>
          <span className="preview-viewport-meta">
            {viewport.width} × {viewportLayout.logicalHeight} ·{' '}
            {Math.round(viewportLayout.scale * 100)}%
          </span>
        </div>
        <div className="preview-actions">
          <button
            type="button"
            onClick={onRefresh}
            disabled={preview.status !== 'ready'}
            aria-label={t('refreshPreview')}
            title={t('refreshPreview')}
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onOpen}
            disabled={preview.status !== 'ready'}
            aria-label={t('openExternal')}
            title={t('openExternal')}
          >
            <ExternalLink size={16} aria-hidden="true" />
          </button>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={t('closePreview')}
              title={t('closePreview')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>
      <div className="preview-stage">
        <div ref={canvasRef} className="preview-canvas">
          {preview.status === 'ready' && previewSource ? (
            <div
              className="preview-viewport-shell"
              style={{
                width: viewportLayout.visualWidth,
                height: viewportLayout.visualHeight,
              }}
            >
              <div
                className="preview-viewport-inner"
                style={{
                  width: viewportLayout.logicalWidth,
                  height: viewportLayout.logicalHeight,
                  transform: `scale(${viewportLayout.scale})`,
                }}
              >
                <iframe
                  key={previewKey}
                  ref={frameRef}
                  title={t('iframeTitle')}
                  src={previewSource}
                  sandbox="allow-scripts allow-forms allow-same-origin"
                />
              </div>
            </div>
          ) : (
            <div className={`preview-empty ${isUnavailable ? 'unavailable' : ''}`}>
              {isUnavailable ? (
                <AlertTriangle size={24} aria-hidden="true" />
              ) : (
                <LoaderCircle className="spin" size={24} aria-hidden="true" />
              )}
              <strong>
                {preview.status === 'loading' ? t('loadingPreview') : t('unavailablePreview')}
              </strong>
              <p>{previewMessage(preview.status, t)}</p>
            </div>
          )}
        </div>
      </div>
      {bridgeIssue ? (
        <div className="bridge-hint error" role="status" aria-live="polite">
          <AlertTriangle size={14} aria-hidden="true" />
          {bridgeIssue}
        </div>
      ) : null}
    </aside>
  );
}

function previewMessage(status: PreviewState['status'], t: (key: string) => string): string {
  if (status === 'loading') return t('waitingPreview');
  if (status === 'stopped') return t('stoppedPreview');
  return t('failedPreview');
}

function resolvePreviewPath(
  preview: PreviewState,
  currentPath?: string,
  currentUrl?: string,
): string {
  if (currentPath ?? preview.path) return currentPath ?? preview.path ?? '/';

  const url = currentUrl ?? preview.url;
  if (!url) return '/';

  try {
    return new URL(url).pathname || '/';
  } catch {
    return url.startsWith('/') ? url : '/';
  }
}

function bridgeIssueMessage(status: string, t: (key: string) => string): string | undefined {
  if (status === 'disconnected') return t('disconnectedPreview');
  if (status === 'timeout') return t('timeoutPreview');
  if (status === 'error' || status === 'unavailable') return t('errorPreview');
  return undefined;
}

function previewLabel(status: PreviewState['status'], t: (key: string) => string): string {
  if (status === 'ready') return t('normal');
  if (status === 'loading') return t('loadingPreview');
  return t('unavailable');
}
