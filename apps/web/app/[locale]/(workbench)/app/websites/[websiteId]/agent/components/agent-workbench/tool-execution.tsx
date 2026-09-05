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
  QuestionInteraction,
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
  onInteractionRespond,
  onInteractionCancel,
  onReferenceUpload,
}: {
  steps: ExecutionStep[];
  status: ConversationTurnStatus;
  expanded: boolean;
  onInteractionRespond?: (
    interactionId: string,
    response: { type: 'option'; optionIndex: number } | { type: 'custom'; value: string },
  ) => void;
  onInteractionCancel?: (interactionId: string) => void;
  onReferenceUpload?: (interactionId: string, file: File) => Promise<void>;
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
              step.interaction ? (
                step.interaction.kind === 'question' ? (
                  <QuestionExecution
                    key={step.id}
                    step={
                      step as ToolExecutionStep & {
                        interaction: Extract<
                          NonNullable<ToolExecutionStep['interaction']>,
                          { kind: 'question' }
                        >;
                      }
                    }
                    onRespond={onInteractionRespond}
                    onCancel={onInteractionCancel}
                  />
                ) : (
                  <ReferenceUploadExecution
                    key={step.id}
                    step={
                      step as ToolExecutionStep & {
                        interaction: Extract<
                          NonNullable<ToolExecutionStep['interaction']>,
                          { kind: 'reference_upload' }
                        >;
                      }
                    }
                    onUpload={onReferenceUpload}
                    onCancel={onInteractionCancel}
                  />
                )
              ) : (
                <ToolExecution key={step.id} step={step} />
              )
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

const ReferenceUploadExecution = memo(function ReferenceUploadExecution({
  step,
  onUpload,
  onCancel,
}: {
  step: ToolExecutionStep & {
    interaction: Extract<
      NonNullable<ToolExecutionStep['interaction']>,
      { kind: 'reference_upload' }
    >;
  };
  onUpload?: (interactionId: string, file: File) => Promise<void>;
  onCancel?: (interactionId: string) => void;
}) {
  const t = useTranslations('workbench');
  const interaction = step.interaction;
  const [file, setFile] = useState<File>();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();
  const cancelled = interaction.status === 'cancelled';
  const completed = interaction.status === 'completed' || step.status === 'completed';
  const submit = async () => {
    if (!file || !onUpload) return;
    setUploading(true);
    setUploadError(undefined);
    try {
      await onUpload(interaction.interactionId, file);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : t('referenceUploadFailed'));
    } finally {
      setUploading(false);
    }
  };
  return (
    <article className="reference-upload-execution" aria-live="polite">
      <strong>{t('referenceUploadTitle')}</strong>
      {completed ? <p>{t('referenceUploadReady')}</p> : null}
      {cancelled ? <p>{t('referenceUploadCancelled')}</p> : null}
      {!completed && !cancelled ? (
        <>
          <p>{t('referenceUploadDescription')}</p>
          <input
            type="file"
            accept={interaction.accept.join(',')}
            disabled={uploading}
            onChange={(event) => setFile(event.target.files?.[0])}
          />
          <div className="reference-upload-actions">
            <button
              type="button"
              onClick={() => onCancel?.(interaction.interactionId)}
              disabled={uploading}
            >
              {t('referenceUploadCancel')}
            </button>
            <button type="button" onClick={submit} disabled={!file || uploading}>
              {uploading ? t('referenceUploadUploading') : t('referenceUploadChoose')}
            </button>
          </div>
          {interaction.error || uploadError ? (
            <p className="question-execution-error">{interaction.error ?? uploadError}</p>
          ) : null}
        </>
      ) : null}
    </article>
  );
});

const QuestionExecution = memo(function QuestionExecution({
  step,
  onRespond,
  onCancel,
}: {
  step: ToolExecutionStep & { interaction: QuestionInteraction };
  onRespond?: (
    interactionId: string,
    response: { type: 'option'; optionIndex: number } | { type: 'custom'; value: string },
  ) => void;
  onCancel?: (interactionId: string) => void;
}) {
  const t = useTranslations('workbench');
  const interaction = step.interaction;
  const [selected, setSelected] = useState<number | 'custom'>();
  const [custom, setCustom] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const completed = interaction.status === 'answered' || Boolean(interaction.answer);
  const cancelled = interaction.status === 'cancelled' || (step.status !== 'running' && !completed);
  const failed = interaction.status === 'pending' && interaction.error;
  useEffect(() => {
    if (completed || cancelled || failed) setSubmitting(false);
  }, [cancelled, completed, failed]);
  const submit = () => {
    if (selected === undefined || !onRespond) return;
    const value = selected === 'custom' ? custom.trim() : interaction.options[selected]?.label;
    if (!value) return;
    setSubmitting(true);
    onRespond(
      interaction.interactionId,
      selected === 'custom' ? { type: 'custom', value } : { type: 'option', optionIndex: selected },
    );
  };
  const cancel = () => {
    if (!onCancel) return;
    setSubmitting(true);
    onCancel(interaction.interactionId);
  };
  return (
    <article className="question-execution" aria-live="polite">
      <p className="question-execution-title">{interaction.question}</p>
      {cancelled ? (
        <p className="question-execution-answer">{t('questionCancelled')}</p>
      ) : completed ? (
        <p className="question-execution-answer">
          ✓{' '}
          {interaction.wasCustom
            ? t('questionCustomAnswer', { answer: interaction.answer ?? '' })
            : t('questionSelected', { answer: interaction.answer ?? '' })}
        </p>
      ) : (
        <>
          <div className="question-execution-options" role="radiogroup">
            {interaction.options.map((option, index) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={selected === index}
                disabled={submitting}
                className={selected === index ? 'selected' : ''}
                onClick={() => setSelected(index)}
              >
                <strong>{option.label}</strong>
                {option.description ? <span>{option.description}</span> : null}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={selected === 'custom'}
              disabled={submitting}
              className={selected === 'custom' ? 'selected' : ''}
              onClick={() => setSelected('custom')}
            >
              <strong>{t('questionOther')}</strong>
            </button>
          </div>
          {selected === 'custom' ? (
            <textarea
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder={t('questionCustomPlaceholder')}
              disabled={submitting}
            />
          ) : null}
          <div className="question-execution-actions">
            <button type="button" onClick={cancel} disabled={submitting}>
              {submitting ? t('questionSubmitting') : t('questionCancel')}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={
                submitting || selected === undefined || (selected === 'custom' && !custom.trim())
              }
            >
              {submitting ? t('questionSubmitting') : t('questionConfirm')}
            </button>
          </div>
          {interaction.error ? (
            <p className="question-execution-error">{t('questionSubmitFailed')}</p>
          ) : null}
        </>
      )}
    </article>
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
  const [detailsOpen, setDetailsOpen] = useState(false);
  const toolName = step.toolName ?? 'tool';
  const label = t(toolLabels[toolName] ?? 'tool');
  const Icon = toolIcons[toolName] ?? Terminal;
  const status = normalizeStatus(step.status);
  const target = toolTarget(toolName, step.toolInput, t);
  const hasDetails = Boolean(step.toolInput?.trim() || step.toolOutput?.trim());
  const input = detailsOpen ? formatToolDetail(step.toolInput ?? '') : '';
  const output = detailsOpen ? formatToolDetail(step.toolOutput ?? '') : '';
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
    <details
      className={`tool-execution ${status}`}
      onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
    >
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

export const ToolFailure = memo(function ToolFailure({ message }: { message: string }) {
  return (
    <div className="tool-inline-error">
      <CircleAlert size={15} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
});
