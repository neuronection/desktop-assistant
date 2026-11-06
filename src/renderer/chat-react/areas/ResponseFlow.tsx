import type { RefObject } from 'react';
import type { JSX } from 'react';
import { Button } from '@neuronection/assistant-ui/button';
import { MessageVariantSwitcher } from '@neuronection/assistant-ui/chat-message';
import { Loader2, Volume2 } from 'lucide-react';
import type { ChatMessageView } from '@neuronection/assistant-ui/chat-core';
import { DesktopModeIcon, ExpandedModeIcon } from '@renderer/shared/modeIcons';
import { StreamedContent } from '../StreamedContent';
import { isScrolledToBottom } from '../launcherLayout';
import { TEXT, interpolate } from '@shared/constants/text';

interface ResponseFlowProps {
  ui: 'idle' | 'thinking' | 'responding' | 'done' | 'failed' | 'expanded';
  lastAssistant: ChatMessageView | null;
  speechState: 'idle' | 'loading' | 'speaking' | 'paused';
  onSpeak: (text: string) => void;
  onOpenDesktop: () => void;
  onToggleExpand: () => void;
  responseContent: string;
  onSelectVariant: (id: string) => Promise<void> | void;
  panelScrollRef: RefObject<HTMLDivElement | null>;
  panelContentRef: RefObject<HTMLDivElement | null>;
  panelStickRef: RefObject<boolean>;
  panelClamped: boolean;
}

/** Compact-mode response panel: the rising card above the launcher chrome
 * that streams the reply and offers speak/desktop/expand affordances in a
 * reserved header row so the actions never cover the reply text. */
export function ResponseFlow({
  ui,
  lastAssistant,
  speechState,
  onSpeak,
  onOpenDesktop,
  onToggleExpand,
  responseContent,
  onSelectVariant,
  panelScrollRef,
  panelContentRef,
  panelStickRef,
  panelClamped,
}: ResponseFlowProps): JSX.Element {
  return (
    <div data-no-drag className="da-rise mx-3 mt-3 min-h-0 flex-1">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--as-border)] bg-[var(--as-surface)]/60 text-sm">
        <div
          data-as="response-actions"
          className="flex h-7 shrink-0 items-center justify-end gap-0.5 px-1.5 text-[var(--as-muted-foreground)]"
        >
          {ui === 'done' && lastAssistant?.content && (
            <Button
              variant="ghost"
              size="icon"
              className="size-6 hover:text-[var(--as-fg)]"
              disabled={speechState === 'loading'}
              title={TEXT.SPEECH_SPEAK_REPLY}
              aria-label={TEXT.SPEECH_SPEAK_REPLY}
              onClick={() => void onSpeak(lastAssistant.content)}
            >
              {speechState === 'loading' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Volume2 className="h-3.5 w-3.5" aria-hidden />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-6 hover:text-[var(--as-fg)]"
            title={TEXT.LAUNCHER_OPEN_DESKTOP}
            aria-label={TEXT.LAUNCHER_OPEN_DESKTOP}
            onClick={onOpenDesktop}
          >
            <DesktopModeIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            data-expand-hint={panelClamped || undefined}
            className={`size-6 transition-[color,background-color,box-shadow] duration-200 ${
              panelClamped
                ? 'bg-[var(--as-primary)]/15 text-[var(--as-primary)] ring-1 ring-[var(--as-primary)]/40 shadow-[0_0_12px_-3px_var(--as-primary)] hover:bg-[var(--as-primary)]/25'
                : 'hover:text-[var(--as-fg)]'
            }`}
            title={TEXT.MENU_EXPAND}
            aria-label={TEXT.MENU_EXPAND}
            onClick={onToggleExpand}
          >
            <ExpandedModeIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div
          ref={panelScrollRef}
          data-as="response-scroll"
          onWheel={(e) => {
            if (e.deltaY < 0) {
              panelStickRef.current = false;
            }
          }}
          onScroll={() => {
            const el = panelScrollRef.current;
            if (el) {
              panelStickRef.current = isScrolledToBottom(el);
            }
          }}
          className={`min-h-0 flex-1 overflow-y-auto px-3 py-2 ${panelClamped ? '' : 'no-scrollbar'}`}
        >
          <div ref={panelContentRef}>
            <StreamedContent value={responseContent} streaming={ui === 'responding'} />
            {ui === 'done' && lastAssistant?.variants ? (
              <MessageVariantSwitcher
                variants={lastAssistant.variants}
                onSelect={(id) => void onSelectVariant(id)}
                labels={{
                  group: TEXT.CHAT_TREE_TITLE,
                  variantOf: (index, count) => interpolate(TEXT.CHAT_VARIANT_OF, { index, count }),
                  previous: TEXT.CHAT_PREVIOUS_VARIANT,
                  next: TEXT.CHAT_NEXT_VARIANT,
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
