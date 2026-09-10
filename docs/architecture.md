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
│     ├── DatabaseService      Prisma engine resolution + schema bootstrap      │
│     ├── ConversationService  conversation CRUD/listing                        │
│     ├── MessageService       messages + turn-trace persistence              │
│     ├── MemoryService        persistent assistant memory (Memory table)     │
│     ├── AIService            one-shot LLM chat + model listing              │
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
  (`default-src 'self'`, inline styles only). In dev, Vite rewrites that
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

- SQLite via Prisma; the client is generated into `src/generated/client`
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
├── checkpointer.ts # Prisma-backed LangGraph checkpointer: agent state
│                   #   persists in the app DB (resume after approval /
│                   #   restart), idempotent setup + age-based pruning
├── stt.ts          # narrow exception: Whisper-compatible transcription
│                   #   endpoint (not covered by LangChain) + transcript
│                   #   sanitization (no-speech results become null,
│                   #   never chat messages)
├── tools/          # tool layer: registry (merge/namespacing/caps),
│   │               #   policy engine (risk × grants × kill switch),
│   │               #   native/ catalog (Tier A read-only + Tier B
│   │               #   state-changing + Tier C destructive; categories
│   │               #   files/system/desktop/network/power/memory),
│   │               #   mcp.ts (MCP servers: stdio/HTTP/SSE adapters,
│   │               #   lazy connect, health/backoff, caps)
└── graphs/
    └── assistant.ts # the tool agent: `createAgent` (langchain v1) with
                     #   checkpointer, HITL approval middleware, step/
                     #   token/wall-clock caps
```

`AIService` (services/) is a thin caller: resolves the provider + keyring
key, then delegates to `aiGateway.chat()`. Streaming chat is owned by the
**main process** through `TurnManager` (`src/main/turns/`): a turn starts
via `ai:turn-start` (main persists the user message — creating the
conversation on first message — builds the model history from the
database, and streams through the gateway); phase events (`queued →
thinking → [tool_call/tool_result/interrupt] → streaming →
finished/failed/cancelled`) broadcast to **every window** over
`ai:turn-event`, so streaming survives window hide and handoff. Terminal
phases broadcast only **after** the assistant message is persisted —
renderers re-read the transcript on those events and must always see the
final rows. The final assistant message is persisted with a `metadata`
trace (outcome, model, duration, steps — `TurnTraceStep[]`);
`ai:turn-cancel` aborts mid-stream and keeps the partial text. Renderers
map the envelope onto the family `ChatStreamEvent` vocabulary
(`chat-core`'s `useChatStream`) via an IPC transport.

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

On the agent path, turn phases are now derived from **node-level graph
telemetry** (plan 13): the agent bridge reports `node_started` /
`node_finished` per LangGraph node execution (stream-derived names —
`model_request`, `tools`, middleware nodes — never hardcoded), carrying
outcome (`done`/`failed`/`interrupted`), duration, and a `resumed` flag
for checkpoint replays after an approval resume. Node events ride the
same `ai:turn-event` envelope (`TurnEvent.node`), back the "Thinking"
trace steps with real per-node durations, and stamp tool steps with
their executing node; a resumed replay merges into the prior step in
the renderer trace store (rendered once, never double-counted).

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
- **MCP servers** (`tools/mcp.ts`): user-configured servers (Settings →
  Tools) add tools over stdio, streamable HTTP, or SSE via
  `@langchain/mcp-adapters`; one isolated client per server, lazy
  connect, reconnect with backoff, per-server timeout/concurrency
  caps. Tools are namespaced `mcp__<server>__<tool>` and default to
  the `state-changing` risk class (they ask before they run). Server
  env/header secrets live only in the keyring; config.json never sees
  them; servers spawn only from user configuration (ADR-0011 §7).
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

## Windows
- **Chat overlay (launcher mode)**: frameless, rounded
  (radius token `--da-window-radius: 28px`), always-on-top;
  shown/hidden via the global hotkey or tray; position persisted in
  config. Window transparency is config-driven (`window.transparent`,
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
  notifications, hide-on-blur) and applies live via the config
  broadcast; expand/desktop hotkeys are global and configurable
  (Settings → Hotkeys), with in-window Ctrl+E / Ctrl+D always active.

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
