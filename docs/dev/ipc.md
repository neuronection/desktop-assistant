# IPC surface (generated)

> Generated from `src/shared/ipc/registry.ts`. Do not hand-edit:
> run `node scripts/generate-ipc.mjs` and commit the diff.

The preload bridge (`src/preload/createPreloadApi.ts`, exposed as
`window.electronAPI`) is the **only** renderer→main channel. Every
channel is a descriptor in the registry; the bridge surface, the main
registration wrapper and this document are projections of that one
source.

## One pattern

1. Add a descriptor in `src/shared/ipc/registry.ts` (channel, direction,
   window scope, zod request tuple, response type, preload bridge,
   summary).
2. Register the handler with `register(IPC['channel'], handler)` from
   the domain registrar under `src/main/ipc/` (mini-apps:
   `src/main/apps/ipc.ts`).
3. The wrapper validates args through the descriptor, enforces window
   scope at invoke time and shapes errors with the one
   `ipc:<code>: message` vocabulary.
4. Run `node scripts/generate-ipc.mjs` to regenerate this file.

`invoke` is `ipcMain.handle` (request/response); `send` is
`ipcMain.on` (fire-and-forget renderer→main); `event` is a
main→renderer push exposed as an `on*` bridge subscription.

## Registry

### ai

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `ai:fetch-models` | invoke | all | `[unknown]` | `unknown` | fetchAvailableModels (invoke) | ai IPC channel. |
| `ai:test-provider` | invoke | all | `[unknown]` | `unknown` | testProvider (invoke) | ai IPC channel. |
| `ai:tts-synthesize` | invoke | all | `[string, boolean?]` | `unknown` | synthesizeTts (invoke) | synthesizes speech for a finished reply via the `tts` task assignment (OpenAI-compatible `/audio/speech`, native Gemini `generateContent` for GOOGLE providers — sanctioned `src/main/ai/tts.ts`, audited); returns `{ audioBase64, mime }`, `null` when the toggle is off / no model is assigned, or rejects with a compact error (status-mapped, `compactTtsError`) that the renderer shows as a notice |
| `ai:turn-cancel` | invoke | all | `[]` | `unknown` | cancelTurn (invoke) | cancel the in-flight turn (partial text is kept; during an approval the pending calls are denied) |
| `ai:turn-resume` | invoke | all | `[unknown]` | `unknown` | resumeTurn (invoke) | resolve the pending tool approval (`decisions` aligned with the interrupt batch + optional grant scope); false when nothing is pending (second responder = no-op) |
| `ai:turn-start` | invoke | all | `[unknown]` | `unknown` | startTurn (invoke) | start a main-owned chat turn (persists the user message, streams through the gateway); optional `flow: 'research'` routes the turn through the research flow graph (plan 13) instead of the standard chat/agent path; `branch` carries an edit/regenerate anchor whose user row was already persisted by `messages:edit`/`messages:regenerate`. Returns `{ tempMessageId, queued }` — a same-conversation send behind an active turn waits instead of streaming concurrently (plan 40 D3) |
| `stt:transcribe` | invoke | all | `[custom]` | `unknown` | sttTranscribe (invoke) | speech-to-text (the assigned `stt` task model; honors `voice.language`) |
| `voice:evaluate-utterance` | invoke | all | `[string, string?]` | `unknown` | evaluateUtterance (invoke) | voice-endpoint verdict `{ complete }` for a dictated phrase (fails closed on unassigned model, `voice.autoSend` off, errors, or timeout); the auto-send judge is selectable (`voice.autoSendEngine` — the assigned boolean-gate decision model, or this assigned `voiceEndpoint` model in `task` mode) |

### apps

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `apps:context-digest-stats` | invoke | settings | `[]` | `unknown` | getToolAppDigestStats (invoke) | plan 23 S6 readout: cached digest stats per enabled app (`{ entities, ageMinutes }`, raw pre-scope-filter rows; cache-only — never triggers a fetch). Empty when `behavior.appContext` is off |
| `apps:get-state` | invoke | settings | `[]` | `unknown` | getToolApps (invoke) | tool-app list (plan 15): spec + health + masked secret key names + known-tool rows (`state: null` = new tool pending surfacing), plus `deferredSupported` for the active chat model (S3); fetches also kick the stale-snapshot TTL refresh (5-min, background, fail-soft) |
| `apps:list-presets` | invoke | settings | `[]` | `unknown` | listToolAppPresets (invoke) | bundled, reviewed tool-app presets (Home Assistant first) for the add-flow permission preview; preset-authored data is applied main-side on save |
| `apps:preview-scope` | invoke | settings | `[string, object[]]` | `unknown` | previewToolAppScope (invoke) | runs the app's first discovery tool and returns its discovered entity ids split by the draft scope rules (same matcher as bridge enforcement) — seeds the Apps-tab device-scope preview |
| `apps:remove-app` | invoke | settings | `[string]` | `unknown` | removeToolApp (invoke) | remove an app, its backing server config, and all of its keyring blobs |
| `apps:save-app` | invoke | settings | `[object]` | `unknown` | saveToolApp (invoke) | main-validated create/update of a `ToolAppSpec` (zod + uniqueness + native-name resolution + tighten-only risk); `env`/`headers` values are stripped into the keyring (`app:<id>:*`) on receipt; an optional `authToken` is merged into the stored headers blob as `Authorization: Bearer …` main-side (sibling headers preserved — the renderer never sees stored secret values, so it cannot merge client-side); renderer-authored `baseRisk`/entity-role and `promptNotes` values are stripped — preset id + stored data own the authored layer |
| `apps:set-enabled` | invoke | settings | `[string | null, boolean]` | `unknown` | setToolAppEnabled (invoke) | master switch (`appId: null`) or per-app enable; re-enabling a validation-disabled app is rejected with the surfaced error |
| `apps:set-entity-scope` | invoke | settings | `[string, object | null]` | `unknown` | setToolAppEntityScope (invoke) | ordered allow/deny entity-pattern rules (MCP-backed apps only) |
| `apps:set-tool-state` | invoke | settings | `[string, string, object | null]` | `unknown` | setToolAppState (invoke) | per-tool curation inside an app (enabled / keyword tags / tighten-only risk override; `null` resets to default-enabled) |
| `apps:test-connection` | invoke | settings | `[string]` | `unknown` | testToolApp (invoke) | force a connection (latency + tool count) and reconcile `toolState` against the live tool list |
| `apps:usage-stats` | invoke | settings | `[unknown]` | `unknown` | getAppUsageStats (invoke) | read-only per-app aggregation of the `tool_calls` audit over a 7/30-day or all-time window; rows attributed via AppService (MCP server name/namespaced tool or native-group membership), unattributed calls excluded (plan-15 polish) |

### commands

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `commands:clear-history` | invoke | all | `[]` | `unknown` | clearCommandHistory (invoke) | wipe the `CommandInvocation` table (Settings → Commands history card) |
| `commands:delete-custom` | invoke | all | `[string]` | `unknown` | deleteCustomCommand (invoke) | remove a custom command by id |
| `commands:execute` | invoke | all | `[string, string[], literal | literal | undefined]` | `unknown` | executeCommand (invoke) | user-initiated execution of builtin/web/app commands in main (`{ status: 'done' / 'turn' / 'error' }`); tool-backed entries return `turn` — they ride `ai:turn-start` with `directTool.commandId` so the policy path is unchanged; builtins may return `turn` with a `prompt` and a named `flow` (`'research'` — plan 13) to start a flow turn; records `CommandInvocation` (args stored for read-only builtins only) |
| `commands:get-app-icon` | invoke | all | `[string]` | `unknown` | getAppIcon (invoke) | lazily resolve an app's icon to a raster-only data-URL (PNG/JPEG/WebP — SVG/XPM rejected at this seam); `null` → renderer monogram tile |
| `commands:get-catalog` | invoke | all | `[]` | `unknown` | getCommandCatalog (invoke) | assembled catalog snapshot (`CommandCatalogSnapshot`): entries from native tools (destructive/kill-switched excluded) + builtins (nav set, calculator, file search), recent ids from `CommandInvocation`, pins from `commands.pins`; `commands.hidden` and the `commands.enabled` kill switch applied |
| `commands:import-integration` | invoke | all | `[string, Record<string, string>]` | `unknown` | importIntegration (invoke) | validate a declarative `integration.json` manifest (version 1, zod) and install it; `${secret:name}` header refs are stored to the keyring at import and only the refs persist in config — values never round-trip |
| `commands:refresh-apps` | invoke | all | `[]` | `unknown` | refreshApps (invoke) | force an app-discovery rescan; returns `{ count }` — otherwise the scan is cached and refreshed by directory mtimes |
| `commands:remove-integration` | invoke | all | `[string]` | `unknown` | removeIntegration (invoke) | remove an installed pack and delete its keyring secrets |
| `commands:save-custom` | invoke | all | `[object]` | `unknown` | saveCustomCommand (invoke) | create/update a user-defined command (tool wrapper or prompt) — main validates tool binding, template arity and reserved aliases before writing `commands.custom` |

### config

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `config:export` | invoke | all | `[]` | `unknown` | exportConfig (invoke) | config IPC channel. |
| `config:import` | invoke | all | `[string]` | `unknown` | importConfig (invoke) | config IPC channel. |
| `config:load` | invoke | all | `[]` | `unknown` | loadConfig (invoke) | config IPC channel. |
| `config:reset` | invoke | all | `[]` | `unknown` | resetConfig (invoke) | config IPC channel. |
| `config:save` | invoke | all | `[object]` | `unknown` | saveConfig (invoke) | config IPC channel. |
| `settings:open` | invoke | all | `[object?]` | `unknown` | onSettingsOpen (invoke) | open/focus the settings window; accepts a `{ tab, section, commandId, miniAppsReportPackId, miniAppsReportRunId }` deep-link (`section` selects an API sub-tab: providers/models/tasks — used by the actionable "no model" banner and first-run entries; the mini-app fields route to the pack card's runs area and pre-open that run's report — used by the launcher's live card and its run-finished banner, plan 27 S2) |
| `settings:save` | invoke | all | `[object]` | `unknown` | saveSettings (invoke) | persist settings |

### conversations

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `conversations:tree` | invoke | all | `[string]` | `unknown` | getConversationTree (invoke) | read-only branch projection `{ activeRootId, nodes }`; every node carries `parentId`, `activeChildId`, `childIds`, `variantIndex`, `variantCount`, `siblingIds` — feeds the desktop tree rail via the library `ChatBranchTree` |
| `db:conversations:clear-all` | invoke | all | `[]` | `unknown` | clearAllConversations (invoke) | conversations IPC channel. |
| `db:conversations:create` | invoke | all | `[string]` | `unknown` | createConversation (invoke) | conversations IPC channel. |
| `db:conversations:delete` | invoke | all | `[string]` | `unknown` | deleteConversation (invoke) | conversations IPC channel. |
| `db:conversations:get-all` | invoke | all | `[]` | `unknown` | getAllConversations (invoke) | conversations IPC channel. |
| `db:conversations:get-by-id` | invoke | all | `[string]` | `unknown` | getConversationById (invoke) | conversations IPC channel. |
| `db:conversations:set-metadata` | invoke | all | `[string, unknown]` | `unknown` | setConversationMetadata (invoke) | per-conversation metadata (model override) |
| `db:conversations:update` | invoke | all | `[string, string]` | `unknown` | updateConversation (invoke) | conversations IPC channel. |

### decisions

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `decisions:get-state` | invoke | settings | `[]` | `unknown` | getDecisionState (invoke) | decision-model settings surface: per-slot readiness over the shared resolver (`slots[]` — assigned/fallback model ids + readiness, plan 26 S1) |
| `decisions:test` | invoke | settings | `[string]` | `unknown` | testDecision (invoke) | run the assigned decision model on a short input against a demo tool set — no execution; returns model/confidence/band/calls + duration |

### docs

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `docs:get-status` | invoke | settings | `[]` | `unknown` | getDocsStatus (invoke) | per granted root: `indexed` flag + indexed file/chunk counts (plan 12 §5) |
| `docs:re-index` | invoke | settings | `[string | null]` | `unknown` | reindexDocs (invoke) | mtime-delta re-index of one root (or all indexed roots with `null`); returns `{ files, chunks, truncated }` |
| `docs:set-indexed` | invoke | settings | `[string, boolean]` | `unknown` | setDocsIndexed (invoke) | opts a granted root into (or out of) the local-docs FTS index; turning on walks + chunks the folder immediately, turning off removes its chunks |

### events

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `ai:turn-event` | event | all | `[]` | `unknown` | onTurnEvent (on) | events IPC channel. |
| `config-updated` | event | all | `[]` | `unknown` | onConfigUpdate (on) | events IPC channel. |
| `focus-input` | event | all | `[]` | `unknown` | onFocusInput (on) | events IPC channel. |
| `hotkey:start-live` | event | all | `[]` | `unknown` | onStartLive (on) | events IPC channel. |
| `hotkey:start-recording` | event | all | `[]` | `unknown` | — | events IPC channel. |
| `hotkey:stop-speaking` | event | all | `[]` | `unknown` | onStopSpeaking (on) | events IPC channel. |
| `launcher:new-conversation` | event | all | `[]` | `unknown` | onLauncherNewConversation (on) | events IPC channel. |
| `launcher:open-palette` | event | all | `[]` | `unknown` | onLauncherOpenPalette (on) | events IPC channel. |
| `launcher:set-mode` | event | all | `[]` | `unknown` | onLauncherSetMode (on) | events IPC channel. |
| `launcher:toggle-expand` | event | all | `[]` | `unknown` | onLauncherToggleExpand (on) | events IPC channel. |
| `live:event` | event | all | `[]` | `unknown` | onLiveEvent (on) | events IPC channel. |
| `session-sync` | event | all | `[]` | `unknown` | onSessionSync (on) | events IPC channel. |
| `settings:navigate` | event | all | `[]` | `unknown` | onSettingsNavigate (on) | events IPC channel. |

### hotkeys

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `hotkeys:get-settings` | invoke | settings | `[]` | `unknown` | getHotkeySettings (invoke) | hotkeys IPC channel. |
| `hotkeys:register-all` | invoke | settings | `[]` | `unknown` | registerHotkeys (invoke) | hotkeys IPC channel. |
| `hotkeys:save-settings` | invoke | settings | `[object]` | `unknown` | saveHotkeySettings (invoke) | hotkeys IPC channel. |
| `hotkeys:start-recording` | invoke | settings | `[]` | `unknown` | startHotkeyRecording (invoke) | hotkeys IPC channel. |
| `hotkeys:stop-recording` | invoke | settings | `[]` | `unknown` | stopHotkeyRecording (invoke) | hotkeys IPC channel. |

### live

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `live:downgrade` | send | launcher, desktop | `[]` | `unknown` | liveDowngrade (send) | live IPC channel. |
| `live:fail` | send | launcher, desktop | `[string]` | `unknown` | liveFail (send) | renderer → main: a typed terminal failure code (`mic_denied`, `mic_lost`, …); session → `error` |
| `live:get-state` | invoke | launcher, desktop | `[]` | `unknown` | getLiveState (invoke) | resync on mount/reload: the authoritative `LiveSnapshot` (`state`, derived `capture`, `downgraded`, `turns`, `session`) |
| `live:interrupt` | send | launcher, desktop | `[]` | `unknown` | liveInterrupt (send) | renderer → main: user-initiated stop of the current reply (button/Escape) |
| `live:mic-ready` | send | launcher, desktop | `[]` | `unknown` | liveMicReady (send) | renderer → main: the mic is open (`arming → listening`) |
| `live:phrase-committed` | send | launcher, desktop | `[string]` | `unknown` | livePhraseCommitted (send) | renderer → main: a VAD-committed phrase transcript; main runs the fail-closed utterance gate, then starts a turn or keeps listening |
| `live:playback-ended` | send | launcher, desktop | `[]` | `unknown` | livePlaybackEnded (send) | live IPC channel. |
| `live:playback-started` | send | launcher, desktop | `[]` | `unknown` | livePlaybackStarted (send) | live IPC channel. |
| `live:set-duplex` | send | launcher, desktop | `[boolean]` | `unknown` | liveSetFullDuplex (send) | live IPC channel. |
| `live:speech-detected` | send | launcher, desktop | `[object]` | `unknown` | liveSpeechDetected (send) | renderer → main: a barge-in candidate (`{ transcript, currentSentence }`); main runs the deterministic ladder + `live-intent` and emits `duck`/`intent` |
| `live:start` | invoke | launcher, desktop | `[string]` | `unknown` | startLive (invoke) | start (or resume) the live session for a conversation id; idempotent — returns the current `LiveSnapshot` |
| `live:stop` | invoke | launcher, desktop | `[]` | `unknown` | stopLive (invoke) | stop the live session (reason `user`); returns the final snapshot |
| `live:warning` | send | launcher, desktop | `[string]` | `unknown` | liveWarning (send) | live IPC channel. |

### memory

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `memory:consolidate` | invoke | all | `[]` | `unknown` | consolidateMemories (invoke) | on-demand smart-merge pass over gray-zone near-duplicates (plan 16 S2); `plumbing`-task arbitration, ≤ 20 pairs per run with a 60 s cooldown; merges record provenance so manager undo restores both sides; returns `{ checked, merged, kept, skipped }` |
| `memory:delete` | invoke | all | `[string]` | `unknown` | deleteMemory (invoke) | forget by id; returns whether a row was removed |
| `memory:list` | invoke | all | `[number?, number?]` | `unknown` | listMemories (invoke) | stored memories (`MemoryView[]`), most recent first, capped |
| `memory:restore` | invoke | all | `[object]` | `unknown` | restoreMemory (invoke) | re-create a deleted memory (undo path) through the normal save/dedupe rules |
| `memory:search` | invoke | all | `[string, number?]` | `unknown` | searchMemories (invoke) | full-text search over memory contents (FTS5, bm25-ranked with exact-match boost; LIKE fallback) |

### messages

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `db:messages:clear-by-conversation` | invoke | all | `[string]` | `unknown` | clearMessagesByConversation (invoke) | messages IPC channel. |
| `db:messages:create` | invoke | all | `[unknown]` | `unknown` | createMessage (invoke) | messages IPC channel. |
| `db:messages:delete` | invoke | all | `[string]` | `unknown` | deleteMessage (invoke) | messages IPC channel. |
| `db:messages:get-by-conversation` | invoke | all | `[string]` | `unknown` | getMessagesByConversation (invoke) | messages IPC channel. |
| `db:messages:update` | invoke | all | `[string, string]` | `unknown` | updateMessage (invoke) | messages IPC channel. |
| `messages:edit` | invoke | all | `[unknown]` | `unknown` | editMessage (invoke) | family branching edit intent: creates a new USER sibling under the edited message's parent, flips that level's pointer, records `metadata.branchedFrom`, and starts a fresh turn on the new branch; returns `{ conversationId, messages, tempMessageId, queued }` with the re-walked decorated active path. The old subtree stays switchable |
| `messages:regenerate` | invoke | all | `[unknown]` | `unknown` | regenerateMessage (invoke) | re-rolls the assistant reply under a USER message: activates the path to that user row when off-path, starts a turn whose new assistant row is a sibling under it, and records `metadata.branchedFrom` (the replaced reply, or the user anchor when none); returns the same mutation envelope |
| `messages:select` | invoke | all | `[string]` | `unknown` | selectMessage (invoke) | level-flip exactly ONE pointer (parent `activeChildId`, or `activeRootId` for a root variant), then returns `{ conversationId, messages }` with the re-walked decorated active path |

### miniapps

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `miniapps:abort-proposal` | invoke | all | `[string]` | `unknown` | abortMiniAppProposal (invoke) | the arming kill switch: not-yet-moved items return to `ask`; already-moved items stay restorable |
| `miniapps:arm-run` | invoke | all | `[string]` | `unknown` | armMiniAppRun (invoke) | HITL Class-B arming (plan 26 S6): re-runs the fail-closed gate (candidate ∧ confidence ≥ the pack threshold ∧ not sensitive) over the run's items and creates a `MiniAppProposal` (pending) — no side effects yet; grouped payload with per-item evidence |
| `miniapps:command-execute` | invoke | all | `[string, string, string[]?]` | `unknown` | executeMiniAppCommand (invoke) | Tier-2 contribution dispatch (plan 32 S3 / ADR-0030): `(packId, commandId, argv?)` runs ONE sandboxed invoke of the command id the pack's `contributions.commands` declares — validated main-side (runnable + sandboxed + declared), the result crosses as data (JSON), pack code never reaches the renderer; palette entries for sandboxed commands ride `miniapp:cmd:<packId>:<commandId>` through the same bridge |
| `miniapps:docs-page` | invoke | all | `[string, string]` | `unknown` | getMiniAppDocPage (invoke) | miniapps IPC channel. |
| `miniapps:docs-tree` | invoke | all | `[string]` | `unknown` | getMiniAppDocs (invoke) | miniapps IPC channel. |
| `miniapps:empty-quarantine` | invoke | all | `[string]` | `unknown` | emptyMiniAppQuarantine (invoke) | the user-armed purge — the ONLY permanent deletion the app offers (retention prunes stale quarantine copies on boot, 30 days) |
| `miniapps:exclude-item` | invoke | all | `[string, string]` | `unknown` | excludeMiniAppItem (invoke) | mark an item excluded (feedback `keep`/`exclude`) — same persistence semantics |
| `miniapps:feedback-clear` | invoke | all | `[string, string?]` | `unknown` | clearMiniAppFeedback (invoke) | miniapps IPC channel. |
| `miniapps:feedback-list` | invoke | all | `[string]` | `unknown` | listMiniAppFeedback (invoke) | miniapps IPC channel. |
| `miniapps:get-state` | invoke | all | `[]` | `unknown` | getMiniApps (invoke) | mini-app pack list (plan 26 S1): `MiniAppsState` — per-pack view (id/version/kind, i18n-resolved title, capabilities, enabled, self-disable reason, origin, flattened config fields + stored values) + the master switch; validation is the ONE shared validator (`src/shared/app-pack/`), never re-implemented in main |
| `miniapps:host-profile` | invoke | all | `[]` | `unknown` | getMiniAppHostProfile (invoke) | the author-visible host profile (charter-derived kinds/tiers/honors/surfaces, entry extensions, T2 isolation grade) |
| `miniapps:import` | invoke | all | `[string, string?]` | `unknown` | importMiniApp (invoke) | import a pack manifest from its file **content** (renderer reads it via `fs:open-file`); validates → digest → install with origin; rejects invalid content (path-precise issues) and re-imports that don't raise the version |
| `miniapps:live-card` | invoke | all | `[string]` | `unknown` | getMiniAppLiveCard (invoke) | the host-resolved live-card spec for a pack (plan 28): `liveCard` manifest nodes or the SDK `DEFAULT_LIVE_CARD`, plus `live.<id>` i18n labels — the transcript's `MiniAppRunCard` renders from this (cached per pack) + the `miniapps:run-event` overlay; null for unknown/non-assessment packs |
| `miniapps:open-item` | invoke | all | `[string, string]` | `unknown` | openMiniAppItem (invoke) | miniapps IPC channel. |
| `miniapps:override-item` | invoke | all | `[string, string, literal | literal | literal]` | `unknown` | overrideMiniAppItem (invoke) | review-queue verdict override `(runId, relPath, keep/ask/candidate)` — persists a `MiniAppFeedback` row AND rewrites the run item; later runs of the same pack+root apply it over rules and the model |
| `miniapps:pick-root` | invoke | all | `[]` | `unknown` | pickMiniAppRoot (invoke) | OS folder picker for a run root (directories only) — the raw pick; `run-start` re-validates against the root rules |
| `miniapps:proposal-event` | event | all | `[]` | `unknown` | onMiniAppProposalEvent (on) | miniapps IPC channel. |
| `miniapps:quarantine-list` | invoke | all | `[string]` | `unknown` | listMiniAppQuarantine (invoke) | miniapps IPC channel. |
| `miniapps:quarantine-status` | invoke | all | `[string?]` | `unknown` | miniAppQuarantineStatus (invoke) | miniapps IPC channel. |
| `miniapps:remove` | invoke | all | `[string]` | `unknown` | removeMiniApp (invoke) | remove an installed pack by id (runs/reports — once they exist — stay in history) |
| `miniapps:resolve-proposal` | invoke | all | `[string, boolean]` | `unknown` | resolveMiniAppProposal (invoke) | user resolution of the pending proposal (approve/reject); IDEMPOTENT (second responder = no-op). Approval executes revalidate-and-move: each item's fingerprint is re-computed from the live file in the same main-side operation that moves it — changed items drop back to `ask`; the batch is sequential + fail-soft (an io failure stops it, earlier moves stay restorable, the rest skip to `ask`); a batch manifest lands beside the quarantined files |
| `miniapps:restore-batch` | invoke | all | `[string]` | `unknown` | restoreMiniAppBatch (invoke) | miniapps IPC channel. |
| `miniapps:restore-bundled` | invoke | all | `[]` | `unknown` | restoreBundledMiniApps (invoke) | restores removed bundled packs (clears the `removedBundled` tombstones and reinstalls) — removal of a pre-installed pack is sticky across boots by design |
| `miniapps:restore-item` | invoke | all | `[string, string]` | `unknown` | restoreMiniAppItem (invoke) | miniapps IPC channel. |
| `miniapps:restore-quarantine-record` | invoke | all | `[string]` | `unknown` | restoreMiniAppQuarantineRecord (invoke) | restore one quarantined item by record id (works even after its run row was retention-pruned) |
| `miniapps:reveal-item` | invoke | all | `[string, string]` | `unknown` | revealMiniAppItem (invoke) | miniapps IPC channel. |
| `miniapps:run-cancel` | invoke | all | `[string]` | `unknown` | cancelMiniAppRun (invoke) | miniapps IPC channel. |
| `miniapps:run-diff` | invoke | all | `[string]` | `unknown` | diffMiniAppRun (invoke) | "changed since last run" for the run's pack+root: new/removed/changed/verdict-flip entries vs the most recent earlier run |
| `miniapps:run-event` | event | all | `[]` | `unknown` | onMiniAppRunEvent (on) | miniapps IPC channel. |
| `miniapps:run-export` | invoke | all | `[string, string]` | `unknown` | exportMiniAppRun (invoke) | export a run as markdown/JSON/CSV (text + suggested filename; the renderer saves via the standard save dialog) |
| `miniapps:run-report` | invoke | all | `[string]` | `unknown` | miniAppRunReport (invoke) | the full report view (run row + per-item verdicts with evidence) by run id |
| `miniapps:run-resume` | invoke | all | `[string]` | `unknown` | resumeMiniAppRun (invoke) | miniapps IPC channel. |
| `miniapps:run-start` | invoke | all | `[string, string, object?]` | `unknown` | startMiniAppRun (invoke) | start a main-owned assessment run `(packId, rootPath, { maxModelCalls? })`: creates a dedicated conversation (schedules precedent), validates the root + engine, returns `{ runId }` or a typed error string; progress streams over `miniapps:run-event` |
| `miniapps:run-stats` | invoke | all | `[number | null]` | `unknown` | getMiniAppRunStats (invoke) | per-pack run aggregates for the Usage dashboard (plan 29): runs, items scanned, model calls, token sums, cache-hit ratio, paused/canceled/failed counts, last run — windowed 7/30/all (same convention as the tool stats); read-only over retained run rows, reduced main-side |
| `miniapps:runs-list` | invoke | all | `[string?]` | `unknown` | listMiniAppRuns (invoke) | recent runs (per pack or all, newest first, capped): status, totals, estimate/actual calls, token usage, conversation link |
| `miniapps:save-config` | invoke | all | `[string, Record<string, unknown>]` | `unknown` | saveMiniAppConfig (invoke) | persist per-pack config values, validated against the pack's declared config schema subset (defaults fill unset fields) |
| `miniapps:set-enabled` | invoke | all | `[string | null, boolean]` | `unknown` | setMiniAppEnabled (invoke) | master switch (`id: null`) or per-pack enable; re-enabling a validation-disabled pack is rejected with the surfaced reason |
| `miniapps:source-add` | invoke | all | `[string | object, Record<string, string>?]` | `unknown` | addMiniAppSource (invoke) | validate a source descriptor against the VENDORED `extension-sources.schema.json` (https-only root, or the structurally distinct local variant: absolute path, no `..` segments) and persist it — no fetch happens here (a failed fetch is a status, never a failed add); optional slot→value map lands in the keyring (`ext-source:<slot>`), slot REFERENCES ride the descriptor, never values (D22) |
| `miniapps:source-apply-update` | invoke | all | `[string, string, unknown]` | `unknown` | applyMiniAppExtensionUpdate (invoke) | the ONLY apply path (D22): `(sourceId, extensionId, consent: ConsentEcho \/ null)` — null is refused whenever the canonical manifest differs (version, i18n labels, report/liveCard nodes, data, provenance, capabilities, configSchema) or the tier is T2; a re-consent echo is verified against the re-derived content exactly like an install; a byte-identical-manifest content change (the ONLY auto-apply window; desktop imports only T0 data packs — there is NO code auto-apply path at all) applies with null and no dialog; every consented apply appends a `reconsent` consent record |
| `miniapps:source-install` | invoke | all | `[string, string, unknown]` | `unknown` | installMiniAppExtension (invoke) | consent-verified install `(sourceId, extensionId, consent: ConsentEcho)` — the echo restates the digest + capabilities the consent surface DISPLAYED; main re-derives both from the refetched content at land time and refuses on mismatch (a renderer-asserted boolean is not consent, D7/H4), re-fetches and refuses when the content no longer matches the digest the consent was shown for, projects the family envelope onto the pack manifest (unhonored capability/kind ⇒ typed rejection, never half-install), lands content-addressed under `<userData>/mini-apps/<id>/<digest>/` and installs DISABLED (the desktop default-off host policy); local file-path sources are gated off in packaged (production) boots AND confined to allowlisted roots (`DA_EXTENSION_LOCAL_SOURCE_ROOTS`, resolved paths — symlinks and traversal cannot escape), both fail-closed at add/sync/install/apply (the vendored sources schema's MUST clause) |
| `miniapps:source-remove` | invoke | all | `[string]` | `unknown` | removeMiniAppSource (invoke) | remove a source: its installs PARK (disabled + flagged, data + consent records intact, tombstone-able) — nothing is deleted; removal of bundled-pack tombstones is untouched |
| `miniapps:source-restore` | invoke | all | `[string]` | `unknown` | restoreMiniAppExtension (invoke) | unpark an imported extension (source-removal parking) — stays disabled; enabling is the user's next explicit act |
| `miniapps:source-sync` | invoke | all | `[string]` | `unknown` | syncMiniAppSource (invoke) | resolve → shallow fetch → manifest discovery (root + one level) → envelope schema validation (vendored `extension-manifest.schema.json` through the draft-2020-12 interpreter) → host-profile mapping/compat → per-candidate digest; a failed fetch marks the source `failing` and leaves every pin untouched (D22); runs the update check for its installs (ref move + digest change + manifest diff) |
| `miniapps:sources-list` | invoke | all | `[]` | `unknown` | getMiniAppSources (invoke) | the extension-sources state (plan 32 Phase 8 / ADR-0040 D13): sources with their validated candidates (each carrying the consent payload — capabilities, tier, provenance verbatim, digest, the charter T0 disclosure verbatim) and the imported-install sidecars (pin, consent history, park state, update state) |
| `miniapps:window-open` | invoke | all | `[string, string]` | `unknown` | openMiniAppWindow (invoke) | `ui:window` host surface (plan 32 Phase 4 / ADR-0040 clause 16): open the constrained host-owned BrowserWindow rendering the pack's declared report surface for a run `(packId, runId)`; validated main-side (declared `ui:window` capability + enabled pack + master switch + run⇔pack match), per-pack cap 1 (second open focuses), every open/close audited as a `MiniAppWindow` row; closed automatically on pack disable, removal, kill switch and app shutdown |

### providers

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `provider:add` | invoke | settings | `[object]` | `unknown` | addProvider (invoke) | providers IPC channel. |
| `provider:delete` | invoke | settings | `[string]` | `unknown` | deleteProvider (invoke) | providers IPC channel. |
| `provider:set-default` | invoke | settings | `[string]` | `unknown` | setDefaultProvider (invoke) | providers IPC channel. |
| `provider:set-default-model` | invoke | settings | `[string, string, string?]` | `unknown` | setDefaultModel (invoke) | `(providerId, modelId, task?)` → upsert the model onto that provider (`customModels`), bind `taskAssignments[task ?? 'chat']` (`task` ∈ chat/vision/stt; vision and stt bindings require the matching capability), set `defaultProviderId`; cross-provider ids rejected |
| `provider:setup-preset` | invoke | settings | `[string, string, string?, object?]` | `unknown` | setupProviderFromPreset (invoke) | one-click BYOK setup (plan 21): `(presetKey, apiKey, name?, options?)` — `name` (optional, ≤80 chars) applies to newly created rows only; adopted rows keep their name; an empty `apiKey` resolves the existing row's stored keyring key (on-demand re-setup, D18); `options` (`SetupPresetOptions`: `curatedIds`/`bindChat`/`bindVision`/`bindStt`) rides the editable review modal — omitted = preset defaults. Fetch-first (D1): the catalog is fetched with the key under an `AbortController` (provider timeout); failure classifies via `classifyProviderError` (`src/shared/ai/providerErrors.ts`) and persists nothing. Success **appends** the curated catalog into `availableModels` (D17 `curatedModels` allowlist matched against exact ids and dated-snapshot suffixes; full-catalog fallback + `curatedMissed` flag on preset-list drift; inferred caps persisted, existing rows healed), gap-fills the empty `taskAssignments` slots — CHAT/VISION from the preferred or first curated match, STT from the preset's `sttModel` (openai: `whisper-1`) — and adopts existing rows idempotently via `presetKey` (manual rows with the same `type + apiBase` are adopted, earliest first — D6). Broadcasts `config-updated` on success |
| `provider:update` | invoke | settings | `[object]` | `unknown` | updateProvider (invoke) | providers IPC channel. |

### schedules

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `schedules:create` | invoke | all | `[object]` | `unknown` | createSchedule (invoke) | schedules IPC channel. |
| `schedules:delete` | invoke | all | `[string]` | `unknown` | deleteSchedule (invoke) | schedules IPC channel. |
| `schedules:list` | invoke | all | `[]` | `unknown` | listSchedules (invoke) | schedules IPC channel. |
| `schedules:run-now` | invoke | all | `[string]` | `unknown` | runScheduleNow (invoke) | schedules IPC channel. |
| `schedules:update` | invoke | all | `[string, object]` | `unknown` | updateSchedule (invoke) | schedules IPC channel. |

### search

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `search:delete-provider` | invoke | all | `[string]` | `unknown` | deleteSearchProvider (invoke) | remove an instance and its stored key |
| `search:get-providers` | invoke | all | `[]` | `unknown` | getSearchProviders (invoke) | ordered web-search provider instances (masked: `hasKey` + `keyHint` only, never key material) |
| `search:move-provider` | invoke | all | `[string, literal | literal]` | `unknown` | moveSearchProvider (invoke) | reorder instances (`up`/`down`); array order is failover priority |
| `search:save-provider` | invoke | all | `[object]` | `unknown` | saveSearchProvider (invoke) | create/update an instance; `key` is stripped into the keyring on receipt (`''` clears it) |
| `search:set-provider-enabled` | invoke | all | `[string, boolean]` | `unknown` | setSearchProviderEnabled (invoke) | enable/disable an instance without deleting it |
| `search:test-provider` | invoke | all | `[string]` | `unknown` | testSearchProvider (invoke) | run a 1-result query through the instance; returns latency + result count or error |

### system

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `capture-high-res-source` | invoke | all | `[string]` | `unknown` | captureHighResSource (invoke) | high-resolution screenshot of a source |
| `clipboard:read-text` | invoke | all | `[]` | `unknown` | readFromClipboard (invoke) | system IPC channel. |
| `clipboard:write-text` | invoke | all | `[string]` | `unknown` | writeToClipboard (invoke) | system IPC channel. |
| `download-attachment` | invoke | all | `[object]` | `unknown` | downloadAttachment (invoke) | save an attachment data URL through the native save dialog |
| `fs:open-file` | invoke | all | `[object?]` | `unknown` | openFile (invoke) | system IPC channel. |
| `fs:save-file` | invoke | all | `[object]` | `unknown` | saveFile (invoke) | system IPC channel. |
| `get-screen-sources` | invoke | all | `[]` | `unknown` | getScreenSources (invoke) | enumerate screens/windows for capture |
| `notification:show` | invoke | all | `[string, string]` | `unknown` | showNotification (invoke) | OS notification |
| `process-pdf-attachment` | invoke | all | `[string]` | `unknown` | processPdfAttachment (invoke) | parse a PDF into content |
| `system:autostart-status` | invoke | all | `[]` | `unknown` | autostartStatus (invoke) | real per-OS login-item state — `{ supported, enabled }`; `supported` is false in dev builds (the settings toggle disables itself), `enabled` reads the OS truth (XDG file on Linux, login item on Windows/macOS) |
| `system:get-app-version` | invoke | all | `[]` | `unknown` | getAppVersion (invoke) | system IPC channel. |
| `system:get-platform` | invoke | all | `[]` | `unknown` | getAppVersion (invoke) | system IPC channel. |
| `system:open-external` | invoke | all | `[string]` | `unknown` | openExternal (invoke) | system IPC channel. |
| `system:open-path` | invoke | all | `[string]` | `unknown` | openPath (invoke) | opens a file-artifact with its default application on explicit user click; main-side re-validates (exists, non-executable, files confined to granted roots — same rails as the `open_path` tool); returns an error string or `null` |
| `system:show-context-menu` | invoke | all | `[]` | `unknown` | showContextMenu (invoke) | native context menu (renderer-driven template) |
| `system:show-item-in-folder` | invoke | all | `[string]` | `unknown` | showItemInFolder (invoke) | system IPC channel. |

### tools

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `tools:cancel-download` | invoke | all | `[string]` | `unknown` | cancelDownload (invoke) | aborts an in-flight `download_file` transfer by `downloadId` (from the trace step's `progress`); the tool removes the partial file and returns a cancelled result |
| `tools:get-catalog` | invoke | all | `[]` | `unknown` | getToolCatalog (invoke) | native tool catalog rows: name, description, risk, `category` (files/system/desktop/network/power), editableArgs, enabled, granted, source, `parameters` (flattened from the zod schema: type/required/description/enum/default) and the effective `verification` settings (`verificationCustom` = per-tool override decides). Since plan 15 S6 the catalog also carries enabled app tools (source `mcp`, `appName` set, `enabled` reflects connection state) — the Tools tab keeps native rows; the inspector groups by `appName` |
| `tools:get-result` | invoke | all | `[string]` | `unknown` | getToolResult (invoke) | on-demand fetch of a stored tool result (`ToolResultView / null`) by trace-step id — full text + data-URL images; backed by the durable `ToolResult` table + image files (`ToolResultService`), so results survive restarts until age-pruned |
| `tools:open-result-viewer` | invoke | all | `[string]` | `unknown` | openToolResultViewer (invoke) | opens (or reloads) the frameless result-viewer window for a stored call id; `false` when the result is unknown or pruned |
| `tools:pick-root` | invoke | all | `[]` | `unknown` | pickGrantedRoot (invoke) | OS folder picker; grants a filesystem root for file tools (persisted in `config.tools.grantedRoots`) |
| `tools:remove-root` | invoke | all | `[string]` | `unknown` | removeGrantedRoot (invoke) | revoke a granted root |
| `tools:revoke-tool-grant` | invoke | all | `[string]` | `unknown` | revokeToolGrant (invoke) | revoke a persistent "always allow" grant |
| `tools:set-class-defaults` | invoke | all | `[unknown]` | `unknown` | setToolClassDefaults (invoke) | class-level default verification (`readOnly`: `run`/`always_ask`, `stateChanging`: `standard`/`never`/`always_ask`) persisted in `config.tools.classDefaults`; built-in tools only — MCP tools are never affected |
| `tools:set-tool-enabled` | invoke | all | `[string, boolean]` | `unknown` | setToolEnabled (invoke) | per-tool kill switch (persisted in `config.tools.disabledTools`) |
| `tools:set-tool-grant` | invoke | all | `[string, boolean]` | `unknown` | setToolGrant (invoke) | set/clear the persistent "always allow" grant (Tools tab detail modal) |
| `tools:set-verification` | invoke | all | `[string, unknown]` | `unknown` | setToolVerification (invoke) | per-tool verification override (`standard`/`always_ask`/`conditions`/`never` + rules; `null` or `standard` clears) persisted in `config.tools.toolSettings` |
| `tools:usage-stats` | invoke | all | `[unknown]` | `unknown` | getToolUsageStats (invoke) | read-only aggregation of the `tool_calls` audit over a 7/30-day or all-time window: per-tool counts, outcomes, approval-source ratios, average durations, recent failures (plan 12 §7) |

### translation

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `translation:delete-provider` | invoke | all | `[string]` | `unknown` | deleteTranslationProvider (invoke) | remove an instance and its stored key |
| `translation:get-providers` | invoke | all | `[]` | `unknown` | getTranslationProviders (invoke) | ordered translation service instances (masked: `hasKey` + `keyHint` only, never key material) |
| `translation:move-provider` | invoke | all | `[string, literal | literal]` | `unknown` | moveTranslationProvider (invoke) | reorder instances (`up`/`down`); array order is failover priority |
| `translation:save-provider` | invoke | all | `[object]` | `unknown` | saveTranslationProvider (invoke) | create/update an instance; `key` is stripped into the keyring on receipt (`''` clears it); LibreTranslate requires a server URL, DeepL a key |
| `translation:set-provider-enabled` | invoke | all | `[string, boolean]` | `unknown` | setTranslationProviderEnabled (invoke) | enable/disable an instance without deleting it |
| `translation:test-provider` | invoke | all | `[string]` | `unknown` | testTranslationProvider (invoke) | translate a tiny "hello" probe through the instance (target = `translation.defaultTarget` or `en`); returns latency + translation or error |
| `translation:translate` | invoke | all | `[object]` | `unknown` | translateText (invoke) | direct one-shot translation for the launcher translate pad (plan 19 S6) — no turn, no persistence; same `TranslateService` funnel (engines, failover, `AiCall` audit, typed errors) |

### window

| Channel | Direction | Scope | Request | Response | Bridge | Summary |
|---|---|---|---|---|---|---|
| `desktop:capture-selection` | invoke | all | `[]` | `unknown` | captureSelection (invoke) | explicit user click only: simulate copy keystroke, read clipboard, restore prior contents |
| `desktop:clipboard-changed` | invoke | all | `[]` | `unknown` | clipboardChanged (invoke) | opt-in (`behavior.clipboardWatcher`) poll-on-summon: hash-compare only, returns text + preview when changed |
| `desktop:open` | invoke | all | `[string?]` | `unknown` | openDesktop (invoke) | open/focus the desktop-mode window, optionally synced to a conversation |
| `desktop:open-launcher` | invoke | all | `[unknown?, string?]` | `unknown` | openLauncher (invoke) | desktop → launcher handoff: hides the desktop window, shows/focuses the launcher, optionally `session-sync`s the desktop's active conversation and pushes `launcher:set-mode` (`compact`/`expanded`) |
| `desktop:selection-supported` | invoke | all | `[]` | `unknown` | selectionSupported (invoke) | whether selection capture can work on this OS/session (false on Wayland) |
| `window:close` | invoke | all | `[]` | `unknown` | closeWindow (invoke) | window IPC channel. |
| `window:hide` | invoke | all | `[]` | `unknown` | hideWindow (invoke) | window IPC channel. |
| `window:maximize` | invoke | all | `[]` | `unknown` | toggleMaximizeWindow (invoke) | toggle maximize on the calling window |
| `window:minimize` | invoke | all | `[]` | `unknown` | minimizeWindow (invoke) | window IPC channel. |
| `window:move-by` | invoke | all | `[number, number]` | `unknown` | moveWindowBy (invoke) | window IPC channel. |
| `window:resize` | invoke | all | `[unknown, unknown]` | `unknown` | resizeWindow (invoke) | window IPC channel. |
| `window:resize-corner-end` | invoke | all | `[]` | `unknown` | resizeCornerEnd (invoke) | window IPC channel. |
| `window:resize-corner-start` | invoke | all | `[unknown]` | `unknown` | resizeCornerStart (invoke) | window IPC channel. |
| `window:resize-corner-update` | invoke | all | `[number, number]` | `unknown` | resizeCornerUpdate (invoke) | window IPC channel. |
| `window:show` | invoke | all | `[]` | `unknown` | showWindow (invoke) | window IPC channel. |

**Channels:** 204 (179 invoke, 10 send, 15 event).
