import { AlertTriangle, ExternalLink, Eye, LoaderCircle, RefreshCw, X } from 'lucide-react';
import type { RefObject } from 'react';
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
}: PreviewPaneProps) {
  const path = resolvePreviewPath(preview, currentPath, currentUrl);
  const isUnavailable = preview.status === 'unavailable' || preview.status === 'stopped';
  const bridgeIssue = bridgeIssueMessage(bridgeStatus);

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
      <div className="preview-stage">
        {preview.status === 'ready' && preview.url ? (
          <iframe
            key={previewKey}
            ref={frameRef}
            title="网站实时预览"
            src={preview.url}
            sandbox="allow-scripts allow-forms allow-same-origin"
          />
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
