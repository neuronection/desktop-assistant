# Stream display — paced reveal

How streamed assistant text reaches the screen (plan 56). The turn
envelope and the family streaming contract are unchanged: the model still
emits raw provider-token `delta`s (ai-features §5). This layer is the
**consumer-side display policy** between the accumulated live text and the
DOM — what makes fast models readable.

## Design laws

1. **Words, never characters.** Commit units are word/phrase segments
   (Unicode `\p{L}\p{M}\p{N}` runs + attached punctuation + trailing
   whitespace). Provider token boundaries are transport noise and are
   never display boundaries; sub-token fragments buffer until a unit
   completes.
2. **Transient one-shot fade.** Each committed unit mounts with a short
   faint → target reveal (`da-stream-reveal`, ~320 ms ease-out). Units
   mount once, so the fade is transient by construction. Under
   `prefers-reduced-motion` the fade is off; pacing and buffering stay.
3. **Rate adaptation via buffer, not via fade speed.** The pacer tracks an
   EWMA of the arrival rate and adapts **unit size** (word at low rate →
   clause-sized phrases at high rate) and **commit size** to hold a
   bounded cadence (one commit per 100 ms tick, ≤ 6 units). A ~300 ms lag
   budget absorbs model bursts; exceeding it doubles the commit size to
   shed backlog. The fade duration is constant.
4. **Lossless invariant.** `committed + pending ≡ received` at all times;
   `flush()` releases the remainder (including a partial trailing word)
   at stream end. Tests pin this invariant on Greek sub-token input.
5. **Script-safe segmentation.** `src/shared/text/segment.ts` uses
   Unicode property classes with the `u` flag — never `\b` or `[a-z]`,
   which delete Greek and other non-Latin scripts. Model text is never
   normalized (exact code points preserved).
6. **Markdown settles at block boundaries.** Completed markdown blocks
   render through memoized `MarkdownSurface` — one parse per block, not
   one per flush. The block scanner (`findBlockBoundaries`) settles at
   blank lines and fence/math close (mirroring the library
   `splitMarkdownBlocks`), plus CommonMark block starts: headings (which
   also settle at their line end), quotes and list items — so a list
   reveals item by item and a heading never waits for a blank line. The
   CommonMark interrupt rules are honored (a bullet cannot interrupt a
   paragraph; an ordered item only at 1), and a growing final line never
   settles (a `## ` heading or a bare ``` close can still change shape).
   During streaming, list items render as adjacent one-item lists (they
   merge into one list at settle). The open tail streams as plain units
   so the fade has stable nodes, and settles to full markdown at
   `finished` (the live row is then replaced by the persisted message
   render). The prose tail uses normal whitespace, so single line breaks
   collapse exactly as they will in the final markdown; an open fenced
   code or math tail switches to pre-wrapped whitespace
   (`streamTailKeepsWhitespace`). Inline syntax inside the open tail shows
   raw until its block settles.

## Module map

| Module | Role |
|---|---|
| `src/shared/text/segment.ts` | pure segmentation: `completeWordUnits` (word units + partial tail, leading whitespace preserved), `findBlockBoundaries` (settle offsets — blank lines, fence/math, CommonMark block starts with interrupt rules), `SENTENCE_BREAK_RE` (Unicode sentence breaks, shared with TTS chunking) |
| `src/renderer/chat-react/streamDisplay/pacer.ts` | `StreamPacer`: buffer → paced word→phrase commits, EWMA rate, lag shed, `flush` at stream end. Pure, injectable clock |
| `src/renderer/chat-react/StreamedContent.tsx` | the one display component (three windows — never forked): settled blocks via `MarkdownSurface`, tail as `da-stream-seg` spans + caret; `streaming={false}` renders plain `MarkdownSurface` |
| `src/renderer/chat-react/streamDisplay/tailFormat.ts` | `streamTailKeepsWhitespace`: prose tails collapse soft breaks like markdown; open code/math tails keep pre-wrap |
| `src/renderer/styles/motion.css` | `da-stream-reveal` / `da-stream-settle` / `da-stream-caret` / prose-vs-code tail whitespace, all behind the reduced-motion guard |

Wired into `areas/TranscriptArea.tsx` (live row), `areas/ResponseFlow.tsx`
(compact launcher panel) and `DesktopApp.tsx` (live row).

## Per-delta render churn (plan 56 S5)

`turnTraceStore` coalesces listener notifications for **pure delta**
events (16 ms window); the snapshot itself stays synchronous and any
non-delta event (steps, interrupts, terminal phases) notifies immediately
and flushes a pending notification. A token firehose must not re-render
the tree per token.

## Gotchas

- Greek (and any non-Latin) text: an ASCII regex class (`[A-Z0-9]`, `[a-z]`)
  silently breaks it — `speechChunks` once missed Greek sentence breaks
  entirely because of `(?<=[A-Z0-9…])`. Always `\p{…}` + `u`.
- The library `splitMarkdownBlocks` **trims** blocks; the pacer needs raw
  offsets for segment accounting, hence the boundary scanner in
  `segment.ts`. It tracks line-level block starts only — it never parses
  markdown, and rendering always goes through the library
  `MarkdownSurface`.
- A trailing unit without whitespace (a growing word, or a `word!` still
  waiting for its space) is buffered, not displayed — tests that stream
  deltas and assert DOM text must send unit-complete deltas (trailing
  space) or a `finished` event.
- The display runs on a 100 ms commit tick (real timers); jsdom tests
  assert with `waitFor`, not with synchronous reads right after `emit`.
