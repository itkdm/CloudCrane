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
import { formatToolDetail } from './tool-detail-formatter';
import type {
  ContextMaintenanceExecutionStep,
  ConversationTurnStatus,
  ExecutionStep,
  ToolExecutionStep,
} from './types';

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
            ) : step.kind === 'tool' ? (
              <ToolExecution key={step.id} step={step} />
            ) : (
              <ContextMaintenanceExecution key={step.id} step={step} />
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

const ContextMaintenanceExecution = memo(function ContextMaintenanceExecution({
  step,
}: {
  step: ContextMaintenanceExecutionStep;
}) {
  const t = useTranslations('workbench');
  return (
    <div
      className={`context-maintenance ${step.status === 'error' ? 'failed' : step.status}`}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden="true">
        {step.status === 'running' ? '◌' : step.status === 'completed' ? '✓' : '!'}
      </span>
      <span>
        {step.status === 'running'
          ? t('compactionRunning')
          : step.status === 'completed'
            ? t('compactionCompleted')
            : t('compactionFailed')}
      </span>
    </div>
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
  const hasDetails = Boolean(input || output);
  const row = (
    <>
      <span className="tool-icon" aria-hidden="true">
        <Icon size={15} strokeWidth={1.8} />
      </span>
      <span className="tool-copy">
        <span className="tool-title-row">
          <strong>{label}</strong>
          {target ? (
            <span className="tool-target" title={target}>
              {target}
            </span>
          ) : null}
        </span>
      </span>
      <span className="tool-status-label">
        {status === 'completed' ? <Check size={13} aria-hidden="true" /> : null}
        {status === 'running' ? (
          <LoaderCircle className="spin" size={13} aria-hidden="true" />
        ) : null}
        {status === 'failed' ? <X size={13} aria-hidden="true" /> : null}
        {status === 'waiting' ? <Clock3 size={13} aria-hidden="true" /> : null}
        <span>{t(statusLabelKeys[status])}</span>
      </span>
      {hasDetails ? (
        <ChevronDown className="tool-details-chevron" size={15} aria-hidden="true" />
      ) : null}
    </>
  );

  if (!hasDetails)
    return (
      <article className={`tool-execution ${status}`}>
        <div className="tool-execution-row">{row}</div>
      </article>
    );

  return (
    <details className={`tool-execution ${status}`}>
      <summary
        className="tool-execution-row"
        title={t('toolDetails')}
        aria-label={t('toolDetails')}
      >
        {row}
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
  const formatted = formatToolDetail(text);
  if (!formatted) return '';
  return formatted.length > 1200 ? `${formatted.slice(0, 1200)}\n…` : formatted;
}

export const ToolFailure = memo(function ToolFailure({ message }: { message: string }) {
  return (
    <div className="tool-inline-error">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
});
