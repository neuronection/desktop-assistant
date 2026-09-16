# Changelog

All notable changes to this project are documented here. User-visible
changes land under `## [Unreleased]` in the same commit that introduces
them.

## [Unreleased]
### Added
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
