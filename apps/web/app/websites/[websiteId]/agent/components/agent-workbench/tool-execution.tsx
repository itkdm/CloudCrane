import {
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileCode2,
  FolderSearch,
  LoaderCircle,
  PencilLine,
  Terminal,
  Waypoints,
  X,
} from 'lucide-react';
import { memo } from 'react';
import type { Message } from './types';

const toolLabels: Record<string, string> = {
  read: '读取文件',
  write: '写入文件',
  edit: '修改文件',
  ls: '查看目录',
  find: '查找文件',
  bash: '执行命令',
  preview_observe: '检查页面',
  preview_refresh: '刷新并检查页面',
  preview_navigate: '打开页面',
};

const toolIcons: Record<string, typeof FileCode2> = {
  read: FileCode2,
  write: FileCode2,
  edit: PencilLine,
  ls: FolderSearch,
  find: FolderSearch,
  bash: Terminal,
  preview_observe: Waypoints,
  preview_refresh: Waypoints,
  preview_navigate: Waypoints,
};

export const ToolExecution = memo(function ToolExecution({ message }: { message: Message }) {
  const toolName = message.toolName ?? 'tool';
  const label = toolLabels[toolName] ?? '执行工具';
  const Icon = toolIcons[toolName] ?? Terminal;
  const status = normalizeStatus(message.status);
  const target = toolTarget(toolName, message.toolInput);
  const input = boundedDetail(message.toolInput);
  const output = boundedDetail(message.toolOutput);

  return (
    <article className={`tool-execution ${status}`}>
      <div className="tool-status-icon" aria-hidden="true">
        {status === 'completed' ? <Check size={15} /> : null}
        {status === 'running' ? <LoaderCircle className="spin" size={15} /> : null}
        {status === 'failed' ? <X size={15} /> : null}
        {status === 'waiting' ? <Clock3 size={15} /> : null}
      </div>
      <div className="tool-icon" aria-hidden="true">
        <Icon size={15} strokeWidth={1.8} />
      </div>
      <div className="tool-copy">
        <div className="tool-title-row">
          <strong>{label}</strong>
          <span className="tool-status-label">{statusLabels[status]}</span>
        </div>
        <span className="tool-target">{target}</span>
      </div>
      {(input || output) && (
        <details className="tool-details">
          <summary title="查看工具详情" aria-label="查看工具详情">
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="tool-detail-content">
            {input && (
              <div className="tool-detail-section">
                <span>输入</span>
                <pre>{input}</pre>
              </div>
            )}
            {output && (
              <div className="tool-detail-section">
                <span>输出</span>
                <pre>{output}</pre>
              </div>
            )}
          </div>
        </details>
      )}
    </article>
  );
});

const statusLabels = {
  waiting: '等待',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
};

function normalizeStatus(value?: string): keyof typeof statusLabels {
  if (value === 'running' || value === 'failed' || value === 'waiting') return value;
  if (value === 'error') return 'failed';
  return 'completed';
}

function toolTarget(toolName: string, text = ''): string {
  if (toolName.startsWith('preview_')) {
    if (toolName !== 'preview_navigate') return '当前预览';
    const path = readInputValue(text, ['path', 'target', 'url']);
    return path ? `打开页面 ${boundedPath(path)}` : '当前网站页面';
  }
  const path = text.match(/(?:\/workspace|workspace)[^\s"'`}\]]+/i)?.[0];
  if (path) return basename(path.replace(/^workspace/i, '/workspace'));
  const command = text.match(/(?:command|cmd)\s*[:=]\s*["']([^"']+)/i)?.[1];
  if (command) return command;
  const simpleTarget = text.trim();
  if (/^[\w./-]{1,120}$/.test(simpleTarget)) return simpleTarget;
  return '当前工作区';
}

function readInputValue(text: string, keys: string[]): string {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object') {
      for (const key of keys) {
        const candidate = (value as Record<string, unknown>)[key];
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      }
    }
  } catch {
    // Tool input can also be a human-readable string.
  }

  for (const key of keys) {
    const match = text.match(
      new RegExp(`(?:\\"|\\b)${key}(?:\\"|\\b)\\s*[:=]\\s*[\\"']([^\\"']+)`, 'i'),
    );
    if (match?.[1]) return match[1].trim();

    const unquotedMatch = text.match(
      new RegExp(`(?:\\"|\\b)${key}(?:\\"|\\b)\\s*[:=]\\s*([^\\s,}]+)`, 'i'),
    );
    if (unquotedMatch?.[1]) return unquotedMatch[1].trim();
  }
  return '';
}

function basename(path: string): string {
  const normalized = path
    .replace(/[?#].*$/, '')
    .replace(/\\/g, '/')
    .replace(/\/$/, '');
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function boundedPath(path: string): string {
  const normalized = path.replace(/[?#].*$/, '').trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}…` : normalized;
}

function boundedDetail(text = ''): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed === '当前工作区') return '';
  return trimmed.length > 900 ? `${trimmed.slice(0, 900)}\n…` : trimmed;
}

export const ToolFailure = memo(function ToolFailure({ message }: { message: string }) {
  return (
    <div className="tool-inline-error">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
});
