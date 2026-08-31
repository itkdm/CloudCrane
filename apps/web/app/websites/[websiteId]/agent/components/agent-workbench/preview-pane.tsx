import { AlertTriangle, ExternalLink, Eye, LoaderCircle, RefreshCw } from 'lucide-react';
import type { RefObject } from 'react';
import type { PreviewState } from './types';

type PreviewPaneProps = {
  preview: PreviewState;
  previewKey: number;
  frameRef: RefObject<HTMLIFrameElement | null>;
  bridgeStatus: string;
  onRefresh: () => void;
  onOpen: () => void;
};

export function PreviewPane({
  preview,
  previewKey,
  frameRef,
  bridgeStatus,
  onRefresh,
  onOpen,
}: PreviewPaneProps) {
  const path = preview.url ? new URL(preview.url).pathname || '/' : '/';
  const isUnavailable = preview.status === 'unavailable' || preview.status === 'stopped';

  return (
    <aside className="preview-pane" aria-label="实时预览">
      <header className="preview-header">
        <div>
          <div className="preview-title-row">
            <h2>实时预览</h2>
            <span className={`preview-state ${preview.status}`}>
              <span className="state-dot" aria-hidden="true" />
              {previewLabel(preview.status)}
            </span>
          </div>
          <span className="preview-path">{path}</span>
        </div>
        <div className="preview-actions">
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
            <p>{preview.message ?? '等待工作区预览运行时就绪。'}</p>
          </div>
        )}
      </div>
      <div className={`bridge-hint ${bridgeStatus === 'connected' ? 'ready' : ''}`}>
        <Eye size={14} aria-hidden="true" />
        {bridgeStatus === 'connected' ? 'Agent 可检查页面' : '正在连接页面检查能力'}
      </div>
    </aside>
  );
}

function previewLabel(status: PreviewState['status']): string {
  if (status === 'ready') return '正常';
  if (status === 'loading') return '加载中';
  return '不可用';
}
