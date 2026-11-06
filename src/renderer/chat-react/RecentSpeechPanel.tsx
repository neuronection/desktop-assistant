import { useEffect, useState, type JSX } from 'react';
import { Volume2, X } from 'lucide-react';
import type { SpeechHistoryEntry, SpeechSource } from '@shared/speech';
import { TEXT, interpolate } from '@shared/constants/text';

const SOURCE_LABELS: Record<SpeechSource, string> = {
  selection: TEXT.SPEECH_SOURCE_SELECTION,
  reply: TEXT.SPEECH_SOURCE_REPLY,
  replay: TEXT.SPEECH_SOURCE_REPLAY,
  clipboard: TEXT.SPEECH_SOURCE_CLIPBOARD,
  preview: TEXT.SPEECH_SOURCE_PREVIEW,
};

function clockLabel(at: number): string {
  try {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export interface RecentSpeechPanelProps {
  onClose: () => void;
}

/**
 * "Recent speech" (plan 58 S6b): the session ring — source, preview, time,
 * cached ratio and synthesis-call count, with one-click replay. Audio
 * persists in the cache, so a replay of an intact utterance costs zero
 * synthesis calls.
 */
export function RecentSpeechPanel({ onClose }: RecentSpeechPanelProps): JSX.Element {
  const [entries, setEntries] = useState<SpeechHistoryEntry[] | null>(null);

  useEffect(() => {
    let mounted = true;
    void Promise.resolve(window.electronAPI?.getSpeechHistory?.())
      .then((history) => {
        if (mounted) {
          setEntries(history ?? []);
        }
      })
      .catch(() => {
        if (mounted) {
          setEntries([]);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section
      data-no-drag
      role="region"
      aria-label={TEXT.SPEECH_HISTORY_TITLE}
      className="da-rise mb-1 rounded-xl border border-[var(--as-border)] bg-[var(--as-surface-raised)] p-2 text-sm"
    >
      <header className="mb-1 flex items-center gap-2 px-1">
        <Volume2 className="size-3.5 shrink-0 text-[var(--as-primary)]" aria-hidden />
        <span className="text-xs font-semibold opacity-80">{TEXT.SPEECH_HISTORY_TITLE}</span>
        <button
          type="button"
          aria-label={TEXT.CLOSE_BUTTON}
          title={TEXT.CLOSE_BUTTON}
          className="ml-auto rounded-md p-1 opacity-60 hover:bg-[var(--as-secondary)] hover:opacity-100"
          onClick={onClose}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </header>
      {entries === null ? null : entries.length === 0 ? (
        <p className="px-2 py-3 text-center text-xs opacity-60">{TEXT.SPEECH_HISTORY_EMPTY}</p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {entries.map((entry) => (
            <li
              key={entry.utteranceId}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--as-secondary)]"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs" title={entry.preview}>
                  {entry.preview}
                </p>
                <p className="truncate text-[10px] opacity-60">
                  {SOURCE_LABELS[entry.source]} · {clockLabel(entry.at)} ·{' '}
                  {interpolate(TEXT.SPEECH_HISTORY_CACHED, { cached: entry.cached, chunks: entry.chunks })} ·{' '}
                  {interpolate(TEXT.SPEECH_HISTORY_CALLS, { calls: entry.synthesisCalls })}
                </p>
              </div>
              <button
                type="button"
                aria-label={`${TEXT.SPEECH_HISTORY_REPLAY}: ${entry.preview}`}
                title={TEXT.SPEECH_HISTORY_REPLAY}
                className="shrink-0 rounded-md border border-[var(--as-border)] px-2 py-1 text-[11px] hover:bg-[var(--as-secondary)]"
                onClick={() => {
                  void window.electronAPI?.replaySpeech?.(entry.utteranceId);
                }}
              >
                {TEXT.SPEECH_HISTORY_REPLAY}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
