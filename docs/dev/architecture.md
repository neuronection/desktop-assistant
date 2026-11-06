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

## Layering

`src/shared/` is pure cross-process code: it must never import `@main` or
`@renderer` (types, zod envelopes, config defaults and the pack SDK only).
`tests/shared-layering.test.ts` enforces the rule; `PdfProcessingStrategy`
lives in `src/shared/types.ts` and the main attachment service imports it
from there.

Main-process service cohesion follows the family service-cohesion law
(family plan 40, §The law): band edge ~780 / trigger ~800 lines per
`src/main/**/*.ts` file. Over-band files carry dated accepts/declines in
`src/main/SIZES.md` (plan 40 W4, 2026-10-25); a decline is re-proposed
on touch or >20% growth, and a split, when triggered, is a pure move
proven by `tsc` + build with an unchanged IPC surface.

## Security model

- Renderer processes run with `contextIsolation: true`,
  `nodeIntegration: false`; production adds `sandbox: true`
  (`src/shared/constants/window.ts`). `src/preload/preload.generated.ts`
  (generated from the IPC registry, see `docs/dev/ipc.md`) is the only
  bridge — it exposes a typed, enumerated API; channels are not
  free-form strings from the renderer. Because a sandboxed preload may
  only `require('electron')`, the bridge stays one self-contained file
  with no relative imports (`verify:preload-sandbox` + the packaged
  `--smoke` bridge probe keep it that way). Windows deny popups
  (`setWindowOpenHandler`) and out-of-origin navigation
  (`will-navigate` guard); every HTML entry carries a CSP meta
  (`default-src 'self'`, inline styles only). The chat entry and the speech
  HUD add `media-src 'self' data: speech-cache:` — the `speech-cache:`
  token admits the local content-addressed audio protocol beside base64
  data URLs (no network origins), and the two policies are otherwise
  identical. The remaining entries play nothing and carry no `media-src`.
  In dev, Vite rewrites that
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
- **Crash & permission posture (plan 46 S1):** every window root mounts a
  TEXT-keyed `ErrorBoundary` failure card with a reload action, and
  `window.onerror`/`unhandledrejection` report through the validated
  `system:renderer-error` IPC seam into the main-side logger. Main
  installs `uncaughtException`/`unhandledRejection` handlers (log +
  continue — the tray app never dies silently; `src/main/crash.ts`) and
  an app-level `child-process-gone` logger whose sandbox branch points
  at the run record (the authoritative crash settlement lives in
  `SandboxService`'s exit path, by run id). Persistent windows recover
  from `render-process-gone` via `src/main/windowCrash.ts` (destroy,
  recreate, one deduped `NotificationService` notice); transient windows
  (result viewer, pack windows) log only — their lifecycle owners stay
  authoritative. Permission requests pass the matrix in
  `src/main/security/permissions.ts`: microphone (audio-only `media`)
  on the app origin (`file://`, or the dev server in dev) is granted;
  camera-carrying media and every other permission are denied.
  `secrets.json` is written owner-only (`0600`).

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

- **Mini-app packs** (plan 26 S1–S2, ADR-0029): importable declarative
  task apps — a validated manifest (typed run pipeline, report schema,
  config schema, i18n) with **no code execution in Tier 0** and `net`
  denied. The SDK lives pure in `src/shared/app-pack/` (types, builders,
  the ONE validator both SDK and runtime share, generated contract
  vocabularies from `contracts/mini-app-packs.json` — the family
  canonical sync with a drift gate); the runtime is
  `src/main/apps/registry.ts` (install/enable/disable/remove, sha256
  digest + origin, apiVersion negotiation, boot self-disable with
  path-precise reasons — the ToolAppService pattern) persisting to
  `config.miniApps`, plus the S2 **capability layer**
  (`src/main/apps/capabilities/`): fs with run-root validation and the
  symlink/mount-skipping walk, the decide bridge over the existing
  decision funnel (one audited `AiCall` per question batch, typed error
  mapping), the run bridge (start/progress/cancel, per-pack isolation),
  and `capabilitiesFor` gating every bridge on the declared capability
  set at registration. Settings → Apps → Mini-apps renders the pack list,
  capability badges and the config auto-form; the `app-pack` CLI
  (`npm run app-pack -- init | validate`) is author tooling over the
  same validator, and the contract publishes a generated JSON Schema
  (`contracts/mini-app-packs.manifest.schema.json`) as a cross-language
  structural gate that imports pass before the full validator. Since S3
  the app can RUN assessment packs:
  `src/main/apps/runner/` executes scan → classify → decide → compose
  with per-item checkpoints (`MiniAppRun`/`MiniAppRunItem`), a
  fingerprint verdict cache (resume and re-runs never re-decide), budget
  pre-flight with resumable `paused` exhaustion, boot reconciliation of
  orphaned runs, and the shared priority limiter at the decision funnel
  (`ai/decide/limiter.ts` — interactive traffic overtakes background
  runs). The decide loop runs a bounded parallel window
  (min funnel slots × 4) with an order-preserving drain — results,
  totals and progress are byte-identical to a sequential pass. Runs
  settle into persistent live result cards in the transcripts
  (`MiniAppRunCard`), scheduled fires are report-only
  (`disallowArm`), and per-pack run economics surface in the Usage
  dashboard. The card subscribes to the `miniapps:run-event` broadcast
  in a layout effect (live before its DOM is observable) and withholds
  the card until the pack's live-card spec resolves, so a burst arriving
  at mount is never dropped and labels cannot swap after commit. Model access binds to the decision registry /
  gateway only — a pack never names a provider or model. Full contract
  and chapter map: the [pack SDK doc set](sdk/overview.md).

## Notifications (plan 42)

One main-side `NotificationService` is the only notification creator. It
persists every informational notice to `Notification`, dedupes by
`dedupeKey` inside `behavior.notifyRate.dedupeWindowMs` (payload `count`
bumps), rate-limits per source inside `behavior.notifyRate.windowMs`,
renders the OS toast as a view of the stored row, and routes clicks
through the closed `clickAction` table (`open-conversation` /
`open-settings` / `open-pack-report` / `open-path` / `none`) with
`sourceRef`. Approval semantics never move here — verdicts stay on
`ApprovalCard`.

## AI access (family standard, ADR-0008)

Model I/O goes through the app's AI layer in `src/main/ai/` — nothing
outside it imports provider SDKs or LangChain model classes (enforced by
`scripts/check-ai-alignment.sh --self --mode strict` in CI):

```
src/main/ai/
├── chat-models.ts  # model factory — the ONLY @langchain/* model-class
│                   #   imports (openai/anthropic/google); one
│                   #   openai_compatible path (configuration.baseURL)
│                   #   covers OpenAI/Groq/Together/Fireworks + local
│                   #   Ollama; OpenAI reasoning models (gpt-5/o-series)
│                   #   get no temperature (locked to the default by the
│                   #   API), and structured output prunes JSON Schema
│                   #   keywords providers reject (propertyNames …)
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
├── decide/         # plan 20/26 decision models (optional, default OFF):
│                   #   intent routing + tool dispatch as a sibling
│                   #   capability — never a chat replacement. index.ts
│                   #   is the funnel (resolve decision:<cap> slot →
│                   #   invoke → audit on the `intent` task label →
│                   #   confidence band act/confirm/refuse; every
│                   #   non-decided status falls through to the standard
│                   #   agent path), registry.ts (plan 26 S1) holds the
│                   #   one registration per TRANSPORT (systemone today)
│                   #   and resolves slot → model row → provider row with
│                   #   capability routing enforced (D2b) and a
│                   #   per-config-revision cache (voice hot path);
│                   #   `off` is a resolution state (unassigned slot),
│                   #   never a transport (the one-time plan 26 S2
│                   #   legacy-config migration ran on the real profile
│                   #   and was then deleted outright — §13.8);
│                   #   points/ holds decision points (plan 24 S3/S5):
│                   #   tool-dispatch.ts is the first one (eligibility +
│                   #   direct/route/fall-through classification, run via
│                   #   the shared decision-points.ts batch runner —
│                   #   parallel, per-point timeout, cancellation,
│                   #   fail-open; phase/mode/domain contract);
│                   #   speak-intent.ts is the non-blocking advisory
│                   #   gate (a noul over the user's own prompt arms a
│                   #   per-turn speak override + ear-friendly system
│                   #   steer — the model reply can never arm it);
│                   #   utterance-gate.ts is the fail-closed voice
│                   #   auto-send gate (its judge is selectable via
│                   #   config.voice.autoSendEngine — the assigned
│                   #   boolean-gate decision model, or the assigned
│                   #   voiceEndpoint model, which skips the decision
│                   #   path); custom rules (config.decision.
│                   #   rules) layer a safe action (route/notify/speak/
│                   #   tag) on a confident dispatch — validated config,
│                   #   never code,
│                   #   systemone/ is the TypeSafe System One transport
│                   #   (plan 24 S4 → plan 26 S1, ADR-0020/0032): the
│                   #   official TypeSafe SDK is confined to this dir,
│                   #   pointed at the assigned provider row's base URL
│                   #   (chat-style /v1 stripped; preset baseUrlOverride
│                   #   wins), behind a SystemOneClient seam (typed
│                   #   errors, timeout, 429/529 backoff, injectable
│                   #   fetch); typed questions natively + a tool-
│                   #   dispatch projection (__tool__ Choice with a
│                   #   __none__ out + closed-set arg questions); key
│                   #   from the provider row's keyring secret
│                   #   (provider:<id>); probe.ts is the decision
│                   #   probe (D13/D18) validating decision-only
│                   #   providers with one minimal typed question,
│                   #   tool-surface.ts projects the executable tools
│                   #   (native zod→JSON + app MCP params, capped at 40)
│                   #   into the engine-neutral schema
├── tools/          # tool layer: registry (merge/namespacing/caps),
│   │               #   policy engine (risk × grants × kill switch),
│   │               #   native/ catalog (Tier A read-only + Tier B
│   │               #   state-changing + Tier C destructive; categories
│   │               #   files/system/desktop/network/power/memory),
│   │               #   mcp.ts (MCP servers: stdio/HTTP/SSE adapters,
│   │               #   lazy connect, health/backoff, caps; onToolResult
│   │               #   hook invalidates stale-guarded context digests),
│   │               #   apps/context-digests.ts (plan 23 S3:
│   │               #   capability-keyed providers turn one read-only
│   │               #   tool call into a TTL-cached, entity-scope-
│   │               #   filtered digest block; context-providers/
│   │               #   home-assistant.ts is the reference provider)
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
checks key presence and delegates. One-click BYOK setup (plan 21) also
lives in the AI layer (`ai/providers/setup.ts`): `setupProviderFromPreset`
resolves-or-creates a provider row from `PROVIDER_SETUP_PRESETS`
(`src/shared/ai/providerPresets.ts` — neutral preset metadata mapped onto
the existing `LLMProviderType` values, Ollama the only keyless local
preset), validates the key **fetch-first** — the real catalog is fetched
under an `AbortController` before anything persists, and a failure is
classified by `classifyProviderError` (`src/shared/ai/providerErrors.ts`)
into a routable error code (`invalid_key`, `insufficient_credit`,
`new_user_quota`, `region_unavailable`, plus desktop extensions `timeout`
and `local_not_running`; a 401 with a key whose prefix smells like another
vendor adds a `suspectedVendor` hint). Success persists the fetched
catalog into `availableModels`, gap-fills `taskAssignments[CHAT]` with the
preset's bundled model only when that id exists in the fetched catalog and
CHAT is unassigned, and is idempotent via `presetKey` on `LLMProvider`:
re-setup updates the key in place, and manual rows with the same
`type + apiBase` are adopted (earliest first), never duplicated.
`setDefaultModel` is the generic "bind a model id to a task (+ default
provider)" primitive behind the model picker; it takes the target task
(`chat` default, `vision` requires the vision capability). Preset
metadata itself is **generated** — `contracts/ai-presets.json` is the
family canonical single source (curated models, sttModel, key URLs,
checklists, prefix hints), synced into
`src/shared/ai/providerPresets.generated.ts` by
`scripts/sync-ai-presets.mjs` (drift-checked by
`scripts/check-byok-contract.sh` in CI); the hand-written
`providerPresets.ts` adapts it (wire-type mapping + the groq/ollama
local enum carve-out) and owns the helper functions. A `vision`
task slot routes image/screen-capture turns: `TurnManager` resolves it
first for attachment-bearing turns (per-conversation model overrides
still win) and falls back to the chat assignment. The Stage B/D
renderer surface is the setup **wizard overlay**
(`settings-react/tabs/SetupWizard.tsx`): first run renders a slim
inline card ("Set up AI" + an Ollama detection banner from a silent
probe via the existing `ai:test-provider` bridge) that launches a
modal wizard; "Add provider" opens the same wizard directly. The
wizard shows neutral preset tiles in `PROVIDER_PRESET_ORDER` (logos
via `ProviderLogo.tsx`), paste-anywhere pre-selection via the
key-prefix table (pre-select, never lock), a per-vendor checklist,
and error routing through the classifier codes; the guided form
prefills the connection name and hides the API base URL in a
collapsed Advanced section (fixed bases read-only; an edited base
routes the save through the manual form — sequential modals, never
nested). After success the wizard offers the next step — "Default
models": bind the default text model and the default vision model
(vision options capability-filtered) through
`provider:set-default-model`. Each step's action button is the save
(setup persists immediately; close dismisses). Setup persists only
the curated model ids per preset (`curatedModels` in
`providerPresets.ts`, D17 — full-catalog fallback on zero matches);
provider rows backed by a preset gain an on-demand "Set up
automatically" action that re-runs the orchestration with the stored
keyring key (D18), and manual provider add/edit/delete persist
immediately through the provider IPC with the settings window
adopting the main config after every write (D19). Model capabilities
split transcription (`stt`) from speech (`tts`) — legacy `audio` caps
migrate to both at config load — and setup gap-fills the STT task
from the preset's curated transcription model (openai `whisper-1`);
the Tasks tab leads with a "Default models" section (text, vision,
transcription, speech). The utterance evaluator (voice completeness
judgment + transcript post-processing) resolves the `voiceEndpoint`
task with a chat fallback; the auto-send judge is selectable
(`voice.autoSendEngine` — the assigned boolean-gate decision model or that assigned model), and
standing voice mode persists `ConversationMetadata.speakReplies` so
"speak aloud from now on" speaks every following reply in a conversation.
First-run entries: launcher/desktop chat empty state and the tray menu
gain "Set up AI…" items that deep-link to the settings window's API tab
(`settings:open` with `{tab: 'api'}`; the tray menu rebuilds on
right-click reading live config). All three surfaces hide on the same
predicate, `hasConfiguredProvider()` — a row with a keyring hint, a
`presetKey`, or OLLAMA type — because `mergeWithDefaults` reseeds the
keyless default row on an empty provider list, making "zero rows"
unreachable. After a successful setup the settings window adopts the
main-owned config (`adoptMainConfig`) so a later settings Save cannot
clobber the persisted provider with a stale draft; cross-window
freshness rides the existing `config-updated` broadcast. Streaming chat is owned by the
**main process** through `TurnManager` (`src/main/turns/`): a turn starts
via `ai:turn-start` (main persists the user message — creating the
conversation on first message — builds the model history from the
database, and streams through the gateway). The turn layer is split
move-only: `TurnManager.ts` keeps the state machine and public entry,
while `approvalGate.ts`, `titles.ts`, `recall.ts`, `persist.ts` and
`notify.ts` own their named concerns; `persist` is a thin
`MessageService` call and `notify` a thin `NotificationService` call. When a decision model is
assigned (plan 26, default OFF — an unassigned slot), a short plain
input with no attachments
first tries the decision funnel (`ai/decide/`). Resolution goes through
the registry (plan 26 S1): `decide/registry.ts` holds **one
registration per transport** (today only `systemone` — the TypeSafe SDK
behind a `SystemOneClient` seam) with the capabilities it serves
(`tool-dispatch`, `boolean-gate`, `choice`, `score`; `open-args`
reserved) and a `resolveCandidate` hook, so callers never switch on
transport kind and `off` is a resolution result (unassigned slot)
rather than an engine. `resolveDecision` walks the `decision:<cap>`
slot's assignments — primary, then fallback — to the model row (must
declare the `decision` capability, D2b) and its provider row, rejecting
candidates whose transport does not serve the capability; the settings
surface reads a per-slot readiness list (`DecisionSettingsState.slots`)
and a source-guard test pins that the
turn layer contains no engine-kind branch; resolution is cached per
config revision (the voice hot path must not hit the keyring per
phrase). The
funnel then runs a lexical candidate
pass (`selectDecisionCandidates` — the D17 hard-filter pattern over a
curated dispatch vocabulary: tagged native tools + app keyword tags)
ranks at most 8 tools for the model, and an empty candidate set skips
the dispatch entirely; a single-call, non-refuse
result dispatches through the same direct-tool path as slash commands
(same policy + approval machinery, no model call; the 'confirm' band
forces the approval card, provenance lands in message metadata) — every
other outcome falls through to the normal turn unchanged. The decision
tool surface is scope-filtered (plan 20 S7 D8): `config.decision.scope`
allowlists app ids and gates the curated native vocabulary — both empty
by default, so a fresh assignment dispatches nothing until the user
opts in
(apps via the card's checkboxes, built-ins via the include-natives
switch; the card hints when the funnel is effectively idle); custom
**route tools**
(`config.decision.routeTools`, D9/D10) are appended as parameter-less
priority entries — a picked route tool hands the input to a normal
chat/agent turn pinned to the tool's `modelId` (a hand-off, never an
execution; the turn runs agent or stream by the routed model's own
capability, "routed to …" lands in the trace and the routed-to model id
in message metadata; an unconfigured or keyless route target falls
through to the chat turn — unresolvable models are also skipped at
surface-build time). The decision
system prompt is assembled in one place (`ai/decide/prompt.ts`, D11):
default steer + user prompt (≤1000 chars) + route-tool few-shot lines
from `examples` + a scope line — the transport consumes it through
`DecisionRequest.systemPrompt`. The direct
path executes both native tools and app/MCP tools
(`ai/tools/mcp-direct.ts`: connected enabled apps, effective per-app
risk, D18 entity-scope guard rejecting out-of-scope device ids before
execution — the same contract as the agent bridge). Settings surfaces
the feature (plan 20 S5 + S7c → plan 26 S3): decision setup (provider, model,
the `decision:<cap>` slot assignments) lives in the ApiTab Task
Assignments Decision group; the Tools-tab Decisions card keeps behavior
only (thresholds, no-execution test, scope app multi-select +
built-in-tools switch, route-tool add/edit/remove with model select and
examples, extra-prompt textarea, plus a deep-link card into API
settings) and talks over `decisions:*` IPC to
`ai/decide/settings-controller.ts`. Phase events
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
spots are legible in the launcher status line's expanded step list. Both
the graph path and the non-graph streaming fallback get fitted history.

**Memory recall injection (plan 12 §1):** before the model history is
built, `TurnManager` asks `TurnManagerMemories.recall(query)` (wired to
`MemoryService.recall`) for top keyword-matched memories and prepends a
synthetic `system` message (`[Memory context] …`, never persisted) to
the turn history; a completed "Context — N memories recalled" trace
step marks the injection in the launcher status line's step list. Injection and the
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

The turn gate (`TurnManager`) routes by model capability: models with
the `tools` capability (or no caps data — legacy rows count as capable)
always run the agent graph (`src/main/ai/graphs/assistant.ts`) — even
when the registry is empty, so telemetry and trace behavior are
uniform. The plain gateway stream is reserved for models without the
`tools` capability and for builds without a wired agent:

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
  Cautious / Trusted workspace / Fully manual; the default is **Trusted
  workspace**, so built-in state-changing tools run without asking) and
  apply to built-in
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
  without re-uploading every image every turn. The system prompt also
  leads with the current local date/time + IANA zone
  (`buildSystemPrompt`, plan 23 S1) so models never spend a tool call
  probing for "now"; the decision prompt carries the same line.
  Apps additionally provide
  **context digests** (plan 23 S3): a capability-keyed provider turns
  one read-only tool call into a compact entity/state block that rides
  the system prompt and the decision prompt — TTL-cached,
  single-flight refresh, invalidated on state-changing tool results,
  entity-scope-filtered at render, served stale with an age note on
  refresh failure; the `behavior.appContext` flag is the kill switch.
  Digests ride **bound apps only** — selection match/sticky/deferred —
  so unrelated turns carry zero app-context tokens.
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
  Gemini path). Both flavors use the keyring secret at call time and
  are audited on the `tts` task. Failures reject the IPC call with a
  compact status-mapped message (`compactTtsError`) that the renderer
  shows as a notice. **Voice selection (plan 60):** `shared/ai/voices.ts`
  maps the assigned target to a profile (Kokoro by model/base URL, then
  Gemini, Piper/Ollama, OpenAI-compatible, generic) that supplies the
  preset list, default voice and speed support. `TtsService.resolveTarget()`
  resolves `voice.speechVoice` (or the profile default) once per
  utterance, so the wire, cache key and history agree; manual names pass
  through verbatim and are never translated across providers. Keyless
  loopback/private OpenAI-compatible servers (Kokoro-FastAPI, LocalAI,
  Piper) are accepted without a dummy secret (`shared/ai/local.ts`).
  Settings → Voice → Replies uses an `allowCreate` combobox (preset +
  manual) and a **Preview** that rides the speech bus as source
  `preview` with draft voice/speed overrides — it is settings-only,
  excluded from the recent-speech ring, and cached like any utterance.
  The renderer strips
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

### Prompt context & the decision fast path (plans 20/23)

Every assistant turn assembles one layered system prompt; the decision
funnel may short-circuit the agent entirely. The layers:

- **Ambient context (zero config — present whenever the source exists):**
  - *Clock line* (plan 23 S1) — local date/time, weekday and IANA zone
    first in `buildSystemPrompt` and in the decision prompt, so
    models never spend a tool call learning "now".
  - *Per-app standing directives* — the app detail page's textarea
    (the app `directives`), injected standing while the app is enabled.
    The bundled Home Assistant preset carries the trusted **app skill**
    (plan 23 S5/D3): `preset.skill` seeds `ToolAppSpec.skill` through
    the authored template (main-owned; renderer submissions are
    stripped, `SKILL_PROMPT_MAX_CHARS`-capped). The block is bound-only.
  - *App context digests* (plan 23 S3, `ai/tools/apps/
    context-digests.ts`) — a capability-keyed provider turns ONE
    read-only tool call into a compact "what exists" block
    (`[App context — <app>]`), so models never run discovery, memory
    or system probes to resolve devices or items. Lifecycle: TTL cache
    per server (15 min), single-flight refresh, stale served **with an
    age note** when a refresh fails, digest-less when the app has no
    provider or erred (D5/D13); entity-scope rules filter rows at
    render time while the cache keeps raw rows (D10); output caps live
    solely in `renderAppDigest` (150 rows / 1 200 chars). Invalidation:
    state-changing MCP tool results (via the `McpManager.onToolResult`
    hook, including errored calls) and app saves.
- **The decision fast path (plan 20 + D9):** an eligible input
  (short, plain, no attachments, no flow) runs the assigned decision model
  first. Single-call act-band results execute **directly** — no model
  turn (the decision prompt carries the decision-scope apps' digest,
  so the engine emits `entity_id` itself); confirm-band results
  raise the approval card; refuse/compound/any failure hands back to
  the standard agent turn (D4 fail-open). A zero-call act outcome is
  reported honestly as "no actionable call".
- **Route hand-offs** (plan 20 S7 D9/D10): a route tool pick dispatches
  a normal chat/agent turn pinned to the route's `modelId` (planned
  skill/allowlist extensions are on hold — see BELOW).
- **Gating (D12 & transparency):** the kill switch — Settings →
  General → "Let apps provide live context" (`behavior.appContext`,
  default on) — gates digests and the decision-prompt context; memory
  recall keeps its own separate toggle. The launcher status line and its
  expanded step list show the decision step (engine + confidence + route), app selection,
  `enable_app`, and every tool call; the Apps tab readout shows the
  cached digest per app (S6).

**Plan 23 pause (2026-09-21).** The global skill-pack library
(`config.skills`), the route-hand-off extensions (`skillId`/`appId`/
`tools`/`prefetch`) and the mid-turn seeding plumbing were reverted
after the first live runs showed the composition had grown into
compensating patchwork (three seed entry points, five instruction
channels, prompt recomposition at the middleware seam). The kept
substrate: the clock line, the digest plane (mechanism + tests + readout)
and the per-app authored skill. A simplification pass would re-approach
these as ONE prompt-composition point, ONE instruction channel per app,
and programmatic (not playbook-steered) id resolution against the
digest.

Where it lives:

```
turn flows (main)
  TurnManager.tryDecisionDispatch     → eligible? engine.run → band
     ├─ single act call               → runToolOnlyTurn (direct exec, no agent)
     ├─ route pick (resolveRouteHandoff) → routed agent turn (seed/allowlist/skill pin)
     └─ everything else               → standard runTurn (D4 fail-open)
  agent path (graphs/assistant.ts model_request node)
     assembleTools → app selection (+ enable_app, sticky) → guidance =
       directives + promptNotes + skills + digests → createAgent system prompt
```

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
  durations only — never raw tool payloads. Finished turns render the
  same trace UI in every view (launcher, expanded, desktop) from
  message metadata: with `behavior.traceDetails` (default OFF) the
  collapsed-expandable `ChatTraceTimeline` ("Turn trace · N tools",
  library `chat-trace-timeline` via `TraceTimeline`), with it off the
  compact `ChatTraceMeta` badge row (`TraceMetaRow` — model · duration ·
  tools). The old FlowStatusCard-based "Turn trace" step card
  (`CompletedFlowCard`) is removed — it also rendered nothing for plain
  chat turns; `TraceTimeline` itself degrades to the badge row when a
  turn called no tools.
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
  app); `ToolAppService` (`main/services/ToolAppService.ts`) owns the
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

### Live conversation mode (plan 25)

A hands-free voice loop, default off, started from the composer **Live**
button. Main owns the session: `src/shared/live.ts` is a pure reducer over
a closed vocabulary (`idle → arming → listening → transcribing → thinking
→ preparing → speaking → …`, plus `paused`/`error`) with a derived
`capture` dimension (`preparing` — TTS synthesis — keeps capture open so
the reply can be interrupted before it starts); `LiveSessionService`
drives it over a `LiveSessionHost` seam
(turn control, the utterance gate, the intent point, timers, broadcast) so
it is unit-testable without Electron. Audio I/O lives in the **hidden live
host** (plan 61): a never-shown renderer (`live-host.html`, IPC scope
`live-host`) owns `RecordingManager`, VAD/segmentation and live reply
playback, reports `live:mic-ready` / `live:phrase-committed` /
`live:speech-detected` / playback boundaries, and applies the full-duplex
downgrade. Main remains the brain; the launcher and desktop are
projections that start/stop and render transcript/approvals. The host
mounts with a readiness handshake (`live-host:ready`) and main replays a
pending `start`/`speak` instead of dropping it; a finished live turn's text
(from the turn stream, or `speakText`) is forwarded as a generation-tagged
`live-host:speak`. A host crash ends the session (`device-lost`) with a
notice and the next start recreates it — audio is never silently
resurrected. Speech-bus audio still plays in the overlay. The card is the textful live
face (plan 63): the overlay keeps the last user transcript from
`live:event` and a bounded reply caption streamed by main as
`live:caption` (120 ms throttle, 280 chars, session-tagged; nothing is
persisted). It renders the live state, the transcript and the caption with
interrupt/end actions and no speech progress; an approval pause shows
**Approval needed**. On that transition main emits one deduped
`system`/`warn` notification ("open the assistant" → the existing
conversation route, desktop mode); if the notification service suppresses
it, the amber HUD line is the fallback signal. Content protection applies
to the window, so captions follow it. Full IPC surface:
`docs/dev/ipc.md` → Live conversation.

The mic stays open during playback (full-duplex) so interruption is real.
When echo control is inadequate — no headset and `voice.bargeInOnSpeakers`
off, or a streak of echo-ignored candidates — the session **downgrades to
half-duplex** (mic closed during playback) with a notice; a **Voice
interrupt** toggle switches modes for the current session. Barge-in is a
decision point: `src/main/ai/decide/points/live-intent.ts` (capability
`choice`, domain `interrupt`) classifies a detected utterance as
`ignore`/`interrupt`/`end`, layered over the deterministic filter in
`src/main/ai/live/filter.ts` (echo/self-text similarity + i18n keyword
fast path) and the existing `stt.ts` noise/hallucination rejection. The
model judges only the residual and **fails closed**; `end` needs high
confidence. Live endpointing uses a shorter phrase gap
(`voice.livePhraseGapMs`, `resolvePhraseGapMs`) while the completeness
gate stays fail-closed. Live TTS is chunked (`speechChunks.ts` +
`speechQueue.ts`): sentence-sized batches, each synthesized while the
previous plays, so an interrupt wastes at most the in-flight chunk. Fast
interruption: a global **Stop Speaking /
Interrupt** hotkey, an `Escape` ladder, and tray entries. See ADR-0021.

### Speech bus, selection TTS and the audio cache (plan 58)

Speaking is main-owned: `SpeechService` (host-injected like
`LiveSessionService`) is the ONLY sequencer for the bus sources
(`selection`, `reply`, `replay`, `clipboard`), and `src/shared/speech.ts`
is the pure reducer every surface renders. The overlay
(`speech-overlay.html` + `speech-overlay-react/`) is a separate renderer
process that hosts the audio element and the HUD: it plays what main hands
it, reports typed facts (`speech:playback-fact`) and never sequences
anything. The edge text dock's playback is a dock-state rail; the
`transport-popover.html` surface and IPC scope `transport` remain
implemented but dormant for future mini-app action surfaces. Its window is created lazily on first use and kept alive,
non-focusable and off-taskbar, with `backgroundThrottling: false` and a
post-creation `floating` always-on-top level; bounds are computed at show
time on the cursor's display and re-clamped on metrics changes. A recreated
overlay pulls `speech:snapshot` + `speech:current-chunk` and resumes at the
current chunk.

Pipeline: segment (300 chars for selection/clipboard, 4000 =
`MAX_TTS_CHARS` for replies — plan-25's one-call coherence law) → per
chunk cache lookup → miss: `TtsService.speakResolved` (the voice-affecting
target is resolved ONCE per utterance) → best-effort cache write →
ephemeral data URL. Synth-ahead is exactly one chunk. Arbitration: a live
session refuses bus requests, and starting live stops the bus;
`selection`/`clipboard` preempt `reply`/`replay` (never the reverse);
depth-1 queue with inaudible replace; a `dedupeKey` collapses one reply
spoken by two mounted windows; pause during synthesis latches; stop
cancels the in-flight provider op in main; suspend and screen-lock land in
`idle` (never `paused`).

The cache (`SpeechCacheService`) lives in `userData/speech-cache`:
content-addressed chunk files keyed by sha256 over provider / provider
type / apiBase / model / voice / speed + chunk text (no `mime` — it is an
output; speed is normalized out for GOOGLE-flavored providers), plus a
hash-only `index.json` that groups chunks into utterances so LRU eviction
(50 utterances and 512 MiB, both budgets) never splits a long selection.
Files are served by the privileged `speech-cache:` protocol, whose handler
is total (traversal, a missing file and a directory are 404s — a throw
would surface as a silent media failure). Both `index.html` and
`speech-overlay.html` admit the scheme in `media-src`. The cache can never
mute speech: a miss always plays an ephemeral data URL regardless of the
write outcome, and a disabled or unavailable cache degrades persistence
only.

**HUD style family + "Pulse" (plan 58 addendum).** The HUD has three
presentations of the same state machine, chosen by `voice.speechHudStyle`:
`card` (the textual now-playing surface: shown while speech or live is
active and faded when idle, even when pinned), `edge`
(30×68 half-pill dock tab on any of the four screen edges) and `dot` (28 px
presence orb with a hover strip of action buttons; the former `mini`
capsule was removed and its selections migrate to the dot). The pure mapping lives in `src/shared/speechHud.ts`: `hudPresentation`
takes the style plus the authoritative snapshots and returns the visual, the
click action and every label; `liveHudVisual` maps live phases (accent =
reply speaking, teal = mic open, dim = preparing/paused, red = error). Live
outranks the bus on every textless style and hands the surface back when the
session ends. While live: the tab body = interrupt the reply, its square =
end the session, the orb's click = end the session; there is no pause
affordance. The overlay only READS live state (`live:get-state` +
`live:event`) and acts through the two overlay-only invokes
`speech:live-interrupt` / `speech:live-end` (shared with the tray handlers);
live start/stop/mic controls stay launcher/desktop. Every style — card
included — drags through `speech:hud-drag-*` and persists its placement
(corner, edge ratio, free orb fractions) through the config write path;
the card body is a real button (pause/resume, interrupt live), so no
style uses a native `-webkit-app-region: drag` region that would swallow
clicks.

Geometry is a box model (`SPEECH_HUD_SHAPES` + `speechHudBox`): the window
is the visible shape plus `HUD_GLOW_PAD` on the sides that face the desktop,
so the state-tinted glow is never clipped by the window boundary. The dock
tab rotates for a top/bottom dock (68×30), and its box rotates with it
(88×42) — a box that kept the vertical 30 px width clipped the right side of
the tab and its stop control. The dock
tab's docked side carries no padding (it is flush by design); a top/bottom
dock keeps `HUD_EDGE_REVEAL` (2 px) so its glow survives. The orb's travel
box is inset by `HUD_DOT_SAFE_MARGIN` on all four sides, so ratios 0/1 stay
12 px clear of the work-area edges at every display offset (the default
bottom-right position is a safe corner, never touching the taskbar). Only
the card's corner placement uses `SPEECH_HUD_WINDOW_MARGIN`; the dot's
window envelope always hosts its open button strip (`HUD_DOT_STRIP`),
so hover never resizes the frameless window.

The textless styles default to glass everywhere — a solid rectangle around
an orb reads as a stray window, and the launcher's glass already works on
Cinnamon. An explicit choice wins (`speechHudTransparentFor`): the
Transparent-window setting or `DESKTOP_ASSISTANT_OPAQUE=1` makes them load
a solid panel with `?opaque=1`, which the renderer turns into the
`hud-glass--opaque` surface (no backdrop blur); `DESKTOP_ASSISTANT_OPAQUE=0`
forces glass. The card simply follows the user's transparency setting. The window is re-created when a style change alters
its size — X11 WMs ignore resizing a `resizable: false` frameless window —
with audio resuming from the mount resync.

Visibility is one decision, not scattered show/hide calls:
`decideSpeechHudVisibility` (pure) + `WindowManager.syncSpeechHudVisibility`.
A chat surface that is visible **and not minimized** hides the HUD (the
launcher minimizes to tray), `never` hides it, an active speech utterance
(unless dismissed for that utterance) or a live session (including `error`)
shows it, `pinned` keeps it while idle, and `auto` fades it after 1.5 s. A
new live session clears a speech dismissal. The sync keeps the hidden
overlay alive while speech or live is active because that window is the
speech-bus audio endpoint (`speech:play` is overlay-scoped). Boot, window
show/hide/minimize/restore, config posture changes, style re-creation and
display-metrics changes all re-run it. `areChatWindowsVisible` no longer
counts minimized windows, so opening the launcher always hides the HUD and
minimizing it always brings it back.

Visual language (`src/renderer/styles/speech-hud.css`): deep glass
(`backdrop-filter: blur(14px)`, with a HUD-owned opaque tint base — the Dark
theme's surface token is translucent by design), a masked 1px gradient hairline, a
state-tinted halo, state entry at scale 0.96→1 with
`cubic-bezier(.2,.9,.2,1)` over 200 ms, and a ~2.4 s halo breath while
speaking/listening. States never differ by colour alone: the wave path is
smooth, dashed, flat or a zigzag per state; the orb carries a breathing
halo, a dashed ring plus orbiting arc, pause bars, or an exclamation glyph;
the tab's three bars read as dots, equal bars or a jagged shape.
`prefers-reduced-motion` removes the breath, orbit, wave march and flashes
while keeping those silhouettes. The dock tab's body reserves the
always-visible pause/stop strip, so the bars centre in the space that is
left and a control never sits on a visualization; the capture harness and
the style e2e both assert disjoint rectangles for every style/state/side. The dock tab's hover growth is a CSS
transform into the pre-allocated glow pad (6 px), not a window resize — the
X11 resize law above would refuse it.

Live is startable from the tray too: **Start live conversation** sends
`hotkey:start-live` to the existing launcher renderer **without showing it**
(the invisible engine client; a missing launcher is created), while **End
live conversation** enables whenever a session exists. Starting live hands
the surface to the HUD (plan 62 S4–S6): the first `arming` arms a 10 s
handoff timer; when the host reaches `listening`, `WindowManager` hides the
launcher/desktop and the HUD appears in the selected style. Opening the
launcher during live hides the HUD and shows the transcript/approvals;
closing or minimizing returns to the HUD, live uninterrupted. A mic failure
shows the launcher with its live error (the tray Start is retryable at
`error`); a silent start timeout stops the session and opens the launcher
with a notice. `posture: never` keeps the launcher instead of hiding it.
`applyLiveSnapshot` still drives the presence surface (idle hides; an error
stays visible for its flash) and ending fades it like speech.

Settings → Voice → Selection speech shows only the position control that
fits the chosen style: a 2×2 screen-corner picker for the card, a 2×2
dock-side picker plus an **Along the edge** slider for the dock tab, and a
free-position hint with **Reset to bottom-right** for the orb. Posture and
content protection stay global; nothing irrelevant is shown.

Navigation lives one right-click away: `speech:hud-menu` (overlay-only) pops
a native menu with **Open assistant** (`showMainWindow`), **Speech settings…**
(Settings → Voice), a **HUD style** radio group over the four styles and a
**Keep on screen** checkbox tied to `voice.speechHudPosture`. The card — the
only style with room — also carries a visible 24 px **Open assistant** ghost
button (`speech:hud-open`). The menu is built in main so it can extend past a
28 px orb, does not compete with the primary click (stop / interrupt /
pause), and reuses the normal config write/broadcast + style re-shape path.
The tray keeps the same commands, so the mouse-only HUD adds no keyboard
gap.

`scripts/hud-capture/capture-hud.mjs` renders this real overlay renderer
through the dev-only capture harness (`?capStyle=&capVisual=&capSide=&capTheme=&capOpaque=&capText=&capDockText=&capDictating=&capSelection=`,
inert inside Electron and in production; the text/dictation params let the
HUD dictation face be inspected too), screenshots each
style × state × dock side × theme at 2× device scale with a transparent
background, and composes labeled contact sheets under
`/tmp/opencode/hud-design/round-N-*.png`.

Surfaces are projections of `speech:state`: the HUD (`auto | pinned |
never` via `voice.speechHudPosture`, corner via `voice.speechHudCorner`),
the launcher SpeechBar (`liveActive ? liveLocal : busSnapshot`), the tray
(Speak clipboard · Pause⇄Resume · Stop · Replay last · Start/End live,
plus the HUD style submenu) and the global
hotkeys (`SpeakSelection`, default `CommandOrControl+Shift+S`;
`PauseSpeaking`, default unbound). Selection reads reuse
`DesktopContextService.readPrimarySelection` — X11 PRIMARY first, then a
constrained `wl-paste --primary --no-newline` fallback when present, and
never synthetic input. Failures are typed (`no_selection` vs
`selection_unsupported`), and `voice.selectionMaxChars` (default 8000)
caps the cost of a mis-aimed select-all.

## Windows
- **Live host (plan 61)**: a sixth, never-shown renderer. Off-taskbar,
  unfocusable, unthrottled (`backgroundThrottling: false`), created on the
  first live start and kept for the app session. It owns the mic/VAD and
  live reply playback; main keeps the state machine. A renderer crash ends
  the live session; the next start recreates it. No visible UI, no taskbar
  or focus presence.
- **Speaking HUD (plan 58)**: the fifth renderer entry. Frameless,
  rounded, non-focusable and off-taskbar (mouse-only by design — keyboard
  parity is the Pause/Stop hotkeys and tray), `backgroundThrottling:
  false`, kept alive between utterances. Audible even when `never` shows
  it; the launcher must never host bus audio (recreating the launcher
  would kill it).
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
  `idle` = composer-only bar (~100 px, no response area) → `thinking`
  = composer + the persistent meta row (`ChatTurnStatus` + latest tool +
  step count) → `responding` = auto-growing response panel (≤ 40% of the
  work area; overflow highlights the existing Expand icon instead of
  switching layout mid-read) → `done` = response, with the same meta row
  morphing from live status to `ChatTraceMeta` /
  `failed` = dismissible error card; the trace store reseeds only on
  the turn's `queued` event, so every turn-start funnel resets it at
  submit time — the strip never shows the previous turn's steps (which
  may belong to a previously selected session) during the submit
  roundtrip; `expanded` shows the full
  transcript + history sidebar — the command palette (slash input /
  Ctrl+K) is available here too, rendered in the composer slot like the
  other in-flow chrome. Entering expanded mode scrolls to the start of
  the latest reply (the streaming live row when a turn is in flight),
  not the start of the conversation. `Ctrl+E` toggles expansion; Escape walks
  expanded → compact → hide; hiding dismisses a finished response but
  never kills an in-flight turn (main-owned streaming). The compact
  chrome wrapper carries a uniform 12 px inset (`p-3` in ChatApp) —
  composer, response panel, banners and menus all sit exactly 12 px
  from every window edge, and `compactWindowHeight` uses the measured
  chrome height as-is (the panel adds only its top inset + 2 px
  rounding slack; no per-state additive slack), so the window always
  fits its content with no dead space. The `WINDOW_SIZE` fixed heights
  (COMPACT/THINKING/FAILED) are first-paint fallbacks only — the
  renderer's ResizeObserver re-fits the window right after mount. Fitting
  is coalesced (`launcherResize.ts` + `useLauncherResize.ts`) into one
  native size per meaningful change; streaming only grows the window and
  a shrink waits for the settled state. Each new turn resets the compact
  panel budget to its chrome floor, so the next reply never inherits the
  previous reply's height. Main applies a single `setBounds`
  per request (`windowResize.ts`) instead of a per-frame easing loop:
  X11 treats every native resize as a configure/repaint round-trip, which
  is the launcher's streaming flicker. The
  composer is
  a permanent two-row layout: `chat-app.css` pins the full-width textarea
  on top with the toolbars in a footer below (left cluster left,
  ⋯/✕/send right) unconditionally — ChatComposer's `data-multiline`
  flag (fired when the draft exceeds one line) no longer drives layout,
  so the row never re-flows when the first character appears and pasted
  text is not squeezed between the button clusters. A slim conversation
  meta strip sits directly above the composer in every compact state —
  `New chat` when the conversation is empty, else the live message
  count (pluralized TEXT keys) with a `+` quick new-conversation button
  that hides while the strip shows `New chat` (the count reflects
  optimistic local appends and DB reloads alike, since it reads the
  same `messages` state as the expanded transcript). In the compact
  done state the collapsed trace meta (model · duration · tools, the
  library `ChatTraceMeta` row) rides the same line instead of its own
  row — `behavior.traceDetails` keeps the standalone expandable
  timeline. The meta row is a disclosure everywhere it renders
  (`ExpandableTraceMeta`): turns with tool/decision steps toggle the
  full `TraceTimeline` in place on click; plain replies keep the
  static badge. The disclosure is single-toggle: the timeline mounts
  `defaultOpen` and a scoped `.da-trace-inline` rule hides the library
  summary button inside it (the badges already carry that summary) —
  the repo's `data-as` override pattern, no library fork. Trace step
  labels get a wide wrapping column app-side (the library pins
  `w-24` + truncate, which crops composed names mid-word) with the
  args/response detail re-indented to match.
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
  can be dragged onto it to attach. The header carries
  "Open launcher mode" / "Open expanded mode" buttons — the
  `desktop:open-launcher` IPC hides the desktop window, shows the
  launcher, `session-sync`s the active conversation into it, and pushes
  `launcher:set-mode` (`compact` → `collapse`, `expanded` →
  `auto_expand`), so every mode can reach every other mode (launcher ⋯
  menu / Ctrl+E / Ctrl+D, expanded header desktop button, desktop
  header launcher buttons). Mini apps (calculator / translate
  pads, plan 14 §9) run identically in every surface — compact
  launcher, expanded, and desktop — through one shared controller
  (`chat-react/useMiniApps.tsx` + `MiniAppSurface`): bare `/calc` or
  `/tr` opens the focused pad, Enter copies the result in place
  (no turn), Escape or the pad's × exits, and the palette enters
  focus mode (only the pad's command + `/exit`).
- **Settings**: frameless companion window opened from the tray, Ctrl+S,
  the ⚙ action in the expanded/desktop views, or the launcher's ⋯
  menu (which then hides the launcher, Spotlight-style). Behaves like a
  classic window: normal z-order (never always-on-top), taskbar entry,
  title-bar minimize/close buttons, no maximize. Auto-scroll is
  opt-in (`behavior.autoScroll`, off by default): when enabled,
  streaming responses stay pinned to the newest message; when off, the
  transcripts scroll manually only (the jump-to-latest pill remains).
  Behavior lives
  in `config.behavior` (summon target, background notifications, and
  opt-in hide-on-blur — the launcher never hides on
  focus loss unless Settings → General enables it; dev builds keep it
  off so DevTools stay usable) and applies live via the config
  broadcast; expand/desktop hotkeys are global and configurable
  (Settings → Hotkeys), with in-window Ctrl+E / Ctrl+D always active. The
  launcher hotkey defaults to `Control+Space`; voice is unbound globally
  by default and driven **in-window**: holding Control in the focused
  launcher starts recording and releasing transcribes it
  (`chat-react/usePushToTalk.ts` — a short arm delay cancelled by any
  other key keeps Ctrl combos intact; see `useChatSession`'s
  `startPushToTalk`/`stopPushToTalk`).
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
rarely-used actions in grouped sections: New conversation and History,
then Expand / Open desktop mode (with right-aligned shortcut hints),
then Settings, then About (opens the settings window on its About tab).
A discreet heart button sits left of the ⋯ trigger — it opens the
in-flow fund card (`FundCard`, family `SponsorCard` with the shared
`SPONSOR_CHANNELS` from `renderer/shared/funding.tsx`, Buy Me a Coffee
first, extensible for future channels). The About page itself
(`settings-react/tabs/AboutTab.tsx`) renders the family `AboutPanel`:
version, license, creator, project links, tech chips and the sponsor
channels.
The History entry swaps the menu content in place for a
recent-conversations list — clicking a row opens that conversation in
expanded mode (the default); the monitor icon on each row opens it in
desktop mode instead; Escape steps back to the menu before closing.
Menus and
notification banners render **in flow** above the composer so the
measured-height mechanism grows the window around them — never
fixed-position overlays, which clip at the tiny window's bounds;
menus close on Escape via a capture-phase handler (Escape would
otherwise hide the window) and support Arrow/Home/End focus movement. Notifications in launcher-mode windows
route through `NotificationService.setHandler` into an in-flow
banner (errors 5 s, successes 2.5 s, dismissible, `role=alert`);
desktop/settings windows keep corner toasts. Window controls:
the compact launcher's **⋯** menu and the expanded launcher's header
(the drag handle) carry **Hide to tray** only — the composer renders
no window controls, and the launcher offers no minimize verb: a
window-manager minimize request is intercepted (restore, then
`hideMainWindow()`, which itself restores before hiding — the
Cinnamon/Mutter unmapped-strand guard). Minimize + hide live in the
desktop window's title bar.

## Build system

- `tsconfig.main.json` compiles main + preload to `dist/` (with
  `tsc-alias` path resolution), `vite.config.ts` builds the two renderer
  entries (React plugin + Tailwind v4 `@tailwindcss/vite`).
- `src/preload/preload.generated.ts` is emitted by
  `node scripts/generate-ipc.mjs` (with `docs/dev/ipc.md`) and is never
  hand-edited: `npm run verify:ipc-codegen` fails on drift, and
  `npm run verify:preload-sandbox` proves the compiled preload requires
  nothing but `electron` — the production sandbox drops any preload that
  does (2026-11-03: v0.10.0 shipped a preload importing the registry,
  every packaged window died on its error boundary).
- `npm run dev` runs Vite + tsc watch + Electron concurrently;
  `npm run dist` packages with electron-builder (AppImage/deb, NSIS, DMG).
