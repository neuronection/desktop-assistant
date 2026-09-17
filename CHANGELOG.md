# Changelog

All notable changes to this project are documented here. User-visible
changes land under `## [Unreleased]` in the same commit that introduces
them.

## [Unreleased]
### Changed
- **assistant-ui 0.39 → 0.40**: `ChatToolsCatalog` entries accept an
  optional `badge` chip (`{ label, tone?: 'info' | 'warning' }`) beside
  the tool name — groundwork for marking non-callable HITL capability
  rows (ADR-0015) distinctly from callable tools.
### Fixed
- **Composer no longer flips 1↔2 lines per keystroke** (assistant-ui
  0.37 → 0.39.0): the library `ChatComposer` derived its `data-multiline`
  flag from the textarea's width — which the flag itself controls via the
  footer-wrap styling — so drafts near the wrap threshold oscillated the
  layout (and the toolbar positions) on every keystroke once a
  response/trace was on screen. Upstream 0.39.0 makes the flag
  hysteretic: once multiline it stays until the draft clears.
- **Gemini no longer hallucinates screenshot descriptions.** Tool results
  carrying images (`screen_capture`, `recall_screenshot`) were invisible
  to Gemini models: `@langchain/google-genai` serializes every ToolMessage
  content block — including base64 `inlineData` — into the
  `functionResponse.response` JSON struct, which the Gemini API treats as
  opaque text (LangChainJS issue #10297; fix PRs closed unmerged as of
  2.3.2). The model received "The image is attached below." plus an inert
  base64 JSON blob and invented plausible content. `patch-package`
  (new devDependency + `postinstall`) now applies
  `patches/@langchain+google-genai+2.3.2.patch`: the converter splits
  ToolMessage parts into text (kept in `response.result` as a plain
  string) and media, then nests media as the Gemini-3-documented
  `functionResponse.parts` on `gemini-3*` models or as sibling
  `inlineData` parts on older ones. Covered by
  `tests/ai-gemini-tool-image.test.ts` (fails if the patch is not
  applied); text-only and error tool results are byte-identical to the
  stock converter.
### Security
- Cleared the 10 high-severity `npm audit` findings (GHSA-ggr8-5vv4-36mx,
  `deepmerge-ts` stack exhaustion): npm `overrides` now pins
  `deepmerge-ts` to the patched `^8.0.2` across the Prisma CLI chain —
  upstream ships the fix only in unreleased `8.1.0-dev.5+`, so no version
  downgrade was needed. Also dropped the unused `@prisma/migrate`
  dependency (nothing imported it; it dragged a second major of Prisma
  7.x internals into the tree). Prisma generate/validate/gensql verified
  unchanged.
### Changed
- **pdf-parse 1.1 → 2.4** (PDF text extraction in AttachmentService +
  DocsIndexService): v2 replaces the bare `pdf(buffer)` call with the
  `PDFParse` class (`getText()` + explicit `destroy()`), ships its own
  types (the `@types/pdf-parse` stub is gone) and keeps a CJS build, so
  no ESM migration was needed in the main process. Real-PDF extraction
  smoke verified; docs-index suite updated to the class-shaped mock.
- **zod 3.25 → 4.6** (LangChain stack accepts `^3.25.76 || ^4`): tool
  schemas, manifest validation, memory-verdict parsing and config
  validation all pass the suite unchanged. Two internal migrations:
  `z.record` calls now carry explicit key schemas (v4 requirement), and
  the settings/command-catalog schema introspection moved from the
  removed `_def.typeName` v3 internals to v4 `def.type` (enum `entries`,
  literal `values` array, number-format checks for integer detection).
- **openai SDK 5.23 → 7.17** (the sanctioned STT/TTS surface): typecheck
  and the stt/tts suites pass unchanged — `audio.transcriptions.create`
  with Node read streams and `audio.speech.create` are stable across
  the v6/v7 majors; no code changes.
- **Vite 6 → 8** (Rolldown-based) with `@vitejs/plugin-react` 4 → 6 and
  `vite-tsconfig-paths` 5 → 6; vitest 5.0.1 and `@tailwindcss/vite`
  4.3.3 already peer-support vite 8. One code fix: a pre-existing
  duplicate mid-file import block in `tests/command-tools.test.ts`
  (esbuild merged it silently, oxc errors) — removed. Renderer build
  drops from ~15s to ~1s. Dev-server config unchanged (dev CSP relax
  plugin, ports, multi-entry inputs all as before).
- **@neuronection/assistant-ui 0.30 → 0.37**: reviewed the library
  changelog 0.31–0.37 — all additive or fixes, no breaking API against
  this app's inventory (ProviderForm's preset-catalog props are
  optional; `HitlProposalCard`, `SegmentedTabs` and the `/flow-trace`,
  `/markdown-diff-view`, `/countries` subpaths are new surface).
  Behavior deltas: chat bubbles use `--as-radius` (softer bubbles, tail
  corner kept), `ChatToolCard`/`ChatTraceTimeline` render detail JSON
  as structured key/value panes, `SettingsShell` collapses its rail to a
  chip row below 48rem shell width (the settings window stays wider).
  Full verify gate incl. exclusion-free axe scans green.
- **Prisma 6 → 7 migration** (Rust-free client): generator moved to
  `prisma-client` (output `src/generated/prisma`, CJS module format —
  the `binaryTargets` engine matrix is gone), SQLite access now runs
  through `@prisma/adapter-libsql` (N-API driver — the same prebuilt
  binary serves vitest under Node and the app under Electron, replacing
  better-sqlite3's per-ABI builds and the entire runtime query-engine
  discovery in `DatabaseService`). CLI config moved to
  `prisma.config.ts` with dotenv (v7 stops auto-loading `.env`;
  the datasource entry is conditional so generate/gensql work without
  `DATABASE_URL`, keeping CI green); `prisma:gensql` uses the renamed
  `--to-schema` flag; packaging drops the `*.node` engine
  extraResources. Bootstrap `schema.sql` regenerated byte-identical.
  Verified end-to-end under Electron's runtime (connect/DDL/query via
  the compiled dist client). Also clears the audit findings from the
  Prisma CLI's `mysql2` chain via an override.
- Dev-tooling majors: ESLint 9 → 10.10 (with typescript-eslint /
  `@typescript-eslint/*` 8.70, which support ESLint 10 — flat config
  needed no changes), concurrently 9 → 10, wait-on 8 → 9. Lint output
  unchanged (0 errors), full verify gate green.
- Routine in-range dependency refresh (`npm update`): LangChain stack
  patches (core 1.2.11, openai 1.5.13, anthropic 1.5.10, google-genai
  2.3.2, langgraph 1.4.15), Electron 44.4.1 (security patches), React
  19.3.0, lucide-react 1.46.0, vitest 5.0.1, tsc-alias 1.9.5,
  `@types/node` 24.13.5. Full verify gate green.
- Settings restructure: a new **Voice** page owns speech input
  (dictation behavior) and spoken replies (speak-replies toggle,
  voice, speed) plus a read-only assigned-models block for the STT/TTS
  tasks with a jump to API → Tasks. The API page now uses sub-tabs —
  `Providers | Models | Task Assignments` — replacing the stacked
  sections; all task assignments (including stt/tts) stay together on
  the Tasks sub-tab. VoiceSection became the VoiceTab page.
### Fixed
- Long tool-using turns (multi-step web investigations) no longer fail
  with "Recursion limit of 12 reached": the agent's LangGraph superstep
  budget rose from 12 to 25 (~12 tool rounds instead of 5), and the
  research flow derives its own budget (`RESEARCH_RECURSION_LIMIT`,
  built from `MAX_RESEARCH_ROUNDS` with a spare round of headroom)
  instead of sharing the agent constant. The per-turn token budget rose
  from 80k to 300k cumulative tokens, sized to bind around the 5-minute
  wall clock instead of cutting research-heavy turns short (modern
  models carry far larger contexts than the old spend guard assumed).
  All three budgets stay internal constants — no settings surface.
### Added
- Graceful limit degradation (plan 17 S1): turns that hit a budget —
  the agent's step limit, the cumulative token budget, or the 5-minute
  wall clock — no longer die with a raw framework error. Both runners
  synthesize one partial answer from the findings gathered so far
  (static honest line when there is nothing to salvage), the turn
  completes with an amber "partial answer" notice instead of the error
  banner, and the salvaged answer is persisted so follow-up questions
  work. Real provider/tool failures still fail loudly.
- History that fits (plan 17 S2): long conversations no longer push
  past the model's context window with a raw provider error. History
  is clamped (PDF text and per-message image caps) and windowed
  newest-first over whole turns to an internal token budget (weighted
  heuristic, no tokenizer dependency); the current turn is never
  trimmed, and a visible "Older context trimmed" trace step marks
  what the model no longer sees.

## [0.4.2] - 2026-09-16
### Changed
- The clipboard offer is now a composer toolbar button instead of a
  floating chip above the composer: it appears only when the clipboard
  changed since the last summon (poll-on-summon, main-gated by
  `behavior.clipboardWatcher`) and inserts the full clipboard text on
  click; the preview moved into the tooltip. Polling logic moved to a
  `useClipboardOffer` hook.
### Added
- (nothing yet)

## [0.4.1] - 2026-09-16
### Fixed
- First message in a conversation failed on Google providers with
  "System message should be the first one": recalled memories were
  injected as a second leading system message next to the agent's own
  system prompt, which Gemini rejects. The memory context block now
  composes into the single system prompt (`memoryContext` on the turn
  input); the non-graph fallback path keeps its valid system-first
  shape. Recalled-memory turns are provider-agnostic again.
### Added

## [0.4.0] - 2026-09-16
### Changed
- Speak clicks now react immediately: synthesis shows a "Preparing
  audio…" bar (plus a spinner on the clicked reply button, which
  disables until audio arrives) instead of nothing during the
  provider roundtrip — speech is now a tri-state
  (idle → loading → speaking) surfaced through the SpeechBar in both
  windows. The composer speak-selection button disables while loading.
- Speak selection moved from a floating chip into the composer toolbar:
  a speaker button appears next to the other composer actions while
  text is selected in the window (launcher + desktop). The chip's
  preview/dismiss row is gone — the selection is already visible in the
  composer, and `useWindowSelection` moved to its own module.
- The slash-command hint now lives in the composer placeholder
  ("Ask AI anything — / for commands") instead of a separate dismissible
  pill above the composer — one less floating row in the compact
  launcher, same visibility window (both only show for empty input).
  The palette still teaches Tab/Enter interactively once open.
### Fixed
- The packaged launcher hid itself whenever it lost focus ("clicking
  another window minimizes it"), regardless of settings: the
  click-away hide was gated on dev mode only and never consulted
  `behavior.hideOnBlur`, so the Settings → General toggle
  ("Hide the launcher when it loses focus", default off) did nothing.
  The hide is now opt-in through that toggle; dev builds still keep it
  off for DevTools usability.
### Added
- (nothing yet)

## [0.3.0] - 2026-09-16
### Added
- **Native Gemini TTS support.** GOOGLE-type providers with a Gemini
  TTS model (e.g. `gemini-3.1-flash-tts-preview`) assigned to the
  `tts` task now synthesize via the native `generateContent` API
  (`responseModalities: ['AUDIO']`) inside the sanctioned
  `src/main/ai/tts.ts` module — plain `fetch`, no new SDK imports.
  The raw PCM response is wrapped in a WAV container for playback
  (`audio/wav`); the app's OpenAI-style voices map onto Gemini's
  prebuilt voices (unknown names pass through verbatim) and speed is
  ignored on this path. Provider errors are normalized with their
  HTTP status so the compact error notice still works.
### Fixed
- Deflaked `tests/node-run-persistence.test.ts`: graph-node-run writes
  are fire-and-forget by design, so the test now polls the database for
  both rows (5 s budget) instead of assuming they landed once the turn
  `finished` broadcast arrived — it failed intermittently under
  full-suite parallel load.
- TTS playback was blocked and the speaking bar stuck forever: the
  chat window's CSP (`default-src 'self'`) rejected the
  `data:audio/wav` media URL, and a CSP-blocked media load fires no
  element events in Chromium so nothing ever settled the player. The
  chat entry CSP now carries `media-src 'self' data:` (settings and
  result-viewer stay strict), and `speechPlayer` gained a 10 s
  start-watchdog that settles playback which never begins. Also fixed
  a latent stop-latch bug in `speechPlayer.play` (the generation
  counter was captured before the internal `stop()` bumped it, so the
  playback promise could never resolve and the "Speaking…" bar never
  hid on natural end).
- TTS failures now surface as a compact notice in the UI instead of
  failing silently: `ai:tts-synthesize` rejects with a short
  status-mapped message (`compactTtsError` in `src/main/ai/tts.ts`,
  e.g. "model or endpoint not found (HTTP 404)" for provider SDK
  errors whose raw text is just "404 status code (no body)") and the
  renderer shows it via `TEXT.SPEECH_FAILED`.
### Added
- Docs for node telemetry & flows (plan 13 S7): architecture.md gains a
  "Node telemetry, traces & the research flow (plan 13)" section
  (stream-derived telemetry, `GraphNodeRun` persistence, the research
  graph and its explicit policy-gated interrupts);
  development.md explains how to read `resumed` in traces and
  persisted node timelines (checkpoint jumps vs fresh execution);
  ipc.md documents the `flow` fields on `ai:turn-start` and
  `commands:execute`; the README marks the still-owed on-target
  flow-UI screenshot with a placeholder note.
- **Research flow graph (plan 13 S6).** The one custom `StateGraph`:
  `plan → (search → fetch → assess)* → synthesize` with bounded rounds
  (max 3, family extraction-loop rule) and a 2-fetches-per-round cap,
  producing a cited report with per-source references. Nodes call the
  model factory + audit handler (`chat.research` task) and the
  registry's `web_search`/`web_fetch` tools directly
  (`schema.parse` → `exec`). Security: no HITL middleware on custom
  graphs — tool execution consults the policy engine explicitly
  (`decision`/`needsApproval` → LangGraph `interrupt()` with the same
  approval envelope), so approvals reuse the same ApprovalCard,
  60-second main-owned auto-deny and idempotent resume; a rejection
  cancels the flow cleanly ("Research cancelled — the fetch was
  denied."). Fetched content stays an untrusted observation in state
  and the synthesis prompt forbids following instructions inside it.
  Streaming rides the same `updates`/`messages` bridge — node
  telemetry (`plan`/`search`/`fetch`/`assess`/`synthesize` labels),
  FlowStatusCard rendering and `GraphNodeRun` rows (flow `research`)
  come free. Invoked via the `/research <topic>` builtin command
  (`flow: 'research'` on the turn request); without a wired runner the
  turn fails with a clear error instead of silently chatting.
- Node-outcome persistence (plan 13 S5, changelog repair): finished
  graph nodes land in the `GraphNodeRun` table (flow, thread, node,
  outcome, duration, resumed — 7-day prune riding the checkpointer
  boot prune) and the final node timeline persists in message
  metadata (`nodeTimeline`), so trace meta stays truthful after
  restart.
- Memory consolidation (plan 16 S2): Settings → Memories gains "Smart
  merge" (off by default) + a "Consolidate now" pass with a status
  line. On saves landing in the gray zone (similar but below the
  deterministic-dedupe threshold), a `plumbing`-task gateway call
  arbitrates keep-new/keep-old/merge; verdicts are zod-validated and
  any failure falls back to the deterministic path. Merged rows record
  the absorbed memory as provenance so the manager's undo restores
  both sides; user-sourced memories are never auto-deleted.
- Memory on the FTS5 search stack (plan 16 S1): `memory_search` and
  turn-start recall now run through a `Memory_fts` external-content
  FTS5 index (porter tokenizer, trigger-synced, boot rebuild
  self-heals drift) with bm25 ranking and the exact-match boost —
  finding stemmed matches the old LIKE path missed. The bounded LIKE
  path remains as the tested degradation fallback, a query timeout
  guarantees recall can never stall turn start, and injection caps are
  byte-identical.
- Tool-usage dashboard (plan 12 §7): Settings → Tools → Usage reads
  the tool_calls audit read-only — per-tool call counts, ok/error/
  denied splits, approval-source ratios, average durations and recent
  failures over a 7-day/30-day/all window; dependency-free CSS bars
  riding the shared motion tokens.
- `plumbing` task routing (plan 12 §7): the task registry gains an
  internal-helper assignment (cheap-model suggestion in the UI) used
  for title-ish work — titles prefer their own assignment, then
  plumbing — and future internal calls via `resolveInternalModel`
  (plumbing → chat-model fallback).
- Per-conversation personas (plan 12 §7): the desktop inspector gains
  a Persona field per conversation — composes after the provider
  system prompt with explicit precedence framing ("this conversation
  only"); the launcher keeps the global prompt. Persona survives
  restarts in conversation metadata.
- TTS replies (plan 12 §6): Settings → Voice gains "Speak replies"
  (off by default) with voice + speed options, and Settings → Models
  gains a `tts` task assignment (OpenAI-compatible `/audio/speech`;
  audio-capable models). When enabled, a finished assistant reply is
  stripped to speakable text (code blocks drop, links speak their
  label) and synthesized main-side through the sanctioned
  `src/main/ai/tts.ts` endpoint module — task-resolved, keyring
  secret, audited on the `tts` task. Playback uses HTMLAudio in the
  renderer with a `da-voice-wave` speaking bar (stop control) in both
  windows; hidden windows still speak, and completion notifications
  are unchanged. Explicit speaks — a "Speak reply" button on
  assistant replies (launcher done-state header + desktop message
  rows) and a "Speak selection" chip whenever text is selected in a
  window — bypass the auto-play toggle but still require the tts
  assignment; starting a new speak stops the current one.
- Local-docs index + `docs_search` (plan 12 §5): a granted folder can
  be opted into indexing (Settings → Tools → Document index) —
  markdown/text/PDF files are chunked into a `DocChunk` table mirrored
  into an external-content FTS5 virtual table via triggers (checkpointer
  precedent, raw-SQL bootstrap). Re-indexing is an mtime delta (edited
  files refresh, deleted files prune) and inherits the file tools'
  traversal rules (symlink-skip, junk prune, budgets). The read-only
  `docs_search` tool queries the index with sanitized prefix-term MATCH
  queries (FTS5 grammar cannot be injected) and returns bm25-ranked
  `path + snippet` passages. Embeddings stay deferred (D2).
- Command hotkeys (plan 12 §4 macro half): custom commands from
  Settings → Commands can be bound to spare global key combinations in
  Settings → Hotkeys. A bound command runs as a normal turn through the
  same command/policy path — approvals still apply — into a dedicated
  per-command conversation; results notify when windows are hidden.
  Bindings reject accelerators already taken (CommandOrControl-aware)
  and apply live on config save.
- Scheduled prompts (plan 12 §4): Settings → Automation lets you create
  schedules — every-N-minutes, daily-at, weekdays-at, or an advanced
  5-field cron — each with an explicit IANA timezone. A main-process
  scheduler (single timer wheel, injectable clock) fires prompts as
  normal assistant turns into a dedicated per-schedule conversation,
  runs once on boot when a run was missed (no catch-up burst), and
  queues behind an in-flight turn. DST boundaries are handled in the
  conversion math: fall-back overlaps fire on the first occurrence,
  spring-forward gaps fire at the shifted instant. The model cannot
  create or edit schedules (D4 — no schedule tools exist; a test pins
  it).
- File-artifact convention + renderer: tools that produce a file or
  folder append a machine-readable `[artifact]` marker line to their
  result; `TurnManager` extracts it main-side (never from model
  prose), persists it in the message metadata and ships it on the
  `finished` turn event. Both windows render animated artifact chips
  under the response — click opens the file via the new
  `system:open-path` IPC (exists + non-executable + files confined to
  granted roots, same rails as the `open_path` tool), folder icon
  reveals it in the file manager. `download_file` emits the marker.
- `download_file` tool (plan 12 §3 download loop): downloads a public
  http(s) file into a granted folder — optional destination path
  (editable on the approval card, missing path = first granted root +
  sanitized URL filename), collision-safe ` (2)` renaming, 50 MB cap
  (pre-checked via content-length, aborted mid-stream otherwise with
  partial-file cleanup), robots.txt respected, and an html
  content-type warning when the URL is a web page rather than a file.
- Live download progress: a main-process `DownloadTracker` mirrors
  byte progress onto the open `download_file` trace step over the
  turn envelope; both windows render an animated progress card
  (percent, speed, destination, cancel) reusing the shared motion
  tokens, and the cancel button aborts the transfer via the new
  `tools:cancel-download` IPC (partial file removed). Turn-level
  cancel aborts in-flight downloads too.
- Bind-time schema guard for Gemini: when the active provider is
  `google`, tool parameter schemas are scanned for keywords the native
  function-calling API rejects (`exclusiveMinimum`/`exclusiveMaximum`)
  and a warning names the offending tool + schema path — covers native
  zod tools and third-party MCP tools alike
  (`src/main/ai/tool-schema-guard.ts`).
### Changed
- `web_fetch` now shares the hardened SSRF guard with `download_file`
  (`src/main/ai/tools/net-guard.ts`): DNS-resolved pre-request checks
  (loopback/RFC1918/CGNAT/link-local/ULA/6to4 — not just literal
  hostnames), and redirects are followed manually so every hop is
  re-validated against the same rule (5-hop cap).
### Changed
- *(nothing yet)*
### Fixed
- `kill_process` tool schema no longer serializes as
  `exclusiveMinimum` (zod `.positive()` → `.min(1)`), which the Gemini
  native API rejected with a 400 "Unknown name" for the whole request.

## [v0.2.1] - 2026-09-10
### Added
- `.gitleaks.toml` allowlisting the two secrets-handling test fixtures,
  whose synthetic API keys (fake by design) tripped the default
  generic-api-key rule.
- Stable-name release download aliases (checksummed via
  `SHA256SUMS.txt`) so download links survive version bumps, plus
  `FUNDING.yml` (BMC-only).
### Changed
- README template rollout: direct download links, family wordmark
  colophon, community/security sections.
### Fixed
- Stable-name release aliases: globs now match electron-builder's raw
  space-bearing artifact names (dots only appear once action-gh-release
  sanitizes release asset names), unblocking the publish job.
