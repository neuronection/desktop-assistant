## [Unreleased]
### Changed
- **Decision engine registry (plan 24 S1 — groundwork).** Engine
  resolution moved behind one registration point
  (`ai/decide/registry.ts`): each engine declares its capabilities, a
  display name and its resolve/create/audit hooks, so adding an engine is
  one file plus one entry and callers never switch on engine kind. `off`
  is now a resolution state, not a value in the engine enum, and the old
  sync/async resolver split is gone. New engine-neutral contract types
  (capability matrix, typed question/answer, generic readiness) land in
  `shared/ai/decisions.ts` ahead of the Jev engine. Default OFF behavior
  is unchanged.

- **Ergonomic launcher + voice triggers.** The launcher hotkey now
  defaults to `Control+Space` (was `CommandOrControl+Shift+A`); installs
  still carrying the old default are migrated on config load, while
  user-customized bindings are preserved. Voice is now **in-window
  push-to-talk**: hold Control in the focused launcher to record, release
  to transcribe — no global voice chord required, so the old
  `CommandOrControl+Shift+R` default is left unbound (still rebindable in
  Settings → Hotkeys). A short arm delay, cancelled by any other key,
  keeps Ctrl+E / Ctrl+D / Ctrl+K and other Ctrl combos working untouched.

## [v0.8.0] - 2026-09-21
### Added
- **Preset-level fast-path posture.** `ToolAppPreset.fastPath`
  (`'eligible' | 'never'`, default eligible) declares whether a preset's
  tools are fit for direct decision dispatch; the Home Assistant preset
  marks `never` (Assist-style name-matched tools would guess
  area/device strings and fail the registry match). The decision
  surface filters ineligible apps' tools and the scope checkbox renders
  disabled with the reason.

- **Apps-tab live-context readout (plan 23 S6).** The app detail modal
  now shows what the model actually sees: "Live context: N entities ·
  age" (or "No live context published yet") from the digest cache —
  cache-only readout, never triggers a fetch (`apps:context-digest-
  stats`). Turn tool-call counts were already persisted in message
  metadata (plan 13/20) and now measure the fast path's effect.
- **Home Assistant bundled app skill (plan 23 S5).** The preset now
  authors a trusted, actionable playbook instead of reference notes:
  resolve rooms/names to `entity_id` from the prompt's device list
  before acting, skip discovery/confirms when the list already covers
  it, never consult memory tools for device names, never probe for the
  current time, and only discover when a device is genuinely missing
  (`preset.skill` seeds `ToolAppSpec.skill` through the authored
  template, absorbing legacy `promptNotes`; renderer submissions stay
  stripped). The digest-over-real-MCP path gained an end-to-end test on
  a dedicated stdio fixture (discovery → suffix match → one call →
  scope-filtered, capped block).

- **App context digests (plan 23 S3).** Apps may provide a compact,
  cached "what exists" digest (Home Assistant reference: the entity
  list) that rides the system prompt and the decision-engine prompt —
  "turn off the office light" resolves to `light.office` without any
  discovery, `enable_app`, memory, or system probes. Digests are TTL-
  cached per server (15 min), refreshed single-flight, invalidated on
  state-changing tool results and app saves, entity-scope-filtered at
  render time, hard-capped (150 rows / 1 200 chars), served stale with
  an age note when a refresh fails, and proceed digest-less when the
  app has no provider (D4/D5/D10/D13). Digests ride **bound apps only**
  (selection match, sticky or `enable_app` seeds) — unrelated turns
  carry zero app-context tokens. Kill switch in Settings →
  General → "Let apps provide live context" (`behavior.appContext`).

- **About & fund surfaces.** The launcher ⋯ menu gained an About item
  (bottom of the menu) that opens the settings window's new About tab —
  the family `AboutPanel` with version, Apache-2.0 license, creator,
  project links, tech chips and the sponsor channels. A discreet heart
  button next to the ⋯ trigger opens the in-flow fund card (family
  `SponsorCard`): Buy Me a Coffee first, GitHub star second — one shared
  `SPONSOR_CHANNELS` config (`renderer/shared/funding.tsx`) so new
  channels land everywhere at once.
- **`DA_AI_DEBUG=1` AI wire tracing.** New opt-in env flag for the dev
  session: every agent model call logs `[ai-debug] llm start` (resolved
  model + the bound tool names sent to the provider) and
  `[ai-debug] llm end` (whether the response carried `tool_calls`, with
  a text preview) — the fastest way to tell "the model never asked for
  tools" apart from "tool calls were lost in the stack" when a provider
  misbehaves.
- **Mode switching from the desktop window.** The desktop header gained
  "Open launcher mode" and "Open expanded mode" buttons (`desktop:open-
  launcher` IPC): the desktop window hides, the launcher shows with the
  active conversation handed over via `session-sync`, and a new
  `launcher:set-mode` push deterministically applies the compact or
  expanded state (no toggle races). Every surface can now reach every
  other: launcher ⋯ menu + Ctrl+E/Ctrl+D, expanded header desktop
  button, desktop header launcher buttons.
- **Mini apps now work in expanded mode and the desktop window.** The
  calculator and translate pads were launcher-compact-only — and worse,
  a bare `/calc` in desktop silently swallowed the input, and Enter in
  an expanded-mode pad sent the expression as a chat turn. One shared
  controller (`useMiniApps` + `MiniAppSurface`) now drives all three
  surfaces: bare `/calc` / `/tr [lang]` opens the focused pad anywhere,
  Enter copies the result (never a turn), Escape / the pad's × exits,
  and the command palette enters focus mode with `/exit`. Also wires
  the palette "Open" row action and mini-app guard for the desktop
  window.
- **The command palette now works in expanded mode.** Typing `/` (or
  pressing Ctrl+K / the "Open Command Palette" hotkey) in the expanded
  launcher opens the same in-flow palette as the compact bar and the
  desktop window — rendered in the expanded composer slot — with full
  execution, mini-app entry, row actions, and an Escape that closes the
  palette instead of collapsing the window. It was previously
  launcher-compact-only, so slash commands appeared dead in expanded
  mode.
- **Conversation history in the launcher ⋯ menu.** The menu grew a
  History entry (with a conversation-count badge) that opens a compact
  in-flow list of recent conversations. Clicking a row opens that
  conversation in expanded mode by default; a dedicated monitor icon on
  the right of every row opens it in desktop mode instead. Escape steps
  back from the history list before closing the menu, Arrow/Home/End
  keys navigate the items, and the list shows the active conversation,
  relative timestamps, and an empty state.
- **Redesigned launcher ⋯ menu.** Grouped sections (New conversation +
  History / view actions / Settings), icon tiles with hover accents,
  right-aligned shortcut hints (Ctrl+E / Ctrl+D), and full keyboard
  navigation; surfaces covered by the exclusion-free launcher axe scans.
- **Preset data now syncs from the family canonical file (plan 17
  Phase 1.6).** Provider presets, curated model allowlists, the
  whisper transcription default, vendor key URLs, setup checklists,
  and key-prefix hints are generated into
  `src/shared/ai/providerPresets.generated.ts` from
  `contracts/ai-presets.json` (the family single source) by
  `scripts/sync-ai-presets.mjs` — never hand-edited. Desktop's
  groq/ollama local enum mapping stays in the hand-written layer
  (the documented D2 carve-out). A new BYOK contract gate
  (`scripts/check-byok-contract.sh`, vendored with the canonical
  data) runs beside the AI alignment gate in CI: generated-data
  drift, `audio` capability literals outside the migration shim,
  setup-orchestration placement, the contract-test matrix, and
  options naming.
- **Actionable "no model" errors in the launcher.** When a turn fails
  because no chat model is assigned, the error banner now carries a
  deep-link button — "Set up AI" when nothing is configured, "Choose a
  model" when a provider exists — that opens Settings on the API tab
  at the right section (the deep-link target grew a `section` field),
  and actionable errors linger 20 s instead of 5 s so the button is
  actually clickable.
- **Defaults-first task assignments.** The Tasks tab leads with a
  "Default models" section — text, vision, transcription, speech —
  and tucks the derived tasks (titles, translate, plumbing, intent,
  voice endpoint) into "Other tasks" below.
- **Transcription and speech become separate capabilities, with
  whisper as the curated default (plan 21 Stage G).** The merged
  `audio` capability is split into `stt` (whisper-class) and `tts`
  (speech-class) — legacy caps migrate automatically — so pickers
  stop offering transcription models for speech and vice versa. The
  OpenAI preset curates `whisper-1` and setup gap-fills the
  transcription task (toggleable in the review); the wizard's
  defaults step gains a transcription row, and the Tasks tab puts a
  "Voice models" section (transcription, speech, voice endpoint) on
  top, separate from the text defaults.
- **The setup review is now editable cards and switches.** Curated
  models render as selectable cards with capability icons; the
  default fills are switch rows showing the current assignment —
  no more bare checkboxes.
- **Re-setup appends instead of replacing; bulk model cleanup (plan 21
  Stage F).** "Set up automatically" unions the fetched curated
  catalog into the provider's existing models (dedupe by id;
  custom models always kept) — configured models are never deleted.
  The edit form's Advanced section gains "Remove all fetched models"
  (destructive, confirmed; custom models untouched). The on-demand row
  action opens an **editable review modal**: pick which curated models
  to append, and toggle filling the empty text/vision defaults (each
  shows the current assignment) — the wizard flow stays confirm-free.
  Multi-select model
  management is tracked as a library `ModelRegistry` candidate.
  Curated models keep the `tools` capability by default — reasoning
  stays opt-in per model via the reasoning-effort tuning (D20).
- **Curated catalogs, on-demand re-setup, integrated provider rows
  (plan 21 Stage E).** Setup now persists only the curated models per
  preset (openai `gpt-5.6-terra/luna/sol`, gemini `gemini-3.8-flash`,
  anthropic `claude-sonnet-5` — the desktop center file; full-catalog
  fallback on drift; family-level single-sourcing tracked). Provider
  rows gain a "Set up automatically" action that re-runs setup on
  demand using the stored keyring key — revalidating, refreshing the
  curated catalog and gap-filling defaults. Provider rows and the edit
  form show vendor logos; the manual edit form moves the base URL
  under an Advanced disclosure matching the wizard. Manual add/edit
  and delete now persist immediately through the provider IPC
  (scrub-on-save) instead of riding the settings draft — every
  provider write is instant, results surface as notifications, and the
  settings window adopts the main config after each one.
- **Setup wizard as an overlay (plan 21 Stage D).** The provider
  setup flow now renders as a focused wizard modal with contextual
  footer actions and a header close — first run keeps a slim inline
  "Set up AI" card (with the Ollama detection banner) that launches
  it, and "Add provider" opens it directly. Each step's action button
  is the save (setup persists immediately; close just dismisses), which
  removes the mixed signal with the settings window's draft Save. The
  "Custom / manual" card and the edited-base hand-off chain into the
  legacy manual modal — sequential overlays, never nested.
- **Provider card grid + guided setup flow (plan 21 Stage C).** "Add
  provider" now reveals a card grid — vendor logo (simple-icons;
  monogram fallback for OpenAI/Groq) + name only — including a
  "Custom / manual" card that opens the legacy full form for any type
  or custom base URL. Picking a card opens the guided form: connection
  name prefilled, API key front and center, and the API base URL tucked
  into a collapsed Advanced section (read-only for fixed-base presets;
  editing it routes the save through the manual form with name/type/key
  carried over). After a successful setup the card offers the next step:
  "Default models" — bind the default text model and default vision
  model (vision options are capability-filtered). The Tasks tab renames
  the chat slot to "Default text model" and gains a "Default vision
  model" row; fetched catalogs get inferred capabilities so
  vision-capable models surface there.
- **Default text + default vision model routing (plan 21 D14).** A new
  `vision` slot joins the task assignments: turns that carry images or
  screen captures resolve the vision assignment first and fall back to
  the chat model (an explicit per-conversation model override still
  wins). `provider:set-default-model` accepts the target task and
  rejects vision bindings for models without the vision capability.
  Setup gap-fills `vision` alongside `chat` when the preset's bundled
  model is vision-capable and the slot is unassigned. Bundled preferred
  models updated per current catalogs (D15): openai `gpt-5.6-terra`
  (luna/sol ride the fetched catalog), gemini `gemini-3.8-flash`,
  anthropic `claude-sonnet-5` — all text+tools+vision.
- **One-click BYOK provider setup (plan 21).** Settings → API gains a
  "Set up AI" card for first run: neutral provider tiles (OpenAI,
  Gemini, OpenRouter, Anthropic, Groq, Mistral, DeepSeek, Ollama), a
  paste-anywhere key that pre-selects the matching tile, a per-vendor
  setup checklist, and a silent local probe that offers "Ollama
  detected — connect in one click". Setup validates the key
  **fetch-first** (the real model catalog is fetched under an abort
  timeout before anything persists), then binds the preset's bundled
  model to CHAT only when it exists in the fetched catalog and CHAT is
  un  assigned. Failures route to guided fixes instead of raw errors:
  invalid key, credit/quota limits, region blocks, timeouts, "Ollama is
  not running", and mis-paste hints ("this looks like an OpenRouter
  key — set up OpenRouter instead?"). When the catalog lacks the
  bundled model, the success view offers an inline model pick bound
  through `provider:set-default-model`. Setup is idempotent via a
  `presetKey` stamp on the provider row: re-setup updates the key in
  place, and pre-existing manual rows with the same type + base are
  adopted (earliest first), never duplicated. First-run entries: the
  launcher/desktop empty state and the tray menu ("Set up AI…") open
  the settings window on the API tab; all entries hide once a
  configured provider exists. New primitive
  `provider:set-default-model` upserts a model onto a provider and
  binds it to CHAT (+ default provider); cross-provider ids are
  rejected. Strings live in the `SETUP_*` section of `TEXT` (en-only,
  structured for later single-sourcing); the setup card ships with
  exclusion-free axe scans.

- **`[digest]` pipeline observability.** With `DA_AI_DEBUG=1` the
  context-digest plane now logs its skip reasons (no capability or
  provider), cache hit/refreshed/stale/failed states, context-tool
  discovery (a candidate miss names the tool counts), invoke failures
  and empty payloads — fetch and injection were previously fully
  silent, leaving live-trace diagnosis to inference.

### Changed
- **The system prompt knows the current date/time.** Every turn's
  system prompt (and the decision-engine prompt) now leads with the
  local date/time, weekday and IANA timezone (plan 23 S1) — models no
  longer spend a `system_info`/`llm_GetDateTime` tool call learning
  "now" before acting.

- **Plan 23 pause (2026-09-21).** The global skill-pack library
  (`config.skills`), the route-hand-off extensions, and the mid-turn
  digest/seed plumbing were reverted after the first live runs showed
  the composition had grown into compensating patchwork (multiple seed
  entry points, overlapping instruction channels, prompt recomposition
  at the middleware seam). Kept: the clock line (S1), the context-digest
  plane with its bound-only injection and the Apps-tab readout (S3/S6),
  the per-app authored skill (presets seed `spec.skill`; the legacy
  `promptNotes` channel was removed outright) and the decision-prompt
  digest (D9). A simplification pass replaces playbook-steered id
  resolution with programmatic validation against the digest.

- **Google chat models run on `@langchain/google`** (the LangChain-
  recommended `ChatGoogle`), replacing the legacy `@langchain/google-
  genai` and its hand-maintained converter patch — structured output
  now rides Gemini's full-JSON-Schema `responseJsonSchema`, and
  ToolMessage images are delivered as sibling `inlineData` parts
  natively (previously: local `patch-package` patch; the wire shape
  stays pinned by `tests/ai-gemini-tool-image.test.ts`).

- **Home Assistant preset defaults to `/api/mcp`.** The bundled preset's
  default endpoint is now `http://homeassistant.local:8124/api/mcp`
  (Home Assistant's MCP endpoint). Applies to new preset setups; the
  add-flow prefills it automatically. Existing saved apps keep their
  stored endpoint — edit the connection to update.
- **App detail modal: one Save, always-visible footer.** Editing an
  existing app now shows a persistent footer with Close and Save on
  every tab; a single Save persists the connection and the directives
  together (the separate per-section "Save connection" / "Save
  directives" buttons are gone, and a failed connection validation
  skips the directives write instead of half-saving).
- **Auto-scroll is now opt-in (off by default).** Transcripts in the
  launcher, expanded and desktop views no longer jump to the newest
  message while a response streams — you scroll manually, and the
  jump-to-latest pill stays available. Re-enable via Settings → General
  → "Auto-scroll to the latest message" (`behavior.autoScroll`).
- **One execution path for tools-capable models.** The turn gate no
  longer requires `getToolCount() > 0`: every model with the `tools`
  capability runs the agent graph even when the registry is empty
  (uniform telemetry/trace behavior), and the plain gateway stream is
  reserved for models without the `tools` capability or builds without
  a wired agent — one less rarely-exercised path to hide bugs in.
- **Settings behaves like a classic window.** The settings window no
  longer floats above everything (always-on-top removed) and gained
  title-bar controls — minimize and close buttons next to the version
  in the header — while the maximize ability is disabled; the footer
  Close button stays.
- **One trace UI everywhere.** Finished turns now render the same
  assistant-ui trace in every view — launcher, expanded, and desktop:
  the collapsed-expandable `ChatTraceTimeline` ("Turn trace · N tools")
  when turn trace details are enabled, the compact
  `model · duration · tools` badge row when not — replacing three
  divergent renderings (the launcher badge row, the FlowStatusCard
  "Turn trace" card in expanded/desktop that also vanished entirely for
  plain chat turns, and a timeline gated per view). Turn trace details
  stay opt-in (Settings → General, default OFF); the FlowStatusCard
  card is removed and `TraceTimeline` degrades to the badge row for
  turns without tool calls.

### Fixed
- **Sticky app bindings survive across turns again.** The agent runner
  keyed its sticky window and mid-turn `enable_app` bindings by the
  graph thread id — which carries a per-turn suffix
  (`conversation:message`) — so every new turn started from an empty
  window: matched apps had to re-earn their binding on each message,
  D19 router apps lost their mid-turn-enabled tools on the next turn,
  and app-context digests stopped riding the second turn onward. Both
  maps key on the conversation id now, bounded to the
  `CONVERSATION_STATE_LIMIT` (64) most recent conversations with
  oldest-first eviction.
- **Changelog head de-tangled.** The plan-23 rebase had committed this
  file with unresolved conflict markers and duplicate section headers;
  the kept-series entries below are intact and no content was lost.

- **App detail Save no longer reverts edited connection fields.** The
  one-Save footer wrote the app twice — the connection first, then the
  directives spread over the pre-save snapshot — so the second write
  restored the old endpoint (and any other connection field) while both
  writes logged as successful. Save is now a single write carrying the
  connection patch and the directives together; the footer test had
  pinned the two-call behavior and now pins the single write.
- **Chat turns with tools bind again on Gemini.** The native datetime
  tool's `z.union([z.string(), z.number()])` arguments rendered as a
  JSON-Schema type array, which the migrated `@langchain/google`
  converter rejects client-side ("Gemini does not support union types
  in function schemas") — failing every Gemini turn that bound tools
  with "An error occurred.". The schema now takes strings only (the
  tool already parses epoch digits-as-string, 'now', 'today' and ISO
  input), and the bind-time schema guard additionally reports
  type-array unions with tool + path so the next offender is named
  before it breaks a turn; a catalog-wide test keeps all native tool
  schemas Gemini-clean.
- **Decisions "Try a command" works with OpenAI reasoning models and
  Gemini.** Three provider 400s broke the decision-engine test (and any
  structured-output call on those models): OpenAI's gpt-5/o-series
  reject any non-default `temperature` ("Only the default (1) value is
  supported"), so the model factory now omits temperature for those
  models entirely — deterministic-task pins (`temperature: 0` on the
  decision and translation tasks) degrade to the model default there
  while every other model keeps them. Both Gemini ("Unknown name
  \"propertyNames\"") and OpenAI's `response_format` validator
  ("'propertyNames' is not permitted") reject JSON Schema keywords
  outside their supported subsets — free-form `z.record` argument
  schemas map onto exactly those — so the schema bound for structured
  output is now pruned to provider-safe keywords for every provider
  before the call (output values still validated by the zod schema).
- **Agent turns sent NO tools to the provider (tools=NONE) — tool
  calling was dead in every view.** The app-selection middleware
  filtered `request.tools` down to the app tools kept for this turn,
  so when no MCP apps were configured (or none matched the query) the
  model received an empty tool list and answered in plain text — on
  every provider, regardless of the model's `tools` capability. The
  filter now drops only the un-bound app tools and keeps all native
  tools (`web_search`, screen, files, …). Found via the new
  `DA_AI_DEBUG=1` wire tracing (`tools=NONE` in the llm-start line);
  regression test pins native-tool survival when no apps are
  configured.
- **Plain-stream turns crashed for OpenAI models ("model.stream(...) is
  not a function or its return value is not async iterable").** The
  current `@langchain/openai` returns a Promise from `.stream()`, but
  the gateway iterated it directly — Google's client still returns the
  generator synchronously, which is why only OpenAI (and any
  non-Gemini/Anthropic provider, e.g. OpenAI-compatible endpoints)
  failed. The gateway now awaits `.stream()` before iterating, so both
  client shapes work. This path is reached by models without the
  `tools` capability (plain no-tool chat turns) — e.g. after disabling
  tools on a model in Settings → Models — and by any task that streams
  through the gateway.
- **"New conversation" from the command palette did nothing.** The
  `nav:new-conversation` builtin round-tripped through main, which
  broadcast `launcher:new-conversation` to the windows — but no renderer
  ever listened, so pressing Enter on the palette row (or submitting
  `/new`) silently swallowed the command. The execute path now resolves
  it renderer-side (immediate fresh conversation, no round-trip), both
  launcher and desktop windows listen on the broadcast channel as a
  main-originated fallback, and a regression test pins the
  palette-row → fresh-transcript flow in expanded mode.
- **Editing a custom MCP app lost or hid most of its configuration.** The
  detail modal's connection editor bailed out for stdio servers (showing
  only a "Native group" placeholder — command and arguments were neither
  displayed nor editable) and silently dropped the access-token field on
  save. The editor now shows the full creation surface: stdio command +
  arguments (round-tripped), HTTP/SSE endpoint, bearer token, allowlist,
  timeout, max concurrency, env and headers. Token replacement travels as
  an `authToken` payload that main merges into the keyring headers blob —
  sibling custom headers are preserved (secret values never come back to
  the renderer, so it cannot merge client-side), and a hint marks apps
  with an already-stored token. Save errors from main now surface in the
  editor instead of failing silently.
- **Voice post-processing silently did nothing.** The utterance
  evaluator resolved the `voiceEndpoint` task with no fallback, so on
  a fresh setup (voice endpoint unassigned) every dictation verdict
  failed closed — no transcript correction, no formatting, no
  auto-send judgment; the raw transcript went through as-is. The
  voice endpoint now falls back to the chat model, like titles,
  plumbing and intent.
- **Auto-configured models showed text-only capabilities.** Fetched
  catalog rows were persisted without caps, so the Models tab fell
  back to the `text`-only default — vision and tools chips sat
  disabled on terra/luna/sol and every fetched model. Setup now
  persists inferred capabilities on fetched models
  (`gpt-5.6*`/gemini/claude → text+tools+vision), heals legacy
  uncapped rows on the next re-setup merge, and the Models tab infers
  caps for any remaining uncapped rows at display time.
- **Dead model assignments blocked the vision defaults.** If
  `taskAssignments.chat`/`vision` pointed at a model id that no longer
  exists on any provider (leftovers from an earlier setup era), the
  no-clobber guard treated the slot as taken and re-setup never filled
  it — the UI showed it empty while setup silently skipped it.
  Assignments now count as live only when the model resolves; dead
  references are rebound on the next "Set up automatically".
- **Vision defaults now converge on re-setup.** When a provider's text
  model was already bound (manually or by an earlier setup) and the
  vision slot was empty, re-running "Set up automatically" left vision
  unbound even though the text model supports it (and vice versa: a
  non-vision text model now gets the curated preferred bound for
  vision). Re-setup binds the vision slot to the bound text model when
  it is vision-capable, otherwise to the curated candidate, and the
  row action reports each binding as a notification instead of doing
  it silently.
- **Curated setup missed snapshot-suffixed catalog ids.** OpenAI (and
  other vendors) list models as dated snapshots
  (`gpt-5.6-terra-2026-09-11`), so exact-id curation matched nothing
  and setup fell back to the full 136-model catalog with no defaults
  bound. Curation now matches curated ids against exact ids and
  dated-snapshot suffixes, binds the resolved snapshot id as the
  text/vision default (falling back to the first curated match when
  the preferred id is absent), and — only when truly nothing matches —
  keeps the full catalog and says so in the wizard instead of failing
  silently.
- **Structured decisions with Gemini: schema rejected with 400.** The
  decision schema's free-form `args` object rendered JSON-Schema
  keywords Gemini's response schema does not accept (`propertyNames`,
  `additionalProperties`, `default`), so every structured pick failed
  with "Invalid JSON payload received". The model factory now converts
  the zod schema to a Gemini-safe JSON schema (keywords pruned) for
  Google providers; OpenAI-compatible, Anthropic and Ollama paths are
  unchanged, and the caller-side zod parse remains the output
  validator.
- **The structured chat-model decision engine now works with Gemini.**
  The engine sent two system messages (steer + tool catalog); Gemini's
  adapter only accepts one system message in first position, so every
  decision attempt failed with "System message should be the first one"
  and fell through to chat. The prompt and catalog now ride a single
  system message.
- **Fall-through traces name the engine that actually ran.** A failed
  decision attempt was always traced as "Decision · Needle" even when
  the structured chat-model engine was selected; the failure status now
  carries the resolved engine and the trace renders "Decision · Chat
  model" accordingly.
- **Decision engine ignored non-Latin input.** The lexical tokenizer only
  recognized ASCII (`a-z0-9`), so Greek (and any non-Latin) queries
  produced zero tokens — the candidate pass skipped the engine entirely:
  no routing, no tool dispatch, and no Decision trace row on plain
  turns. Tokenization is now Unicode-aware (letters/digits in any
  script, accents folded, Greek final-sigma plurals trimmed like
  English `s`), and route-tool example lines in non-Latin languages now
  mine working keyword tags.

- **Fast-path posture consistency.** `appContextFor` filters
  ineligible presets' apps, so the decision prompt no longer carries
  the device digest (or skill lines) for tools the surface excludes —
  no more dangling context teaching the engine to refuse.

## [v0.7.0] - 2026-09-19
### Changed
- **Flatter Tools sub-tabs.** The Tools panel itself (verification
  defaults above, native tool catalog below a thin divider) and the
  Memories, Web search, Translation, Decisions and Folders panels render
  directly on the tab — the outer bordered boxes are gone; the tab
  already frames the section.
- **Reworked app cards (Apps tab).** Cards now use the family `Card`
  compound: the app name owns a full-width row (the enable switch lost
  its inline label — it stays available to screen readers via its aria
  label), health/status shows as a color-dotted chip in the badge row,
  and actions sit on a footer divider — **Edit** (renamed from the
  vague "Details"), **Test**, and a danger-tinted **Remove** with a
  trash icon. Cards lift on hover.
- **Native tools and folder access are separate Tools sub-tabs.** The
  Tools tab's first section previously stacked verification defaults,
  the native tool catalog and granted folders into one scroll; the
  catalog (with its defaults) now lives on **Tools** and folder grants
  plus docs indexing move to a dedicated **Folders** sub-tab.
- **Uniform tabs across the settings window.** The API settings section
  switcher (Providers / Models / Task Assignments), the Apps tab's
  Apps/Settings view switcher and its detail-modal Connection / Tools /
  Scope switcher, and a new Tools-tab section switcher (Tools / Memories
  / Usage / Web search / Translation / Decisions) all render the family
  library's `SegmentedTabs` — one pill-style, keyboard-navigable
  component (roving tabIndex, arrow/Home/End keys) instead of three
  hand-rolled strips; the Tools tab's previously stacked sections now
  live one click apart.
### Added
- **Acknowledgments.** A `THIRD-PARTY-NOTICES.md` (linked from the README's
  new Acknowledgments section) credits Cactus Compute's Needle project —
  the vendored Apache-2.0 wasm runtime and the pinned `needle3` weights
  the optional local decision engine is built on.
- **Needle model credit.** The Decision card shows a compact credit line
  ("Needle 3 · Cactus Compute · Apache-2.0") whenever the local Needle
  engine is selected, linking to the model's Hugging Face page (opens in
  the system browser; the vendored runtime keeps shipping its LICENSE).
### Changed
- **Decision scope is now fully opt-in.** A freshly enabled decision
  engine dispatches nothing until you opt in: the built-in tool
  vocabulary (open apps/URLs, screenshots, volume, …) defaults to OUT
  of scope alongside the empty app allowlist — previously the built-ins
  stayed dispatchable even with no apps selected. Opt back in with the
  "Include built-in tools" switch in Settings → Tools → Decision; the
  card shows an idle hint while nothing is in scope. Configs that
  explicitly saved the switch keep their setting.
### Added
- **Decision scope, route tools and prompt steer (plan 20 S7a).** The
  decision engine's tool surface is now user-scoped and steerable.
  `config.decision.scope` allowlists tool apps (precision-first: empty
  default = no app tools in scope) and can exclude the curated built-in
  vocabulary. Custom **route tools** turn the engine into a router: a
  picked route tool hands the input to a normal chat/agent turn pinned
  to a chosen model — a validated hand-off (`name` pattern, unique,
  `modelId` must resolve; unresolvable models skip the tool with a
  warning), never an execution. An extra prompt (≤1000 chars) plus
  per-route-tool example lines are assembled into the engine system
  prompt in one place (`ai/decide/prompt.ts`) and consumed by both the
  needle and LLM engines. Routing dispatch: a picked route tool starts a
  normal turn on the routed model (agent or stream by that model's own
  capability) with a "routed to …" trace step and metadata provenance;
  a missing model or key falls through to the chat turn. Settings
  (Tools tab Decision card): app scope multi-select with an idle-hint
  for an empty scope, built-in-tools switch, route-tool add/edit/remove
  (name, description, model select from configured models, example
  lines) and the extra-prompt textarea — all strings via `TEXT`,
  axe-scanned with the ToolsTab.
### Fixed
- **Fast-path failures now repair through the agent.** When a decision-
  dispatched tool errors (e.g. Home Assistant couldn't match the target),
  the turn no longer dead-ends on the raw error: it falls through to the
  standard agent turn in the same conversation, seeding the trace with
  the failed attempt so the whole story stays visible. The agent's
  `enable_app` activation now traces with a readable summary
  ("Activating 'Home Assistant'…") instead of raw JSON, and decision
  fall-throughs (low confidence / compound request / engine error) show
  a "Decision · Needle" step in the agent's trace too.
- **Decision fast path skipped app tools on a cold MCP cache.** The
  decision surface projected app tools only from the manager's cached
  listing — which the agent path never populates (it connects lazily
  via `enable_app` without caching tool descriptions), so after every
  app start the first commands always fell through to the agent. The
  decision surface now warms the listing itself (settings-path
  `listServerTools`, bounded 2.5 s, fail-soft) and projects from it.
  The agent's on-demand activation is untouched — the decision engine
  preselects candidates locally, so warming costs one listing call and
  zero extra LLM context.
### Added
- **Decision trace step.** When a decision engine dispatches a tool,
  the turn trace now shows a "Decision · Needle" (or "· Chat model")
  step with the confidence and the act/confirm band — so the local
  model is visible in the same place the chat model's work is. The
  provenance was already persisted in message metadata and the
  `ai_calls` audit table (`intent` task, model `needle3`); it is now
  visible in the trace UI too.
### Fixed
- **Decision fast path never saw app tools; mispicks on big catalogs.**
  Two defects from the first live run: (1) the projected tool surface
  was capped at 40 and the native registry alone filled it — connected
  app tools (e.g. Home Assistant) were invisible to the engine;
  (2) with a 40-tool catalog the local model mispicked (it tried to set
  the monitor brightness for "dim the living room") at confidence 1.0.
  The surface now carries a curated dispatch vocabulary: native tools
  project only tagged, dispatch-worthy entries (power/shell/kill family
  excluded outright), app tools keep their authored keyword tags, and a
  lexical preselection pass (the plan-15 D17 pattern) ranks a small
  candidate set for the engine — measured on the real model: correct
  picks at honest confidences in ~600-700 ms, and off-topic inputs skip
  the engine call entirely. Fall-through reasons are now logged
  (`[decision] …`) for observability.
### Added
- **Decision engines settings (plan 20, stage 5 — the feature is now
  fully user-facing).** Settings → Tools gains a "Decision engine" card:
  pick the engine (off / chat model with structured output / local
  Needle), tune the act/confirm confidence thresholds, download the
  local model (~34 MB, pinned + checksum-verified, cancellable, offline
  afterwards), and try it with a test command that shows what the
  engine would pick — nothing executes. The API tab also gains the
  "Decisions (intent)" task row for assigning a specific model to the
  LLM engine. Everything stays optional and off by default.
### Fixed
- **Palette app-tool dispatch.** Executing an app tool from the command
  palette (plan 15 S6 rows, e.g. Home Assistant) failed with "Unknown
  tool" — the direct-dispatch host only knew native registry tools.
  App/MCP tools now execute through the same direct turn: effective
  risk (per-app overrides), the D18 entity-scope guard (out-of-scope
  device ids are rejected before execution, mirroring the agent
  bridge), timeouts and result capping identical to native tools.
### Added
- **Direct MCP execution + HA fast path (plan 20, stage 4).** With a
  decision engine enabled, "dim the living room to 30" can now run
  entirely through the Home Assistant tool app: the engine picks the
  app's tool from the projected surface (descriptions include the
  entity-id format), the dispatch validates the entity against the
  app's configured scope, and the call executes over the app's MCP
  server — approvals unchanged for state-changing actions.
- **Decision fast path in turns (plan 20, stage 3 — for users who enable
  a decision engine in config; default OFF changes nothing).** Short,
  plain composer inputs (no attachments, no slash command, no research
  flow) may now dispatch directly to a tool via the decision engine
  chosen in `decision.engine` — riding the exact same direct-tool turn
  as slash commands: unchanged risk policy, approvals, trace steps and
  audit rows. A confident single-call decision executes immediately;
  a mid-confidence one raises the approval card first; compound,
  low-confidence or failing decisions fall through to the normal
  chat/agent turn. Engine provenance (engine, confidence, band) is
  recorded in the assistant-message metadata. No settings UI yet —
  engines are enabled via `config.json` (`decision` block).
- **Local Needle decision engine (plan 20, stage 2 — groundwork, not yet
  user-visible).** The local engine behind the stage-1 decision funnel:
  the Needle 3 wasm runtime (Cactus Compute, Apache-2.0) is vendored
  pinned (revision + SHA-256) and runs isolated in a utility process
  (serialized operations, per-op timeout, crash-safe); the 35 MB model
  weights download is user-initiated, checksum-verified and atomic, and
  the engine works fully offline afterwards (no telemetry — asserted in
  tests). Engine output is zod-validated; a hallucinated tool name is a
  hard error, never a silent drop. Not reachable from the UI yet —
  turn routing and settings land in later stages.
- **Decision engines (plan 20, stage 1 — groundwork, not yet user-visible).**
  New optional capability for local/cloud intent routing and tool
  dispatch (Home Assistant fast paths, model routing), default OFF.
  Foundation only in this stage: the `intent` AI task (audited like
  every gateway call), `config.decision` settings (engine kind +
  act/confirm confidence thresholds), the decision funnel
  (`src/main/ai/decide/` — resolve → invoke → validate → audit →
  act/confirm/refuse band), and the LLM structured-output engine that
  runs on existing provider models. The local Needle engine, turn
  routing, and settings UI land in later stages; with the engine off,
  behavior is byte-identical to before.
- **Per-OS autostart.** "Launch on system startup" (Settings → General)
  now actually works everywhere and starts the app hidden in the tray
  on Windows and Linux (`--hidden` boot; on macOS the window opens —
  Electron has no hidden-launch flag). Linux is managed by the app
  itself via the XDG autostart entry (`~/.config/autostart/`), since
  Electron's login-item API is macOS/Windows-only; Windows registers
  with a `--hidden` argument. The toggle disables itself with a hint
  in development builds, a second app launch reveals an already-running
  instance even when it sits hidden in the tray, and the real OS state
  is exposed via the new `system:autostart-status` channel.
### Fixed
- **Startup composer focus.** The input area now auto-focuses when the
  app opens: the first window show (app boot / window recreation) never
  sent the `focus-input` push — only re-summons did. The composer now
  focuses on mount (`useChatSession`), which also fixes the desktop
  window, which had no focus push path at all.

## [v0.6.0] - 2026-09-18
### Changed
- **Translate pad polish (user feedback).** Long translations render in
  a multiline result panel styled like the response area — wrapped,
  scrollable, capped at the response-height budget, window grows with
  content — with an engine/route footer (`via DeepL · en → el`) and an
  always-visible copy button (was a single truncated line). The mini
  app mode bar is now a drag region: the window can be moved from the
  Translate/Calculator header (the exit button stays clickable).
- **Translate pad: configurable, conservative auto-send.** New
  `translation.padDebounceMs` (default 1500 ms, clamped 300–10000;
  was a fixed 700 ms) controls how long the pad waits after the last
  keystroke before sending — configured in the Tools-tab Translation
  card. The "Translating…" indicator now appears only while a request
  is actually in flight (the previous build showed it immediately on
  every keystroke), and the previous result stays visible until the
  next one replaces it.
### Added
- **Plan 19 S6 — translate pad mini app.** Bare `/tr` (or `/tr <lang>`
  with no text) opens the launcher translate pad instead of a usage
  error: debounced live translation (~700 ms, latest-call-wins),
  result row with hover copy, Enter copies (calc-consistent), pending
  and typed-error states inline, target language carried from the
  opening slash and shown in the mode bar. Runs over the new direct
  `translation:translate` IPC — no turn, no persistence, same
  `TranslateService` funnel (engines, failover, audit). The calc mini
  app is byte-identical (guarded sync path); `/tr <lang> <text>`
  keeps the direct turn fast path. Pad ships with event tests and an
  axe scan (zero exclusions).
- **Plan 19 S5 — translation docs sweep.** Architecture: AI-layer map
  entry for `src/main/ai/translate.ts` (the sanctioned service-engine
  module) and the Translation tool/section write-up; STATUS: plan-19
  row, phase note, on-target smoke checklist (LibreTranslate/DeepL
  live pass, custom-language turn, agent-path turn, kill switch,
  provider test). Plan 19 complete.
- **Plan 19 S4 — translation settings.** New Tools-tab Translation
  section (mirroring the Web-search card): engine-mode selector
  (`auto`/`service`/`llm`), default-target picker (custom languages
  first, then the built-in ISO-639-1 table), the custom-languages
  editor (code + name + optional native name with inline validation —
  built-in collisions, duplicates and malformed codes are rejected
  client-side and re-validated at config merge), and the ordered
  service-provider list (enable/reorder/edit/test/delete, keys
  keyring-only behind masked hints). Removing a custom language also
  clears a matching default target. The API tab gains the
  `TRANSLATE` AI-task row (`requires: 'text'` — the LLM engine
  assignment; no chat fallback). Section ships with an axe scan
  (zero exclusions) and config round-trip coverage; existing
  Tools-tab and Settings-app a11y suites extended for the new bridge
  methods.
- **Plan 19 S3 — the `translate` tool and `/tr` slash command.** New
  read-only native tool backed by `TranslateService` (service engines
  or the LLM task; agent-callable like any native tool, subject to the
  usual policy). Slash aliases `/tr` and `/translate` with the
  `/tr [language] <text>` grammar: the first token is the target only
  when it names a language (built-in or custom), everything after it
  is the text, a lone language token is a usage error, and an omitted
  target falls back to `translation.defaultTarget` (a clear error when
  unset). Results render with an engine/route meta line
  ("via DeepL · en → el"). Palette row + inspector example come from
  the shared alias table; both windows share one submit-time resolver.
  Event-driven turn test drives the real registry through the
  direct-tool channel; a scripted-graph smoke covers the agent path.
- **Plan 19 S2 — translation service engines + provider management.**
  DeepL and LibreTranslate fetchers live in `src/main/ai/translate.ts`
  (the sanctioned AI-layer module): DeepL v2 API with `:fx` free-key
  endpoint routing and typed auth/quota errors; LibreTranslate `/translate`
  with auto source detection and server-error passthrough; both cap
  output, honor per-provider timeouts (default 10 s, clamp 1-30 s) and
  external aborts, and write `translate`-task `AiCall` audit rows.
  `TranslateService` gains search-style provider CRUD (`save/delete/
  enable/move/test`), keys stripped to the keyring behind `keyHint`
  masking, `assertHttpUrl` SSRF posture, and ordered failover across
  enabled instances. New `translation:*` IPC surface (get/save/delete/
  set-enabled/move/test) exposed through the preload bridge and
  documented in `docs/ipc.md`.
- **Plan 19 — custom language codes.** Users can define their own
  target languages (custom codes/scripts, e.g. Ancient Greek) under
  `translation.customLanguages` (`{code, name, nativeName?}`); entries
  are sanitized at config merge (2-12 chars `[a-z0-9-]`, lowercased,
  no built-in collisions, duplicates dropped) and `defaultTarget`
  validates against built-ins + custom codes. One resolution helper
  (`resolveLanguage`) serves validation and the LLM prompt carries the
  custom name; the settings editor lands with the plan-19 S4
  Translation card.
- **Plan 19 S1 — translation substrate.** New `translate` AI task
  (`AiTask.TRANSLATE`, no chat fallback), `translation` config section
  (`mode: auto|service|llm`, `defaultTarget`, ordered `providers` with
  merge-time validation of mode and default target), a shared ISO-639-1
  language table (`src/shared/languages.ts`), the `src/main/ai/
  translate.ts` engine module (translation prompt builder, output
  normalizer with fence/quote stripping and an 8k result cap, 10k input
  cap, LLM engine through the gateway at `temperature: 0`, pure engine
  dispatcher) and the `TranslateService` shell — uniform
  `translate({text, target?, source?})` entry with ordered service
  failover, keyring-resolved keys, abort propagation and typed errors
  for every unconfigured path. Service fetchers land in S2.

## [v0.5.0] - 2026-09-18
### Changed
- **`mcp:*` compat channels retired (plan-15 polish exit).** The seven
  plan-11 IPC channels (`mcp:get-servers` … `mcp:list-tools`), their
  preload bridge methods and the Tools-tab MCP server card are gone —
  MCP servers are managed exclusively as tool apps through the
  `apps:*` surface and the Apps tab (full parity: connection editor,
  secrets, allowlist/timeouts, per-tool enable/risk, tests). The
  Tools-tab native list no longer mixes in MCP catalog rows;
  `AppService.mcpServerViews/saveMcpServer/setMcpToolOverride` and the
  now-unused `McpServerView`/`McpServerSaveInput` shared types were
  removed with them.
### Added
- **Plan-15 polish, per-app usage analytics.** New `apps:usage-stats`
  IPC over the existing `tool_calls` audit: `AppService.
  appDisplayNameForTool` attributes each call to its app (backing MCP
  server or native-group membership; unattributed native/command calls
  are excluded) and `getAppUsageStats` aggregates totals, outcomes and
  average durations per app. The Apps tab settings sub-view gains an
  "App usage" card (7/30/all windows, CSS bars, no chart lib).
- **Plan-15 polish, tool-cache TTL refresh.** MCP tool snapshots now
  carry a fetch timestamp (`McpManager.cacheAgeMs`); whenever the
  settings Apps tab fetches state (`apps:get-state`), `AppService`
  fire-and-forget re-lists enabled apps whose cached snapshot is older
  than `TOOL_CACHE_TTL_MS` (5 min) or missing — never blocking the
  response, deduped while in flight, failures swallowed so a down
  server keeps serving its stale snapshot.
- **Plan-15 polish, Apps tab batch.** Lucide icon picker per app
  (curated 46-icon set in `settings-react/apps/app-icons.tsx`, saved as
  `app.icon` via the existing spec validation; cards render the picked
  icon, falling back to the name monogram), the app list is a
  two-column card grid (`sm:grid-cols-2`), and the app-detail Tools
  tab gains a filter box (name/description/keyword tags) plus
  risk-tier group headings with counts.
- **`datetime` native tool.** Feature-rich date/time/timezone tool
  (`src/main/ai/tools/native/datetime.ts`, category `system`,
  read-only, auto-run): `now` snapshot (epoch, ISO week, quarter,
  leap year, day of year), `format` (ISO / RFC 2822 / unix /
  unix_ms / full-long-medium-short presets / `%`-token template
  with optional locale), `convert` (DST-aware IANA timezone
  conversion), `shift` (calendar-aware add/subtract with month-end
  clamping), `diff` (units + calendar + business days), `info`
  (calendar facts), `relative` ("in 3 days" / "2 hours ago"),
  `countdown`, `week`,   `business-days`. Accepts ISO 8601, epoch
  seconds/millis, `now`, or `today` inputs; calling it with no
  arguments returns the full current `now` snapshot. Pure date math helpers
  are exported for tests (`tests/datetime-tool.test.ts`, 21 cases).
### Changed
- **Settings modals adopt `ModalBody` from `@neuronection/assistant-ui`.**
  The padded body region (`px-6 pb-6`) that every settings modal hand-rolled
  (Api, Automation, Commands ×3, Search, Apps ×2, Tool details) is now owned
  by the library layout — `ModalHeader` / `ModalBody` / `ModalFooter` carry
  their spacing; callers pass only content. Also fixes the Apps detail/add
  modal bodies, which previously rendered without horizontal padding.
  Dep bumped to `@neuronection/assistant-ui@^0.42.0` (0.41.0 shipped
  `ModalBody`).
### Changed
- **Provider model-catalog fetching moved into the AI layer (ADR-0018).**
  The per-provider branches (OpenAI-compatible `/models`, Anthropic
  `/v1/models`, native Gemini `v1beta`, Ollama `/api/tags`) now live in
  `src/main/ai/catalog.ts` — the sanctioned non-chat-endpoint surface,
  keyed at call time like TTS. `AIService.fetchAvailableModels` is a
  thin wrapper (key-presence check + delegate); behavior, error copy
  and the returned `Model[]` shape are unchanged. Satisfies the
  family alignment gate's R5 — desktop is strict again.
- **Details modal tabbed + tool cards (plan 15 polish).** The app
  Details modal is now tabbed — Connection / Tools / Scope — and the
  Tools list renders as multiline cards (name + risk chip, description
  line, keyword-tags editor full-width with the risk override beside
  it), with tool descriptions straight from the server cache. Saving
  scope rules no longer kicks the user back to the first tab.
- **Apps tab redesigned (plan 15 polish).** Apps / Settings sub-views;
  richer app cards (two-line descriptions, source + health + bound-tool
  chips); unified "Add app" flow — From preset (cards with per-preset
  risk preview) or Custom MCP server; tool budget moved into the Apps
  Settings sub-view with a usage bar, plus the all-apps master switch
  and matching help.
### Added
- **Add custom apps from the Apps tab (plan 15).** "Add custom app"
  creates a preset-free app from a raw MCP server config — streamable
  HTTP, SSE or a local stdio command, with an optional bearer token
  (keyring-stored). Completes the D11 move: the Apps tab is now the only
  place apps are added; the Tools-tab MCP form keeps working through the
  compat layer and will retire with it.
- **Agent-side app router (plan 15).** Every enabled app appears in the
  agent's context as one directory line (name + short description), and
  the agent can activate an app mid-turn with an `enable_app` tool call —
  its tools become callable for the rest of the conversation without a
  user round-trip. This makes discovery language- and synonym-agnostic
  (the model is the router), covers exactly the keyword-matcher's blind
  spots, and enforces the tool budget at activation. Routing is scoped to
  user-enabled apps; policy, approvals and audit still gate every
  execution. Enabled apps persist per conversation thread.
- **Standing per-app directives (plan 15).** Each tool app can carry
  user-authored standing directives (capped, 500 chars) — e.g. "For all
  Home Assistant tools use the app tools, never shell commands" — that
  are injected into every turn's system prompt while the app is enabled,
  regardless of whether the app is bound. Rendered as fenced,
  app-labeled blocks, distinct from preset `promptNotes` (reference
  data, bound-only). Edited in Apps → Details; the model and servers
  can never write them.
- **Tool apps in the palette (plan 15 S6).** Enabled app tools appear in
  the command palette (source `mcp`, grouped under Integrations) and
  dispatch through the standard turn path — no new execution channel.
  Destructive and kill-switched tools are excluded; server-down rows are
  flagged disabled with their cached descriptions; integration-pack rows
  bound to a tool an enabled app exposes are suppressed from the catalog
  and resurface when the app disables or is removed (D12). The inspector
  tool catalog carries `appName` + inline health for app tools. Plan 15
  complete: S1 foundations, S2 per-turn selection, S3 deferred search,
  S4 HA preset + entity scoping, S5 Apps tab, S6 palette.
- **Settings → Apps tab (plan 15 S5).** App list (source chip, health
  chip + last error, enabled switch, search + status filters), detail
  modal (connection editor with keyring-only token, per-tool table with
  new-tool markers and tighten-only risk overrides + undo, entity-scope
  rule editor with a live device preview via `apps:preview-scope`,
  exposure selector gated on provider tool-search support), preset card
  with permission preview before add, and a tool-budget card (budget is
  now `config.toolApps.toolBudget`, enforced by the selection engine).
  The Tools tab keeps native-tool toggles only — its MCP section moved
  here (D11). Axe scans exclusion-free.
- **Home Assistant preset + scope enforcement (plan 15 S4).** The
  flagship bundled preset (zod-validated manifest, versioned) ships the
  D10 default risk map — status/list/filter tools read-only, control
  state-changing, nothing destructive — plus fenced `promptNotes`
  capability guidance injected only while the app is bound, and help
  copy recommending a restricted HA user token as the strongest device
  scoping. Preset-authored data (`baseRisk`, entity role/arg,
  `promptNotes`) is main-owned: renderer submissions are stripped and
  new tools are stamped from the preset template at reconcile (D13).
  D18 `entityScope` is now enforced at the bridge: action tools'
  entity arguments are validated before dispatch (out-of-scope calls
  skip the approval card and get an honest error) and discovery
  results are filtered before the model sees them. Trajectories run
  against a real streamable-HTTP MCP fixture: dim-lights
  match→approval→resume, scoped list/control, and server-down
  degradation. `apps:list-presets` serves the bundled presets (add-flow
  preview lands in S5).
- **Deferred tool search for tool apps (plan 15 S3).** Apps with
  `exposure: 'deferred'` bind unconditionally behind the provider's
  server-side tool search on capable models (Claude Sonnet 4+/Opus 4+/
  Haiku 4.5+, gpt-5.4+ on the real OpenAI API — the installed
  middleware gates the concrete model and throws elsewhere), staying
  outside the 25-tool budget (flat context). Capability detection lives
  in the model factory seam and runs before the search middleware is
  ever constructed; incapable providers silently fall back to
  `relevance` semantics. `apps:get-state` now reports
  `deferredSupported` for the active chat model (settings gating lands
  with the Apps tab in S5).
- **Per-turn tool-app selection (plan 15 S2).** The agent now curates
  app tools every turn: `always` apps bind unconditionally, `relevance`
  apps match a deterministic whole-token matcher (D17 — normalized,
  substring-proof; the app name is an implicit tag) with a 2-turn
  sticky window so follow-ups like "now the bedroom too" stay bound
  (D15), and everything else is dropped under a 25-tool budget guard
  that drops `relevance` before sticky apps in spec order and never
  drops `always` apps. A dropped app surfaces as a capped, config-only
  availability hint so the model can offer it by name (D16) plus an
  "App selection" trace step in the turn timeline. Unbound app tools
  are rejected by a `wrapToolCall` guard and excluded from HITL
  `interruptOn`, so an approved-on-resume tool always executes (D14).
  `entityScope` enforcement rides the preset stage (S4) per plan.
- **Tool apps foundation (plan 15 S1).** Apps are bundles of tools
  wrapped around MCP servers — the first stage of the tool-apps plan:
  `config.toolApps` (zod-validated `ToolAppSpec`s with per-tool
  `toolState` — denylist posture, tighten-only risk overrides — and
  ordered `entityScope` allow/deny entity patterns), a new
  `AppService` (validated CRUD, self-disable-on-invalid boot
  pipeline, keyring lifecycle `app:<id>:*` with deletion on remove),
  and the `apps:*` IPC surface (get-state / save / remove /
  set-enabled / set-tool-state / set-entity-scope / test-connection).
  MCP-backed apps feed the existing tool substrate unchanged
  (registry, policy, HITL, audit untouched).
### Changed
- **MCP servers now live only inside tool apps (breaking, plan 15
  D11).** `config.tools.mcpServers` and `tools.mcpToolOverrides` are
  removed: a one-time migration wraps every standalone server as a
  custom app (config + per-tool overrides + keyring blobs move;
  `mcp:<id>:*` secrets re-namespaced to `app:<id>:*`). The Settings →
  Tools MCP section keeps working through a compat view over the app
  store until the Apps tab ships (plan 15 S5); per-tool risk edits on
  that legacy surface keep plan-11 semantics (any risk, written as
  the app's authored baseline), while the new `apps:*` surface is
  tighten-only.
- **assistant-ui 0.39 → 0.40**: `ChatToolsCatalog` entries accept an
  optional `badge` chip (`{ label, tone?: 'info' | 'warning' }`) beside
  the tool name — groundwork for marking non-callable HITL capability
  rows (ADR-0015) distinctly from callable tools.
### Fixed
- **App tools vanished for a turn when the MCP reconnect failed.** A
  failed reconnect (or backoff window) left the app with zero tools —
  the model improvised with unrelated tools instead. Now the last known
  tool list stays bound as unreachable placeholders: invocations return
  an honest "server unreachable" observation, the app-selection trace
  step names unavailable apps distinctly (`tools could not be loaded`)
  instead of a generic no-match, and no approval is wasted on calls that
  cannot succeed.
- **App matcher missed plural queries** ("turn on the lights" vs a
  `light__…` tool): D17 normalization now stems trailing `s` on both
  query and vocabulary tokens (4+ chars), preserving exact matches while
  adding plurals. The Apps-tab detail modal also gains a per-tool
  keyword-tags editor — the user-facing lever for teaching the matcher
  server-specific tool names (HassMCP-style `domain__Action` names carry
  no plan-preset tags).
- **The Apps-tab budget card counted only app tools while the selection
  engine counts native + command + app tools** — a toolset could be over
  budget (whole apps dropped for the turn) with no warning shown. The
  card now shows the engine-accurate total (native + apps) and warns
  against the configured budget.
- **App health chip said Unavailable after a successful connection test.**
  The settings path (Test / tool listing) never updated the MCP server
  state to `connected` — only the agent path did — so the Apps tab row
  chip lagged reality. Connection success now marks the server
  connected (and clears reconnect backoff) on every path; the Apps-tab
  tool list also states that changes apply immediately.
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
