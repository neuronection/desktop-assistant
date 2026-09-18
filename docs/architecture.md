# Architecture

Desktop Assistant is an Electron application in three isolated layers,
plus a local SQLite store. This document describes the current state;
planned family migrations are marked explicitly.

## Process model

```
┌───────────────────────────── main process (Node) ─────────────────────────────┐
│ DesktopAssistant (src/main/DesktopAssistant.ts) — orchestrator                │
│ ├── WindowManager   frameless overlay + settings windows (src/main/window.ts) │
│ ├── TrayManager     tray icon + context menu (src/main/tray.ts)               │
│ ├── HotkeyService   global shortcuts (src/main/services/HotkeyService.ts)     │
│ ├── ipc-handlers    the IPC surface (src/main/ipc-handlers.ts)                │
│ └── services/                                                                │
│     ├── ConfigService        config.json + window-state.json (userData)       │
│     ├── DatabaseService      Prisma client (libsql adapter) + schema bootstrap   │
│     ├── ConversationService  conversation CRUD/listing                        │
│     ├── MessageService       messages + turn-trace persistence              │
│     ├── MemoryService        persistent assistant memory (Memory table)     │
│     ├── AIService            one-shot LLM chat + thin delegator to aiGateway
│     │                        (chat) and ai/catalog (provider model listing) │
│     ├── SttService           speech-to-text; resolves the `stt` task   │
│     │                        assignment (audio-capable registry model)  │
│     │                        to provider endpoint + keyring secret       │
│     └── AttachmentService    PDF parsing, screen captures                     │
└──────────────────────────────────────────────────────────────────────────────┘
        ▲ typed IPC (contextBridge)                          ▲
┌───────┴──────── renderer: chat overlay ─────────┐ ┌────────┴ renderer: settings ────────┐
│ src/renderer/index.html + chat-react/           │ │ src/renderer/settings.html          │
│ React 19 + Tailwind v4 + assistant-ui:          │ │ React 19 + Tailwind v4 +            │
│ ChatPanel (bubble) + ChatTranscript +           │ │ @neuronection/assistant-ui          │
│ MarkdownSurface + Composer; live turn via       │ │ (settings-react/: SettingsShell,    │
│ chat-core useChatStream over the IPC transport  │ │ ProviderForm; theme via --as-*      │
│ (chat-react/ipcTransport.ts); sessions via      │ │ token re-maps)                      │
│ ChatSessionList; app glue: ConversationManager, │ │                                     │
│ RecordingManager, ThemeManager                  │ │                                     │
└─────────────────────────────────────────────────┘ └─────────────────────────────────────┘
```

## Security model

- Renderer processes run with `contextIsolation: true`,
  `nodeIntegration: false`; production adds `sandbox: true`
  (`src/shared/constants/window.ts`). `src/preload/preload.ts` is the only
  bridge — it exposes a typed, enumerated API; channels are not
  free-form strings from the renderer. Windows deny popups
  (`setWindowOpenHandler`) and out-of-origin navigation
  (`will-navigate` guard); both HTML entries carry a CSP meta
  (`default-src 'self'`, inline styles only), and the chat entry adds
  `media-src 'self' data:` for TTS playback of main-synthesized audio
  (base64 data URLs only — no network origins). In dev, Vite rewrites that
  meta to a relaxed variant (inline/eval scripts + HMR socket) via the
  `devCspRelax` plugin — the committed policy stays strict and is what
  production ships.
- **Secrets live only in OS-protected storage** (`SecretService`,
  Electron `safeStorage`: DPAPI / Keychain / libsecret). Encrypted
  values persist in `secrets.json` under userData; `config.json` and the
  SQLite DB never contain key material (providers keep only a masked
  `apiKeyHint`). Legacy plaintext keys migrate to the keyring on first
  load; if the OS backend is unavailable the service fails closed (new
  keys are discarded with an error, never written in plaintext). The
  renderer can write a key but can never read one back — it talks to
  STT/AI only through IPC, so no secret crosses into the untrusted
  process.
- Model output is treated as untrusted input: markdown is parsed
  (marked + highlight.js + KaTeX) and sanitized (DOMPurify) before
  rendering (`src/renderer/utils/markdownParser.ts`).

## Persistence

- SQLite via Prisma 7 (driver-adapter mode, `@prisma/adapter-libsql`);
  the client is generated into `src/generated/prisma`
  (`npm run prisma:generate`) and is not committed.
- The database file lives in the OS user-data directory
  (`<userData>/conversations.db`); the datasource URL is set
  explicitly at runtime (`DatabaseService`) — the app never depends on
  `.env` at runtime (that file only serves Prisma CLI commands).
- Schema changes flow through `prisma/schema.prisma`; the runtime
  bootstrap uses the flattened `src/main/resources/schema.sql`
  (`npm run prisma:gensql`).
- **Memory** (`Memory` table, plan 12 §1): persistent assistant memory
  rows (content, `user|assistant` source, tags, optional conversation
  link) managed by `MemoryService`. Save-path dedupe is deterministic —
  normalized-content equality or char-trigram similarity ≥ 0.82 merges
  into the existing row (no model involvement). Search is keyword/LIKE
  with occurrence ranking; `recall()` caps injection at 3 memories /
  600 chars. Memory contents never enter logs, exports, or message
  rows.
- **Command history** (`CommandInvocation` table, plan 14 §1):
  every executed command (palette, agent, hotkey) is recorded in
  `CommandService` at execution time — `commandId`, `kind`, `source`,
  `outcome`, and argument values for read-only builtins only
  (state-changing tools record the command id + outcome, never argv —
  the `ToolCall` audit keeps its arg hashes). Boot-time retention
  prune (`commands.history.retentionDays`, default 90) mirrors the
  checkpointer prune; the table feeds recency/frequency ranking for
  the command palette.
- **App discovery** (plan 14 §3): `AppDiscoveryService` scans the
  per-OS app sources once lazily — XDG desktop entries + flatpak/snap
  (`gtk-launch`), macOS `.app` bundles (`open -a`), Windows Start-Menu
  `.lnk` trees (`cmd /c start` on the resolved target) — cached in
  memory with directory-mtime freshness and rescanned on demand.
  `NoDisplay`/`Hidden` entries never surface. Icons resolve lazily to
  raster-only data-URLs (SVG/XPM rejected — script-vector risk);
  everything else renders a deterministic monogram tile in the
  renderer.   `config.commands.apps.launchEnabled` is the master switch;
  `hiddenApps` removes individual entries; per-app agent scope rides
  the shared `agentCallable` map.
- **Custom commands & integration packs** (plan 14 §5): user-defined
  commands live in `commands.custom` (tool wrappers with `{{1}}`/`{{query}}`
  placeholder templates bound to a catalog tool, or named prompts) and
  third-party packs in `commands.integrations` — declarative
  `integration.json` manifests (version 1, zod-validated at import AND
  boot; a pack that fails re-validation self-disables with a surfaced
  reason and never blocks boot). Pack `http` commands substitute argv
  into URL/body templates and resolve `${secret:…}` header refs from
  the keyring at call time — secret values transit main→keyring only
  and never persist in config or logs. Tool wrappers always execute
  through the direct-tool turn path (approval cards apply); alias
  shadowing is deterministic — builtins outrank customs, and custom
  aliases colliding with reserved builtin names are rejected at save.
- **Agent bridge** (plan 14 §7): commands the user explicitly opts in
  (`commands.agentCallable`, default off) become LangChain tools via
  `src/main/ai/tools/command-tools.ts` — synthesized zod schemas,
  `command_*`-prefixed names, and descriptions from the command's
  title/use case/argument docs. They merge into the agent graph
  alongside native and MCP tools and flow through the same policy
  engine: risk maps at the seam (apps and http are `state-changing`;
  wrappers inherit their bound tool's risk; destructive and
  kill-switched entries never bridge; prompt and builtin kinds are
  not bridgeable), so approval cards fire before execution exactly as
  for native tools. Execution returns through `CommandService` so
  history records `source: 'agent'`; the model observes the same
  result text the palette would.

## AI access (family standard, ADR-0008)

Model I/O goes through the app's AI layer in `src/main/ai/` — nothing
outside it imports provider SDKs or LangChain model classes (enforced by
`scripts/check-ai-alignment.sh --self --mode strict` in CI):

```
src/main/ai/
├── chat-models.ts  # model factory — the ONLY @langchain/openai import;
│                   #   one openai_compatible path (configuration.baseURL)
│                   #   covers OpenAI/Groq/Together/Fireworks + local Ollama
├── gateway.ts      # resolve → invoke/stream → audit; injectable model
│                   #   factory + audit sink for tests
├── audit.ts        # every LLM call → the AiCall table; every tool call →
│                   #   the ToolCall table (args hash, outcome, duration,
│                   #   approved_by) — audited over invisible
├── tool-schema-guard.ts # bind-time scan of tool schemas for keywords the
│                   #   Gemini function-calling API rejects (warn-only,
│                   #   names tool + schema path before the 400 would)
├── checkpointer.ts # Prisma-backed LangGraph checkpointer: agent state
│                   #   persists in the app DB (resume after approval /
│                   #   restart), idempotent setup + age-based pruning
├── stt.ts          # narrow exception: Whisper-compatible transcription
│                   #   endpoint (not covered by LangChain) + transcript
│                   #   sanitization (no-speech results become null,
│                   #   never chat messages)
├── translate.ts    # plan 19: service engines (DeepL/LibreTranslate —
│                   #   sanctioned non-chat endpoints, audited on the
│                   #   `translate` task like tts.ts) + the LLM engine
│                   #   prompt/normalizer; engine dispatch lives in
│                   #   services/TranslateService (mode: auto/service/llm)
├── decide/         # plan 20 decision engines (optional, default OFF):
│                   #   intent routing + tool dispatch as a sibling
│                   #   capability — never a chat replacement. index.ts
│                   #   is the funnel (resolve engine → invoke → audit
│                   #   on the `intent` task → confidence band
│                   #   act/confirm/refuse; every non-decided status
│                   #   falls through to the standard agent path),
│                   #   llm.ts is the structured-output engine over the
│                   #   factory seam (createStructuredChatModel),
│                   #   tool-surface.ts projects the executable tools
│                   #   (native zod→JSON + app MCP params, capped at 40)
│                   #   into the engine-neutral schema, and needle/ is
│                   #   the local engine (ADR-0019): pinned vendored
│                   #   wasm runtime under resources/needle/ (host.cjs +
│                   #   host-core.cjs + needle.js/.wasm, Apache-2.0,
│                   #   revision+sha256 pinned in pins.ts), a
│                   #   utilityProcess transport (serialized ops, per-op
│                   #   timeout, crash isolation), a weights manager
│                   #   (userData/needle/needle3.cact — user-initiated
│                   #   35 MB download, size+sha256 verified, atomic
│                   #   rename, offline afterwards), and zod-validated
│                   #   output parsing (unknown tool names are errors,
│                   #   never silent drops)
├── tools/          # tool layer: registry (merge/namespacing/caps),
│   │               #   policy engine (risk × grants × kill switch),
│   │               #   native/ catalog (Tier A read-only + Tier B
│   │               #   state-changing + Tier C destructive; categories
│   │               #   files/system/desktop/network/power/memory),
│   │               #   mcp.ts (MCP servers: stdio/HTTP/SSE adapters,
│   │               #   lazy connect, health/backoff, caps)
└── graphs/
    ├── assistant.ts # the tool agent: `createAgent` (langchain v1) with
    │                #   checkpointer, HITL approval middleware, step/
    │                #   token/wall-clock caps, graceful limit salvage
    └── research.ts  # the one custom StateGraph (plan 13): research flow
                     #   with bounded rounds, explicit policy-gated
                     #   interrupts, per-source references
```

`AIService` (services/) is a thin caller: resolves the provider + keyring
key, then delegates to `aiGateway.chat()`. Provider model-catalog
fetching lives in the AI layer (`ai/catalog.ts`, ADR-0018): the
per-provider branches (OpenAI-compatible `/models`, Anthropic, native
Gemini, Ollama tags) are the sanctioned non-chat-endpoint surface, keyed
at call time like `tts.ts`. `AIService.fetchAvailableModels` only
checks key presence and delegates. Streaming chat is owned by the
**main process** through `TurnManager` (`src/main/turns/`): a turn starts
via `ai:turn-start` (main persists the user message — creating the
conversation on first message — builds the model history from the
database, and streams through the gateway). When a decision engine is
enabled (plan 20, default OFF), a short plain input with no attachments
first tries the decision funnel (`ai/decide/`): a single-call, non-refuse
result dispatches through the same direct-tool path as slash commands
(same policy + approval machinery, no model call; the 'confirm' band
forces the approval card, provenance lands in message metadata) — every
other outcome falls through to the normal turn unchanged. Phase events
(`queued → thinking → [tool_call/tool_result/interrupt] → streaming →
finished/failed/cancelled`) broadcast to **every window** over
`ai:turn-event`, so streaming survives window hide and handoff. Terminal
phases broadcast only **after** the assistant message is persisted —
renderers re-read the transcript on those events and must always see the
final rows. The final assistant message is persisted with a `metadata`
trace (outcome, model, duration, steps — `TurnTraceStep[]`);
`ai:turn-cancel` aborts mid-stream and keeps the partial text. Renderers
map the envelope onto the family `ChatStreamEvent` vocabulary
(`chat-core`'s `useChatStream`) via an IPC transport.

**Limit degradation (plan 17 S1):** when a budget binds mid-turn —
LangGraph's recursion limit, the cumulative token budget
(`TurnBudgetError`), or the wall clock — the turn degrades to the best
available answer instead of a raw error. Both runners catch the typed
limit errors and make ONE bounded salvage synthesis call over the
turn's collected tool findings/streamed text (audited under the same
task; static honest line via `TEXT` when there is nothing to
synthesize or the salvage call fails). The wall-clock salvage runs in
`TurnManager` through the runner's `salvage()` seam under a 15 s grace
window, one attempt, never on user cancel. Limit outcomes persist as
`outcome: 'ok'` with a `limitNotice` (`step-budget | token-budget |
time-budget`) riding both the persisted metadata and the `finished`
turn event; renderers show it as an amber in-flow `info` notice —
never the error banner, and never the words "recursion limit". Real
provider/network/tool failures keep the loud `failed` path. The budget
values themselves stay internal constants (no settings surface).

**History that fits (plan 17 S2):** before the model history reaches a
runner, `TurnManager` shapes it through `src/main/turns/history.ts`:
attachment clamps (PDF extracted text capped at
`PDF_HISTORY_CHAR_CAP` with the standard `…[truncated N chars]`
marker, per-message images capped at `MAX_HISTORY_IMAGES` — history
path only, raw storage untouched) plus `fitHistory`, a pure
newest-first window that groups messages into turns and keeps the
largest suffix fitting `HISTORY_TOKEN_BUDGET` (100k heuristic tokens,
internal constant). The final group — the current turn's user input —
is never dropped; the suffix rule means dropping an oversized middle
turn necessarily drops everything before it, and the clamps bound any
single group. Token counts come from a CJK-aware weighted heuristic
(`estimateTokens`), not a tokenizer dependency (plan 17 D10 — the app
is multi-provider, so tokenizer "precision" only exists for OpenAI;
the safety net needs ±30 %). When anything was dropped, the turn trace
stamps a visible "Older context trimmed" step, so the model's blind
spots are legible in the TraceStrip. Both the graph path and the
non-graph streaming fallback get fitted history.

**Memory recall injection (plan 12 §1):** before the model history is
built, `TurnManager` asks `TurnManagerMemories.recall(query)` (wired to
`MemoryService.recall`) for top keyword-matched memories and prepends a
synthetic `system` message (`[Memory context] …`, never persisted) to
the turn history; a completed "Context — N memories recalled" trace
step marks the injection in the TraceStrip. Injection and the
`memory_save` binding are gated on `behavior.memoryContext`
(Settings → General, default on): with the toggle off the synthetic
message disappears and the runner's `toolFilter` keeps memory tools
from binding to the agent (the system-prompt memory note keys off the
bound tool names, so it disappears with them). Recall is fail-soft —
a memory-store error never fails the turn — and direct-tool turns skip
it entirely.

On the agent path, turn phases are derived from **node-level graph
telemetry** (plan 13): `node_started` / `node_finished` events with
stream-derived names, outcomes, durations and a `resumed` flag ride the
same `ai:turn-event` envelope and back the trace steps — details,
persistence and the custom research flow live in
"Node telemetry, traces & the research flow (plan 13)" below.

### Agentic execution & approvals (plan 11)

When tools are configured, turns run through the agent graph
(`src/main/ai/graphs/assistant.ts`) instead of the plain gateway stream:

- **Policy engine** (`tools/policy.ts`): a tool call runs, needs
  approval, or is denied = risk class × verification settings ×
  persistent "always" grants (`config.tools.toolGrants`, non-secret)
  × in-memory session grants × per-tool kill switch
  (`config.tools.disabledTools`). Read-only tools auto-run;
  state-changing tools need approval unless granted;
  **destructive tools (Tier C) are confirmed every single call —
  verification overrides, class defaults, and grants never bypass it**
  (ADR-0011).
- **Verification defaults, three layers** (`tools/policy.ts`
  `resolveVerification`): per-tool override
  (`config.tools.toolSettings`) → class default
  (`config.tools.classDefaults`: read-only `run`/`always_ask`,
  state-changing `standard`/`never`/`always_ask`) → built-in standard.
  Class defaults are set from the Tools tab (with one-click presets:
  Cautious / Trusted workspace / Fully manual) and apply to built-in
  tools only — MCP tools (`mcp__…` prefix) always keep their own
  settings, so a preset can never silently auto-run unvetted
  third-party code. Per-tool modes: `standard` follows the class
  default; `always_ask` forces confirmation even for read-only or
  granted tools; `conditions` asks only when a rule matches the call
  arguments (parameter × operator: present/absent,
  equals/contains/gt/lt/matches — any matching rule asks, no match
  runs silently); `never` auto-runs every call. The interrupt
  middleware's `when` predicate receives the tool-call args, so
  conditional verification is enforced per call. Silent
  policy-authorized runs audit as `approved_by='policy'` in the
  `ToolCall` table. `power_lock`/`power_sleep` are state-changing
  (reversible); `power_restart`/`power_shutdown` stay destructive.
- **Tier C tools** (`run_shell`, `power_*`, `file_delete`,
  `kill_process`): shell runs batch-only with cwd confined to granted
  roots, a scrubbed minimal env, 10 s default / 60 s hard-cap timeout
  and capped output; destructive calls are serialized by the registry
  (never parallel, approved per call even when batched);
  `file_delete` is trash-first; `kill_process` refuses PID 1 and the
  assistant itself.
- **Image tool results** (`screen_capture`): tools return data-URL
  image blocks; the registry converts them to base64 data blocks
  (`{ type: 'image', source_type: 'base64', … }`) before they become
  tool messages — the only shape every provider package translates
  for tool-role content (OpenAI Chat Completions 400s on raw
  `type: 'image'` parts). Oversized images (>800k chars) are dropped
  with a note instead.
- **Tool-result viewer + recall**: full tool results never ride the
  turn-event bus — the agent's `tool_results` event carries the
  untruncated content main-side only, and `TurnManager` writes it
  through to the durable store (`ToolResultService`): metadata in the
  `ToolResult` table, images as files under
  `<userData>/tool-results/` (pruned by age on boot, 7-day default),
  with a small in-memory L1 cache in front. The broadcast step just
  gains a `hasImages` hint. The renderer shows a "View screenshot"
  chip under the trace timeline; clicking opens the frameless
  result-viewer window (`result-viewer.html`, third vite entry) which
  fetches the result over `tools:get-result` and renders text
  (copyable) plus images with zoom/pan and a thumbnail strip — works
  across app restarts. Tool output is untrusted: images render as
  `<img>` data URLs only, never as HTML. The same store feeds the
  **model**: each turn's system prompt lists the conversation's
  image-bearing results (`buildRecallIndex`), and the read-only
  `recall_screenshot` tool loads one back into the agent loop on
  demand — so "look again at that screenshot" works in later turns
  without re-uploading every image every turn.
- **Approvals** use the LangChain `humanInTheLoopMiddleware`: the graph
  pauses with an `interrupt` phase (typed payload: requests + auto-deny
  deadline), broadcast to every window. Either window resolves the card
  (`ai:turn-resume`); resolution is idempotent (second responder =
  no-op), cancel-during-approval counts as deny, and main auto-denies
  after 60 s. "Allow once / this session / always" map to approve,
  session grant, persistent grant. Agent state persists in the app
  database via the Prisma-backed checkpointer (`ai/checkpointer.ts`),
  so a turn paused at an approval survives hide/reopen and app
  restarts; checkpoints are pruned by age on boot.
  rows. Memory tools ride this stack: `memory_save`/
  `memory_forget` are state-changing (class-default approval),
  `memory_search`/`memory_list` are read-only; per-tool verification
  overrides and the kill switch apply like any other tool. The
  **Memories manager** (Settings → Tools, `MemoriesManager`) lists/
  searches/deletes the same rows over the `memory:*` IPC channels with
  an undo bar on delete (re-created through the save path, so dedupe
  still applies).
- **Download loop** (`tools/native/download-file.ts`, plan 12 §3):
  `download_file` completes `web_search → web_fetch → keep it` — a
  state-changing, `editableArgs` files tool confined to the granted
  roots via `pathArgs` (missing path → first granted root + sanitized
  URL basename; collisions suffix ` (2)` instead of overwriting). It
  rides the shared SSRF guard (`tools/net-guard.ts`, also used by
  `web_fetch`): http(s) only, no embedded credentials, hostname
  blocklist (localhost/metadata/.local/.internal), literal-IP +
  DNS-resolved pre-request check against loopback/RFC1918/CGNAT/
  link-local/unique-local/6to4, robots.txt respected, and redirects
  followed **manually** so every hop is re-validated (5-hop cap).
  Transfers stream to disk under a 50 MB cap (content-length refused
  up front, streams aborted and the partial file removed when the
  cap is exceeded mid-body), with an html content-type warning for
  "URL was a web page, not a file". Live progress flows through the
  `DownloadTracker` singleton (`tools/downloads.ts`): the tool
  reports bytes, `TurnManager` mirrors them onto the open
  `download_file` trace step (`TurnStepProgress` over the normal
  turn envelope), and the renderer's animated `DownloadCard` (both
  windows, compact + rich variants riding the D7 motion tokens)
  shows percent/speed/destination with a cancel button that calls
  `tools:cancel-download` → tracker `abort()` → partial file
  removed. Turn-level cancel aborts all in-flight downloads too.
- **File-artifact convention** (`shared/artifacts.ts`): tools that
  produce a file or folder append a machine-readable `[artifact]`
  marker line as the LAST line of their result text (`download_file`
  starts; `file_create`/`file_write`/`file_move` can follow).
  `TurnManager` extracts the marker main-side from the untruncated
  result (never from model prose — model output is untrusted and a
  marker only comes from tool exec code), persists it in the message
  metadata and ships it on the `finished` turn event. The renderer's
  `ArtifactChips` (both windows, live + persisted rows) shows name/
  size/type-icon chips: clicking opens via `system:open-path` —
  main-side re-validation mirrors the `open_path` tool rails (exists,
  executables refused, files confined to granted roots) — and a
  folder-open action reveals the item via
  `system:show-item-in-folder`.
- **Scheduled prompts** (`services/ScheduleService.ts` + `shared/schedules.ts`,
  plan 12 §4): rows in the `Schedule` table hold a prompt, a spec
  (`interval` / `daily` / `weekly` / 5-field `cron`), an explicit IANA
  timezone and a dedicated conversation created on first fire.
  Next-run math is pure and injectable-clock-tested: wall↔UTC
  conversions resolve fall-back overlaps to the first occurrence and
  spring-forward gaps to the shifted instant, so "daily 09:00" stays
  09:00 wall across DST. A single-timer wheel fires due schedules
  (overdue = fire once, never a catch-up burst), queues behind a busy
  TurnManager (2 s poll, capped), and results land as normal turns +
  the standard completion notification. **D4:** the model can invoke
  nothing here — schedules are user-authored in Settings → Automation
  and no schedule tools are registered (test-pinned).
- **Command hotkeys** (plan 12 §4 macro half): custom commands
  (`config.commands.custom`) bind to spare global accelerators
  (`config.commands.commandHotkeys`, edited in Settings → Hotkeys with
  CommandOrControl-aware collision rejection). `HotkeyService`
  registers them alongside action hotkeys (duplicates skipped) and the
  runner (`services/commandHotkeyRunner.ts`) executes through the same
  `CommandService.execute` path as the palette with `source: 'hotkey'`
  — 'turn' outcomes start real turns via the TurnManager in a
  dedicated per-command conversation (created once, persisted in the
  binding), approvals and the kill switch fully apply; 'done'/'error'
  outcomes notify like background completions. Bindings re-register
  live on config save.
- **Local-docs index** (`services/DocsIndexService.ts`, plan 12 §5):
  granted roots opted in via Settings → Tools are walked with the file
  tools' traversal rules (`walkRoot`: symlink-skip, junk prune,
  budgets) and chunked (~1200 chars, paragraph-aware with overlap) into
  the `DocChunk` table; triggers mirror chunks into an external-content
  **FTS5** virtual table (`DocChunk_fts`, porter+unicode61 tokenizer) —
  raw-SQL bootstrap in `setup()`, checkpointer precedent. PDF text
  rides `pdf-parse`. Re-index is an mtime delta (edits refresh,
  deletions prune; unchanged files skipped). The read-only
  `docs_search` tool converts natural-language queries into sanitized
  prefix-term MATCH queries (user input can never reach FTS5 query
  grammar) and returns bm25-ranked `path + snippet()` passages.
  Embeddings remain deferred per D2 — FTS is the store, semantic is at
  most a future ranking signal.
- **TTS replies** (`ai/tts.ts` + `services/TtsService.ts`, plan 12
  §6): speaking is opt-in twice — Settings → Voice "Speak replies"
  (off by default) **and** a `tts` task assignment (audio-capable
  models). Synthesis rides the sanctioned non-chat endpoint module
  (the STT precedent): OpenAI-compatible `/audio/speech`, with a
  native second flavor for `LLMProviderType.GOOGLE` providers —
  Gemini TTS models (`gemini-*-tts`) go through `generateContent`
  with `responseModalities: ['AUDIO']` and the raw PCM response is
  wrapped in a WAV container before playback (speed is ignored on the
  Gemini path; the app's OpenAI-style voices map onto Gemini's
  prebuilt voices, unknown voice names pass through verbatim). Both
  flavors use the keyring secret at call time and are audited on the
  `tts` task. Failures reject the IPC call with a compact
  status-mapped message (`compactTtsError`) that the renderer shows
  as a notice. The renderer strips
  the reply to speakable text (`speechText.ts`: code blocks drop,
  links speak their label, URLs/emoji go) and plays it with HTMLAudio;
  a `da-voice-wave` speaking bar with a stop control renders in both
  windows, and hidden windows still speak — completion notifications
  are unchanged. Explicit speaks bypass the toggle: a "Speak reply"
  button on assistant replies (launcher done-state header + desktop
  message rows) and a "Speak selection" chip whenever text is selected
  in a chat window — both route through `speakText` (toggle not
  required, `tts` assignment still is); starting a new speak stops the
  current one. Streaming TTS intentionally deferred (provider
  support is not clean across the registry).
- **Ops & observability** (plan 12 §7): `tools:usage-stats`  (`ai/audit.ts` `getToolUsageStats`) aggregates the `tool_calls`
  audit read-only — per-tool totals, ok/error/denied, approval-source
  ratios, average durations, recent failures — over a 7/30-day or
  all-time window; Settings → Tools → Usage renders it as
  dependency-free CSS bars on the shared motion tokens. The `plumbing`
  task adds an internal-helper slot (`resolveInternalModel`: plumbing
  → chat fallback); titles prefer their own assignment, then plumbing.
  **Per-conversation personas**: the desktop Inspector edits a
  `systemPrompt` in conversation metadata; `TurnManager` passes it to
  the agent as `systemPromptOverride`, composed after the provider
  prompt with explicit precedence framing — the launcher has no
  persona UI and keeps the global prompt.
- **Memory on FTS5** (`services/MemoryService.ts` + `services/fts.ts`,
  plan 16 S1): `Memory_fts` is an external-content FTS5 virtual table
  over `Memory` (porter unicode61) kept in sync by
  insert/update/delete triggers; `setup()` bootstraps idempotently and
  runs `rebuild` so rows written before the triggers existed (or after
  any drift) self-heal each boot. `memory_search` and turn-start
  recall run sanitized MATCH queries (`buildFtsQuery`, shared with the
  docs index) ranked by bm25 with the exact-normalized-match boost;
  the bounded LIKE path remains as the tested degradation fallback and
  a 250 ms query timeout guarantees recall can never stall turn start.
  Save/dedupe semantics are unchanged (deterministic; plan 16 S2 adds
  opt-in model arbitration on top).
- **Memory consolidation** (`services/MemoryConsolidationService.ts`,
  plan 16 S2): with `memory.smartMerge` enabled (off by default), a
  save that lands in the gray zone — trigram similarity
  `[MERGE_ZONE_MIN, 0.82)`, too similar to ignore, too different to
  auto-merge — arbitrates through one `plumbing`-task gateway call.
  Verdicts (`keep_new`/`keep_old`/`merge`) are zod-validated; any
  failure (model error, unparseable JSON, no model assigned) falls
  back to the deterministic path, so saves can never fail because of
  the model. Merged rows absorb the losing row's full text as
  `mergedFrom` provenance, which is what makes the Memories manager
  undo restore both sides; user-sourced memories are never auto-
  deleted. The on-demand "Consolidate now" pass scans gray-zone pairs
  (≤ 20 per run, 60 s cooldown) and reports merged/kept counts.

### Node telemetry, traces & the research flow (plan 13)

- **Node-level telemetry** (S1–S4): turn phases on the agent path are
  derived from graph-node events, not inferred from message kinds. The
  bridge (`graphs/assistant.ts`) emits `node_started`/`node_finished`
  from the LangGraph stream itself — node names are the stream's
  `updates` keys / `langgraph_node` metadata at runtime (real names:
  `model_request`, `tools`, HITL middleware nodes), a label registry
  maps known nodes to display labels and falls back to the raw name,
  so library upgrades can't silently break the trace. A node opens at
  first evidence and closes at the next boundary / interrupt / error /
  stream end — durations are real execution windows; a node starting
  while tool steps are open is the executor window (its events are
  suppressed from the envelope and it stamps the closing tool steps).
  Checkpoint replays after an approval resume carry `resumed: true`
  (the replayed node re-runs WITHOUT re-calling the model) and the
  renderer trace store merges the replay into the prior step — rendered
  once, never double-counted. Node payloads carry names/outcomes/
  durations only — never raw tool payloads.
- **Node persistence** (S5): every finished node execution lands in the
  `GraphNodeRun` table (flow, threadId, node, outcome, durationMs,
  resumed — pruned by age on boot, riding the checkpointer prune), and
  the final node timeline persists in the assistant message's
  `metadata.nodeTimeline` (with per-node tool counts), so trace meta
  stays truthful after restarts and the plan-12 usage dashboard gains a
  per-node aggregation (`getGraphNodeRunStats`).
- **The research flow** (S6) is the one genuinely-custom `StateGraph`
  (`graphs/research.ts` — branching + bounded loops, not a tool agent):
  `plan → (search → fetch → assess)* → synthesize` with at most
  `MAX_RESEARCH_ROUNDS = 3` rounds and `MAX_FETCHES_PER_ROUND = 2`
  fetches per round, ending in a cited report with per-source
  references. Nodes call the model factory + audit handler
  (`chat.research` task) and execute the registry's
  `web_search`/`web_fetch` tools directly (`schema.parse` → `exec`).
  **Custom graphs have no HITL middleware**: each node consults the
  policy engine explicitly (`decision()` — a disabled tool hard-fails
  the turn — then `needsApproval()`) and raises a batched
  `interrupt({ actionRequests, reviewConfigs })` for the whole round's
  approval-worthy calls, so the SAME ApprovalCard, 60-second main-owned
  auto-deny and idempotent resume apply; any rejection sets
  `state.rejected`, routes to END and the turn ends cleanly with
  "Research cancelled — the fetch was denied." Resume mirrors the
  assistant graph: `Command({ resume: { decisions } })` on the same
  thread. Fetched content is an untrusted observation: it lands in
  `findings` state and the synthesis prompt forbids following
  instructions inside it. The runner satisfies the `AssistantRunner`
  interface, so node telemetry, the FlowStatusCard, trace steps,
  `GraphNodeRun` rows (flow `research`) and budget enforcement
  (`AGENT_LIMITS` recursion/token — research derives its own
  `RESEARCH_RECURSION_LIMIT` from the round cap since the shared agent
  value left no headroom; wall clock stays TurnManager-owned; limit
  errors degrade gracefully per plan 17 S1)
  work unchanged. It is invoked via the `/research <topic>` builtin —
  `TurnStartRequest.flow: 'research'` routes the turn to it (a missing
  runner fails the turn honestly instead of silently chatting). State
  note: a LangGraph channel cannot share a node's name, so the plan
  channel is `planText`; a `messages` channel (append reducer) carries
  node tool I/O through the standard `updates` bridge.

### Desktop awareness (plan 12 S2)

- **Window/process/media tools**: `window_list`, `active_window`,
  `process_list`, `media_controls` follow the `power.ts` D3 pattern —
  pure per-OS invocation matrices + pure parsers, unit-tested with
  fixtures and PATH-shimmed fake binaries; a missing helper
  (`wmctrl`, `xdotool`, `playerctl`, …) degrades to a short "not
  available on this system (needs X)" result, never a crash. Windows
  media control degrades honestly (SMTC needs a native helper).
- **`screen_capture` modes**: optional `region` (scale-factor-aware,
  clamped crop) and `windowName` (best-effort `desktopCapturer` match;
  misses list available windows, empty thumbnails degrade).
- **Selection & clipboard context** (`DesktopContextService` +
  `ContextChips` in the launcher): "Use my selection" simulates a copy
  keystroke **only on explicit click**, reads the clipboard, then
  restores the prior contents. The clipboard chip is opt-in
  (`behavior.clipboardWatcher`, off by default) and compares a hash of
  the clipboard **poll-on-summon only** — no background surveillance,
  no content persisted. Wayland verdict (recorded): clipboard
  change detection works (Electron clipboard API), but selection
  capture is impossible without global keystroke injection, so the
  selection chip is hidden there.

- **Granted roots** (`config.tools.grantedRoots`): file tools  (`list_dir`, `read_file`, `file_write`, `file_create`, `file_move`,
  `find_files`, `grep_files`)
  resolve every path against user-granted roots picked via the OS
  folder picker (`tools:pick-root`); traversal outside a root is
  rejected. The search pair scans granted roots by name glob
  (`find_files`) or content regex (`grep_files`) with symlink
  skipping (a link is the one escape hatch from confinement),
  dependency-folder pruning (node_modules, .git, dist…), a binary-file
  guard, and file-count/time budgets so huge trees degrade gracefully.
  **The user never has to pre-pick folders**: confining tools declare
  their path args (`pathArgs`); when a call targets a path outside the
  granted roots, the policy engine turns it into a HITL access
  request — the approval card names the folder (the nearest existing
  ancestor of the path; the filesystem root is never proposed) and
  offers the usual scopes: once/session (in-memory roots) or Always
  (persisted into `config.tools.grantedRoots`, visible and removable
  in Settings → Tools). Grants are recorded before the turn resumes,
  so the retried call succeeds; denying surfaces the denial to the
  model. The system prompt tells the model about this loop.
- **MCP servers** (`tools/mcp.ts`): servers add tools over stdio,
  streamable HTTP, or SSE via `@langchain/mcp-adapters`; one isolated
  client per server, lazy connect, reconnect with backoff, per-server
  timeout/concurrency caps. Tools are namespaced
  `mcp__<server>__<tool>` and default to the `state-changing` risk
  class (they ask before they run). Server env/header secrets live
  only in the keyring; config.json never sees them; servers spawn
  only from user configuration (ADR-0011 §7). Since plan 15 S1,
  **apps are the only MCP registration path** (`config.toolApps`):
  every server lives inside a `ToolAppSpec` (preset-backed or custom
  app); `AppService` (`main/services/AppService.ts`) owns the
  validated CRUD, the pinned boot pipeline (keyring re-namespacing
  `mcp:<id>:*` → `app:<id>:*` → zod validation with self-disable →
  cached-tool reconciliation → health), per-tool `toolState`
  (denylist posture: absent = enabled, overrides tighten-only) and
  `entityScope` pattern rules; the legacy `tools.mcpServers` /
  `tools.mcpToolOverrides` collections migrated one-time into apps
  (plan 15 D11) and the plan-11 `mcp:*` IPC channels are retired —
  servers are managed exclusively through the `apps:*` surface and
  the Apps settings tab. The
  agent graph curates app tools per turn (plan 15 S2): the app bridge
  (`ai/tools/apps.ts`) attributes every app tool; the selection
  middleware (`ai/tools/app-selection.ts`) binds apps by exposure —
  `always` unconditionally, `relevance` via the deterministic D17
  matcher (whole-token, NFKD-normalized; the app name is an implicit
  tag) with a 2-turn D15 sticky window — and drops the rest, with a
  budget guard (25-tool budget; `relevance` drops before sticky, spec
  order as tie-break, `always` never dropped). Dropped apps surface as
  a D16 availability hint (config-sourced, capped, fenced) and a
  bind/drop trace step in the turn timeline; `wrapToolCall` rejects
  calls to unbound app tools and HITL `interruptOn` excludes them, so
  a resumed approval can never hit the guard (D14). `deferred` apps
  (plan 15 S3) bind behind provider-side tool search when the factory
  gate admits the model (Claude Sonnet/Opus 4+, Haiku 4.5+, gpt-5.4+
  on the stock OpenAI base) — budget-exempt flat context — and fall
  back to `relevance` semantics everywhere else. The bundled Home
  Assistant preset (plan 15 S4) owns the authored layer: default risk
  map, `promptNotes` (fenced into the system prompt while bound — the
  only `promptNotes` source; renderer input is stripped) and per-tool
  entity metadata that drives D18 `entityScope` enforcement —
  out-of-scope entity args skip the approval card and are rejected by
  the bridge, and discovery results are filtered before the model sees
  them (`ai/tools/app-selection.ts`). Enabled app tools surface in the
  command palette (source `mcp`, category `integrations`, turn-path
  dispatch; destructive/kill-switched excluded; server-down rows flagged
  disabled; plan-14 integration-pack rows bound to an exposed app tool
  are suppressed until the app disables — D12) and in the inspector
  tool catalog with `appName` + inline health (plan 15 S6). Each app can
  also carry user-authored **standing directives** — capped, fenced into
  every turn's system prompt while the app is enabled (bound or not),
  editable only in the Apps tab; the model and servers can never write
  them. The agent also sees an always-present **app directory** (one
  line per enabled app) and can activate an app mid-turn with an
  `enable_app` tool call — its cached tools become callable for the rest
  of the conversation, budget-checked at activation, per conversation
  thread. The model can only route within user-enabled apps; policy,
  approvals and audit are unchanged.
- **Audit**: every tool execution and denial is recorded to the
  `ToolCall` table (tool, args hash, outcome, duration, `approved_by`);
  every LLM call inside the loop audits to `AiCall` via the gateway
  callback handler — the agent never bypasses the funnel.
- **Slash commands** (`/screenshot`, `/shell <cmd>`,
  `/open <url|path|app>`) invoke tools directly — same policy path,
  approvals, and audit as the agent, no model call; results persist as
  a regular assistant message. The desktop inspector carries a
  searchable tool catalog (family `chat-tools-catalog` piece) with
  slash-command examples.
- **Web search** (`web_search`, read-only network tool backed by
  `services/SearchService`): user-configured provider instances in
  `config.search.providers` — SearXNG (base URL), Brave, Tavily, Exa,
  Serper, Google Programmable Search (key + engine id). The tool
  queries enabled instances in array order (the Tools tab sets
  priority with up/down controls) until one returns results
  (failover), with per-instance timeout (default 8 s, cap 30 s).
  API keys live only in the keyring (`search:<id>:key`, masked
  `keyHint` in config — same pattern as provider keys); search
  results are treated as untrusted observations.
- **Translation** (`translate` tool + `/tr [language] <text>`, plan 19,
  read-only network tool backed by `services/TranslateService`): one
  uniform `translate()` entry with two engine kinds — service
  providers (DeepL, LibreTranslate; instances in
  `config.translation.providers`, keys in the keyring
  `translation:<id>:key`, ordered failover, per-instance timeout) and
  the LLM engine (`AiTask.TRANSLATE` assignment through the gateway,
  `temperature: 0`). `translation.mode` picks `auto` (services first,
  LLM fallback) / `service` / `llm`; every unconfigured path is a
  typed error, never a silent fallback. Built-in ISO-639-1 codes and
  user-defined `customLanguages` share one resolver; the slash grammar
  treats the first token as the target only when it names a language.
  Results render with an engine/route meta line; service-engine calls
  audit to `AiCall` like gateway calls. Bare `/tr` (or `/tr <lang>`
  with no text) opens the **translate pad** mini app: debounced live
  translation over the direct `translation:translate` IPC (no turn,
  no persistence; auto-send delay configurable via
  `translation.padDebounceMs`, default 1.5 s), multiline scrollable
  result panel with an engine/route footer and copy; the mini app
  header is a drag region.

## Windows
- **Chat overlay (launcher mode)**: frameless, rounded
  (radius token `--da-window-radius: 28px`), always-on-top;
  shown/hidden via the global hotkey or tray; position persisted in
  config. The composer auto-focuses on mount in both windows
  (`useChatSession` mount effect), so a freshly opened app is ready to
  type; re-summons re-focus via the `focus-input` push. Window
  transparency is config-driven (`window.transparent`,
  Settings → General; toggling recreates the window) — Cinnamon/Mint
  defaults to opaque unless configured. The overlay is a state machine
  (`chat-react/launcherState.ts`):
  `idle` = composer-only bar (~76 px, no response area) → `thinking`
  = composer + trace strip (`ChatTurnStatus` + step chips) →
  `responding` = auto-growing response panel (≤ 40% of the work area,
  auto-expands on overflow) → `done` = response + `ChatTraceMeta` row /
  `failed` = dismissible error card; `expanded` shows the full
  transcript + history sidebar. `Ctrl+E` toggles expansion; Escape walks
  expanded → compact → hide; hiding dismisses a finished response but
  never kills an in-flight turn (main-owned streaming). The composer
  wraps when multiline: once the draft exceeds one line, `ChatComposer`
  flags its input row `data-multiline` (library styling hook) and
  `chat-app.css` moves the toolbars into a footer under the full-width
  textarea, so pasted text is not squeezed between the button clusters.
- **Desktop mode**: a second, full-size window (1080×720, min 980×640,
  24 px radius, taskbar-visible, resizable + maximizable, never
  always-on-top) for when the user wants more room and info. Same
  renderer bundle as the launcher (`?mode=desktop`); shared session/turn
  logic lives in `chat-react/useChatSession.ts`. Layout: docked session
  sidebar + full transcript + collapsible **inspector** (turn trace
  timeline with step details, turn meta, attachments, Markdown/JSON
  export, per-conversation model override stored in
  `Conversation.metadata`, and a searchable tool-catalog browser built
  on the family `chat-tools-catalog` piece). Opened from the launcher
  toolbar,
  `Ctrl+D`, or the tray; the launcher hands off the active conversation
  (`?conversation=` bootstrap + `session-sync` broadcast) and hides
  itself. Turn events reach every window, so in-flight turns keep
  streaming wherever you're looking. The window hides instead of closing
  and remembers bounds + maximized state (`window-state.json`); files
  can be dragged onto it to attach.
- **Settings**: frameless companion window opened from the tray, Ctrl+S,
  the ⚙ action in the expanded/desktop views, or the launcher's ⋯
  menu (which then hides the launcher, Spotlight-style). Behavior lives
  in `config.behavior` (summon target, auto-expand, background
  notifications, and opt-in hide-on-blur — the launcher never hides on
  focus loss unless Settings → General enables it; dev builds keep it
  off so DevTools stay usable) and applies live via the config
  broadcast; expand/desktop hotkeys are global and configurable
  (Settings → Hotkeys), with in-window Ctrl+E / Ctrl+D always active.
- **Autostart (residency)**: Settings → General → "Launch on system
  startup" (`preferences.autostart`, applied by `ResidencyService` at
  boot and on config save/reset). Per-OS: Linux manages the XDG entry
  `~/.config/autostart/desktop-assistant.desktop` itself (Electron's
  `setLoginItemSettings` is macOS/Windows-only); Windows registers the
  login item with a `--hidden` arg; macOS registers the login item (no
  hidden flag exists — the window opens at login). A `--hidden` boot
  starts the app in the tray without showing the launcher. Dev builds
  never register (the toggle disables itself via
  `system:autostart-status`); disabling is always allowed so stale
  entries can be cleaned up.

**Launcher chrome conventions** (compact window): the toolbar is
`[desktop mode] [⋯ more]` — the ⋯ dropdown (`LauncherMenu`) holds the
rarely-used actions (New conversation, Expand, Settings). Menus and
notification banners render **in flow** above the composer so the
measured-height mechanism grows the window around them — never
fixed-position overlays, which clip at the tiny window's bounds;
menus close on Escape via a capture-phase handler (Escape would
otherwise hide the window). Notifications in launcher-mode windows
route through `NotificationService.setHandler` into an in-flow
banner (errors 5 s, successes 2.5 s, dismissible, `role=alert`);
desktop/settings windows keep corner toasts. The composer has a
single window control (hide to tray) — minimize lives only in the
desktop window's title bar.

## Build system

- `tsconfig.main.json` compiles main + preload to `dist/` (with
  `tsc-alias` path resolution), `vite.config.ts` builds the two renderer
  entries (React plugin + Tailwind v4 `@tailwindcss/vite`).
- `npm run dev` runs Vite + tsc watch + Electron concurrently;
  `npm run dist` packages with electron-builder (AppImage/deb, NSIS, DMG).
