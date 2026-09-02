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
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AssistantMessage } from './assistant-message';
import type { ConversationTurnStatus, ExecutionStep, ToolExecutionStep } from './types';

const toolLabels: Record<string, string> = {
  read: 'read',
  write: 'write',
  edit: 'edit',
  ls: 'ls',
  find: 'find',
  bash: 'bash',
  preview_observe: 'previewObserve',
  preview_refresh: 'previewRefresh',
  preview_navigate: 'previewNavigate',
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

export const ExecutionProcess = memo(function ExecutionProcess({
  steps,
  status,
  expanded,
}: {
  steps: ExecutionStep[];
  status: ConversationTurnStatus;
  expanded: boolean;
}) {
  const t = useTranslations('workbench');
  const isRunning = status === 'running';
  const [open, setOpen] = useState(isRunning || expanded);

  useEffect(() => {
    setOpen(isRunning ? true : false);
  }, [isRunning]);

  const processLabel = isRunning
    ? t('executing')
    : status === 'completed'
      ? t('executionComplete')
      : status === 'aborted'
        ? t('executionStopped')
        : t('executionFailed');
  const processSummary = `${processLabel} · ${t('steps', { count: steps.length })}`;

  return (
    <section className={`execution-process ${isRunning ? 'running' : 'settled'}`}>
      <button
        className="execution-summary"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${processSummary}，${open ? t('collapseDetails') : t('expandDetails')}`}
        {...(isRunning ? { 'aria-live': 'polite' as const } : {})}
      >
        <span className="execution-summary-icon" aria-hidden="true">
          {isRunning ? <LoaderCircle className="spin" size={15} /> : null}
          {status === 'completed' ? <Check size={15} /> : null}
          {status === 'error' || status === 'no-final-text' ? <CircleAlert size={15} /> : null}
          {status === 'aborted' ? <X size={15} /> : null}
        </span>
        <span className="execution-summary-copy">
          <strong>{processSummary}</strong>
          <span>{open ? t('collapseDetails') : t('expandDetails')}</span>
        </span>
        <ChevronDown className={open ? 'expanded' : ''} size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="execution-content">
          {steps.map((step) =>
            step.kind === 'assistant' ? (
              <AssistantMessage
                key={step.id}
                message={{ id: step.id, role: 'assistant', text: step.text, status: step.status }}
                variant="narrative"
              />
            ) : (
              <ToolExecution key={step.id} step={step} />
            ),
          )}
          {status === 'error' || status === 'no-final-text' || status === 'aborted' ? (
            <div className="execution-error" role="status">
              <CircleAlert size={14} aria-hidden="true" />
              <span>{status === 'aborted' ? t('runStopped') : t('runIncomplete')}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});

export const ToolExecution = memo(function ToolExecution({ step }: { step: ToolExecutionStep }) {
  const t = useTranslations('workbench');
  const toolName = step.toolName ?? 'tool';
  const label = t(toolLabels[toolName] ?? 'tool');
  const Icon = toolIcons[toolName] ?? Terminal;
  const status = normalizeStatus(step.status);
  const target = toolTarget(toolName, step.toolInput, t);
  const input = boundedDetail(step.toolInput);
  const output = boundedDetail(step.toolOutput);

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
          <span className="tool-status-label">{t(statusLabelKeys[status])}</span>
        </div>
        {target ? <span className="tool-target">{target}</span> : null}
      </div>
      {(input || output) && (
        <details className="tool-details">
          <summary title={t('toolDetails')} aria-label={t('toolDetails')}>
            <ChevronDown size={15} aria-hidden="true" />
          </summary>
          <div className="tool-detail-content">
            {input && (
              <div className="tool-detail-section">
                <span>{t('input')}</span>
                <pre>{input}</pre>
              </div>
            )}
            {output && (
              <div className="tool-detail-section">
                <span>{t('output')}</span>
                <pre>{output}</pre>
              </div>
            )}
          </div>
        </details>
      )}
    </article>
  );
});

const statusLabelKeys = {
  waiting: 'waiting',
  running: 'running',
  completed: 'completed',
  failed: 'failure',
} as const;

function normalizeStatus(value?: string): keyof typeof statusLabelKeys {
  if (value === 'running' || value === 'failed' || value === 'waiting') return value;
  if (value === 'error') return 'failed';
  return 'completed';
}

function toolTarget(
  toolName: string,
  text = '',
  t: (key: string, values?: Record<string, string | number | Date>) => string,
): string | undefined {
  if (toolName.startsWith('preview_')) {
    if (toolName !== 'preview_navigate') return t('currentPreview');
    const path = readInputValue(text, ['path', 'target', 'url']);
    return path ? t('openPage', { path: boundedPath(path) }) : undefined;
  }
  const path = text.match(/(?:\/workspace|workspace)[^\s"'`}\]]+/i)?.[0];
  if (path) return basename(path.replace(/^workspace/i, '/workspace'));
  const command = text.match(/(?:command|cmd)\s*[:=]\s*["']([^"']+)/i)?.[1];
  if (command) return command;
  const simpleTarget = text.trim();
  if (/^[\w./-]{1,120}$/.test(simpleTarget)) return simpleTarget;
  return undefined;
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
  const trimmed = sanitizeDetail(text.trim());
  if (!trimmed) return '';
  return trimmed.length > 900 ? `${trimmed.slice(0, 900)}\n…` : trimmed;
}

function sanitizeDetail(text: string): string {
  if (!text) return '';
  try {
    const value: unknown = JSON.parse(text);
    return JSON.stringify(stripInternalFields(value), null, 2);
  } catch {
    return text
      .replace(/(?:agent\s*service|runId|traceId|turnIndex)\s*[:=]\s*[^,\s}]+,?/gi, '')
      .trim();
  }
}

function stripInternalFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripInternalFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/^(agentservice|agent_service|runid|traceid|turnindex)$/i.test(key))
      .map(([key, child]) => [key, stripInternalFields(child)]),
  );
}

export const ToolFailure = memo(function ToolFailure({ message }: { message: string }) {
  return (
    <div className="tool-inline-error">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
});
