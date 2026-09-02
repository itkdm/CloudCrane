import { LoaderCircle, Send, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';

type ComposerProps = {
  draft: string;
  running: boolean;
  disabled?: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
};

export function Composer({
  draft,
  running,
  disabled,
  onDraftChange,
  onSubmit,
  onStop,
}: ComposerProps) {
  const t = useTranslations('workbench');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);
  const canSubmit = !running && !disabled;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 28), 176)}px`;
  }, [draft]);

  return (
    <div className="composer-wrap">
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          onKeyDown={(event) => {
            const isComposing =
              isComposingRef.current || event.nativeEvent.isComposing || event.keyCode === 229;
            if (
              isComposing ||
              event.key !== 'Enter' ||
              event.shiftKey ||
              !canSubmit ||
              !draft.trim()
            )
              return;
            event.preventDefault();
            onSubmit();
          }}
          placeholder={t('promptPlaceholder')}
          aria-label={t('promptLabel')}
          id="agent-prompt"
          name="prompt"
          rows={1}
          disabled={!canSubmit}
        />
        <div className="composer-toolbar">
          <span className="composer-hint" aria-hidden="true" />
          {running ? (
            <button
              className="composer-send stop"
              type="button"
              onClick={onStop}
              aria-label={t('stop')}
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
              <span>{t('stop')}</span>
            </button>
          ) : (
            <button
              className="composer-send"
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit || !draft.trim()}
              aria-label={t('send')}
            >
              {disabled ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
              <span>{t('send')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
