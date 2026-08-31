import { LoaderCircle, Send, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';

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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSubmit = !running && !disabled;

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 52), 180)}px`;
  }, [draft]);

  return (
    <div className="composer-wrap">
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || !canSubmit || !draft.trim()) return;
            event.preventDefault();
            onSubmit();
          }}
          placeholder="描述你想修改的网站，例如：“把首页标题改成蓝色，并增加一个联系我们按钮”"
          aria-label="描述你想修改的网站"
          id="agent-prompt"
          name="prompt"
          rows={1}
          disabled={!canSubmit}
        />
        <div className="composer-toolbar">
          <span className="composer-hint">Enter 发送 · Shift + Enter 换行</span>
          {running ? (
            <button
              className="composer-send stop"
              type="button"
              onClick={onStop}
              aria-label="停止运行"
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
              <span>停止</span>
            </button>
          ) : (
            <button
              className="composer-send"
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit || !draft.trim()}
              aria-label="发送消息"
            >
              {disabled ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
              <span>发送</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
