import { memo, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { MarkdownSurface } from '@neuronection/assistant-ui/chat-markdown';
import { findBlockBoundaries } from '@shared/text/segment';
import { StreamPacer, TICK_MS, type StreamSegment } from './streamDisplay/pacer';
import { streamTailKeepsWhitespace } from './streamDisplay/tailFormat';

export interface StreamDisplayView {
  settledBlocks: string[];
  tailSegments: StreamSegment[];
}

const EMPTY_VIEW: StreamDisplayView = { settledBlocks: [], tailSegments: [] };

function applySegments(view: StreamDisplayView, segments: StreamSegment[]): StreamDisplayView {
  if (segments.length === 0) {
    return view;
  }
  const tail = [...view.tailSegments, ...segments];
  const boundaries = findBlockBoundaries(tail.map((segment) => segment.text).join(''));
  if (boundaries.length === 0) {
    return { settledBlocks: view.settledBlocks, tailSegments: tail };
  }
  const settledBlocks = [...view.settledBlocks];
  let remaining = tail;
  let consumed = 0;
  for (const boundary of boundaries) {
    const end = boundary - consumed;
    if (end <= 0) {
      continue;
    }
    let covered = 0;
    let count = 0;
    while (count < remaining.length && covered < end) {
      covered += remaining[count].text.length;
      count += 1;
    }
    if (count === 0) {
      continue;
    }
    settledBlocks.push(remaining.slice(0, count).map((segment) => segment.text).join(''));
    remaining = remaining.slice(count);
    consumed += covered;
  }
  return { settledBlocks, tailSegments: remaining };
}

interface StreamedContentProps {
  value: string;
  streaming: boolean;
}

/**
 * Paced stream display (plan 56 V2): provider-token deltas buffer into
 * word→phrase units released at a bounded cadence with a one-shot faint→target
 * fade per unit. Completed markdown blocks settle into memoized
 * `MarkdownSurface` renders; the open tail streams as plain units so the fade
 * has stable nodes. When streaming ends the full value renders as markdown.
 */
function StreamedContentImpl({ value, streaming }: StreamedContentProps): JSX.Element {
  const pacerRef = useRef<StreamPacer | null>(null);
  if (pacerRef.current === null) {
    pacerRef.current = new StreamPacer();
  }
  const [view, setView] = useState<StreamDisplayView>(EMPTY_VIEW);

  useEffect(() => {
    const pacer = pacerRef.current;
    if (pacer === null) {
      return;
    }
    if (!streaming) {
      const segments = pacer.flush();
      if (segments.length > 0) {
        setView((previous) => applySegments(previous, segments));
      }
      return;
    }
    if (!value.startsWith(pacer.received)) {
      pacer.reset();
      setView(EMPTY_VIEW);
    }
    pacer.push(value);
  }, [value, streaming]);

  useEffect(() => {
    if (!streaming) {
      return;
    }
    const pacer = pacerRef.current;
    if (pacer === null) {
      return;
    }
    const timer = setInterval(() => {
      const segments = pacer.tick();
      if (segments.length > 0) {
        setView((previous) => applySegments(previous, segments));
      }
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [streaming]);

  if (!streaming) {
    return <MarkdownSurface value={value} />;
  }

  const tailText = view.tailSegments.map((segment) => segment.text).join('');
  const tailClass = streamTailKeepsWhitespace(tailText) ? 'da-stream-tail da-stream-tail-code' : 'da-stream-tail';

  return (
    <div className="da-stream">
      {view.settledBlocks.map((block, index) => (
        <div key={`block-${index}`} className="da-stream-block">
          <MarkdownSurface value={block} />
        </div>
      ))}
      {view.tailSegments.length > 0 ? (
        <div className={tailClass}>
          {view.tailSegments.map((segment) => (
            <span key={segment.id} className="da-stream-seg">
              {segment.text}
            </span>
          ))}
          <span className="da-stream-caret" aria-hidden="true" />
        </div>
      ) : (
        <div className={tailClass}>
          <span className="da-stream-caret" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

export const StreamedContent = memo(StreamedContentImpl);
