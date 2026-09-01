import { AlertTriangle, ExternalLink, Eye, LoaderCircle, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  calculatePreviewScale,
  getPreviewViewport,
  type PreviewViewportMode,
} from './preview-viewport';
import type { PreviewState } from './types';

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
  /** Opens the preview panel and mounts the iframe. */
  onOpenPanel?: () => void;
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
  onOpenPanel,
  onClose,
  currentPath,
  currentUrl,
  previewViewportMode,
  onPreviewViewportModeChange,
}: PreviewPaneProps) {
  const path = resolvePreviewPath(preview, currentPath, currentUrl);
  const isUnavailable = preview.status === 'unavailable' || preview.status === 'stopped';
  const bridgeIssue = bridgeIssueMessage(bridgeStatus);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const viewport = getPreviewViewport(previewViewportMode);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const scale = calculatePreviewScale(stageSize.width, stageSize.height, viewport);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateSize = (width: number, height: number) => {
      setStageSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    const initialSize = stage.getBoundingClientRect();
    updateSize(initialSize.width, initialSize.height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [open]);

  if (open === false) {
    return (
      <aside className="preview-pane preview-pane-closed" aria-label="预览面板已关闭">
        <button
          type="button"
          className="new-session-button preview-open-button"
          onClick={onOpenPanel ?? onOpen}
          aria-label="打开预览"
          title="打开预览"
        >
          <Eye size={17} aria-hidden="true" />
          <span>预览</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="preview-pane" aria-label="实时预览">
      <header className="preview-header">
        <div>
          <div className="preview-title-row">
            <h2>实时预览</h2>
            {preview.status !== 'ready' ? (
              <span className={`preview-state ${preview.status}`}>
                <span className="state-dot" aria-hidden="true" />
                {previewLabel(preview.status)}
              </span>
            ) : null}
          </div>
          <span className="preview-path">{path}</span>
        </div>
        <div className="preview-actions">
          <div className="preview-viewport-controls" aria-label="预览尺寸">
            <button
              type="button"
              className={previewViewportMode === 'desktop' ? 'active' : ''}
              aria-pressed={previewViewportMode === 'desktop'}
              onClick={() => onPreviewViewportModeChange('desktop')}
              title="桌面端 1440 × 900"
            >
              桌面
            </button>
            <button
              type="button"
              className={previewViewportMode === 'mobile' ? 'active' : ''}
              aria-pressed={previewViewportMode === 'mobile'}
              onClick={() => onPreviewViewportModeChange('mobile')}
              title="移动端 390 × 844"
            >
              移动
            </button>
            <span className="preview-viewport-meta">
              {viewport.width} × {viewport.height} · {Math.round(scale * 100)}%
            </span>
          </div>
          {onClose ? (
            <button type="button" onClick={onClose} aria-label="关闭预览" title="关闭预览">
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={preview.status !== 'ready'}
            aria-label="刷新预览"
            title="刷新预览"
          >
            <RefreshCw size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onOpen}
            disabled={preview.status !== 'ready'}
            aria-label="在新窗口打开预览"
            title="在新窗口打开预览"
          >
            <ExternalLink size={16} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div ref={stageRef} className="preview-stage">
        {preview.status === 'ready' && preview.url ? (
          <div className="preview-canvas">
            <div
              className="preview-viewport-shell"
              style={{
                width: viewport.width,
                height: viewport.height,
                transform: `scale(${scale})`,
              }}
            >
              <iframe
                key={previewKey}
                ref={frameRef}
                title="网站实时预览"
                src={preview.url}
                sandbox="allow-scripts allow-forms allow-same-origin"
                style={{ width: viewport.width, height: viewport.height }}
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
            <strong>{preview.status === 'loading' ? '正在加载预览' : '预览暂不可用'}</strong>
            <p>{previewMessage(preview.status)}</p>
          </div>
        )}
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

function previewMessage(status: PreviewState['status']): string {
  if (status === 'loading') return '正在等待工作区预览就绪。';
  if (status === 'stopped') return '预览运行时尚未启动，请稍后重试。';
  return '当前无法加载预览，请稍后重试。';
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

function bridgeIssueMessage(status: string): string | undefined {
  if (status === 'disconnected') return '页面连接已中断，正在重新连接。';
  if (status === 'timeout') return '页面响应超时，请稍后重试。';
  if (status === 'error' || status === 'unavailable') return '页面检查暂时不可用，请稍后重试。';
  return undefined;
}

function previewLabel(status: PreviewState['status']): string {
  if (status === 'ready') return '正常';
  if (status === 'loading') return '加载中';
  return '不可用';
}
