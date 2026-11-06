import type { JSX, RefObject } from 'react';
import { ChatMessage } from '@neuronection/assistant-ui/chat-message';
import { ChatTranscript } from '@neuronection/assistant-ui/chat-transcript';
import { MarkdownSurface } from '@neuronection/assistant-ui/chat-markdown';
import type { ChatMessageView } from '@neuronection/assistant-ui/chat-core';
import type { LLMProvider } from '@shared/types';
import { ArtifactChips } from '../ArtifactChips';
import { MessageAttachments } from '../MessageAttachments';
import { StreamedContent } from '../StreamedContent';
import { MessageBubble } from '../MessageBubble';
import { MiniAppRunCard } from '../MiniAppRunCard';
import { SetupEmptyStateCta } from '../SetupEmptyStateCta';
import { TraceTimeline, ExpandableTraceMeta } from '../TraceTimeline';
import { SCROLL_STICK_THRESHOLD_PX } from '../launcherLayout';
import type { TurnTraceSnapshot } from '../turnTraceStore';
import type { TurnMetadata } from '@shared/schema/turnMetadata';
import { TEXT } from '@shared/constants/text';

interface TranscriptAreaProps {
  transcriptRef: RefObject<HTMLDivElement | null>;
  messages: ChatMessageView[];
  autoScroll: boolean;
  providers: LLMProvider[] | undefined;
  liveView: ChatMessageView | null;
  trace: TurnTraceSnapshot;
  traceDetails: boolean | undefined;
  onEdit: (messageId: string, content: string) => void;
  onRegenerate: (userMessageId: string) => void;
  onSelectVariant: (messageId: string) => void;
  /** Opens a run's report — the host picks the window host or the settings deep-link (plan 53 follow-up). */
  onOpenRunReport?: (packId: string, runId: string) => void;
}

/** Expanded-mode transcript: history bubbles, the streaming live row and
 * the empty state, rendered through the library transcript. */
export function TranscriptArea({
  transcriptRef,
  messages,
  autoScroll,
  providers,
  liveView,
  trace,
  traceDetails,
  onEdit,
  onRegenerate,
  onSelectVariant,
  onOpenRunReport,
}: TranscriptAreaProps): JSX.Element {
  return (
    <div data-no-drag className="contents">
      <ChatTranscript
        ref={transcriptRef}
        autoScroll={autoScroll}
        labels={{ scrollToBottom: TEXT.TRANSCRIPT_SCROLL_LATEST }}
        scrollThresholdPx={SCROLL_STICK_THRESHOLD_PX}
        items={messages}
        renderItem={(message, index) => {
          const runMeta = (message.meta as unknown as TurnMetadata | undefined)?.miniAppRun;
          return (
            <MessageBubble
              key={message.id ?? index}
              message={message}
              compact={true}
              content={
                runMeta ? (
                  <MiniAppRunCard
                    run={runMeta}
                    onOpenDetails={(runId, packId) =>
                      onOpenRunReport
                        ? onOpenRunReport(packId, runId)
                        : void window.electronAPI.onSettingsOpen({ tab: 'apps', miniAppsReportPackId: packId, miniAppsReportRunId: runId })
                    }
                    className="mt-0.5"
                  />
                ) : (
                  <MarkdownSurface value={message.content} />
                )
              }
              attachments={message.attachments?.length ? <MessageAttachments attachments={message.attachments} /> : undefined}
              onEdit={onEdit}
              onRegenerate={onRegenerate}
              onSelectVariant={onSelectVariant}
            >
              {message.role === 'assistant' ? (
                <>
                  {traceDetails ? (
                    <TraceTimeline meta={message.meta as unknown as TurnMetadata | undefined} className="mt-1" />
                  ) : (
                    <ExpandableTraceMeta meta={message.meta as unknown as TurnMetadata | undefined} className="mt-1" />
                  )}
                  {!runMeta && (
                    <ArtifactChips
                      artifacts={(message.meta as unknown as TurnMetadata | undefined)?.artifacts ?? []}
                      className="mt-1"
                    />
                  )}
                </>
              ) : undefined}
            </MessageBubble>
          );
        }}
        live={
          liveView ? (
            <ChatMessage role="assistant" content={<StreamedContent value={liveView.content} streaming={true} />} status="streaming" compact={true}>
              {traceDetails ? (
                <TraceTimeline meta={{ outcome: 'ok', steps: trace.steps }} startedAt={trace.startedAt} className="mt-1" />
              ) : undefined}
              <ArtifactChips artifacts={trace.artifacts} className="mt-1" />
            </ChatMessage>
          ) : undefined
        }
        emptyState={
          <div className="p-6 text-center text-sm opacity-50">
            {TEXT.LAUNCHER_EMPTY_STATE}
            <SetupEmptyStateCta providers={providers} />
          </div>
        }
      />
    </div>
  );
}
