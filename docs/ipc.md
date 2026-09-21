# IPC surface

The preload bridge (`src/preload/preload.ts`, exposed as
`window.electronAPI`) is the **only** renderer→main channel. All
renderer→main channels are `ipcMain.handle` (invoke/promise semantics);
handlers live in `src/main/ipc-handlers.ts`.

Main also **pushes** to renderers via `webContents.send` (registered
through preload listener methods, never raw `ipcRenderer.on` in feature
code): `ai:turn-event` (turn stream, every window), `session-sync`
(desktop conversation handoff), `launcher:toggle-expand` (global hotkey),
`launcher:new-conversation` (palette builtin — both launcher and desktop
windows listen via `onLauncherNewConversation`; the palette/slash execute
path also resolves `nav:new-conversation` renderer-side through
`useChatSession`, so the broadcast is a fallback for main-originated
calls), `config-updated` (config
changes), `focus-input` (re-summon focus — the startup/first-open focus
is renderer-side: `useChatSession` focuses the composer on mount), and
`hotkey:start-recording`, `launcher:set-mode` (desktop → launcher
handoff: `'compact' | 'expanded'` — the launcher state machine applies
`collapse` / `auto_expand`; the invoking conversation id rides the
`session-sync` push so the conversation carries over).

## Rules for adding or changing a channel

1. Add the handler in `src/main/ipc-handlers.ts` (keep domain grouping).
2. Expose a typed method in `src/preload/preload.ts`.
3. Extend the renderer-facing types in `src/shared/types.ts`
   (`ElectronAPI`) — the renderer never sees raw channel strings.
4. Update the table below in the same commit.

## Registry

### AI

| Channel | Purpose |
|---|---|
| `ai:generate-response` | one-shot completion |
| `ai:turn-start` | start a main-owned chat turn (persists the user message, streams through the gateway); optional `flow: 'research'` routes the turn through the research flow graph (plan 13) instead of the standard chat/agent path |
| `ai:turn-cancel` | cancel the in-flight turn (partial text is kept; during an approval the pending calls are denied) |
| `ai:turn-resume` | resolve the pending tool approval (`decisions` aligned with the interrupt batch + optional grant scope); false when nothing is pending (second responder = no-op) |
| `ai:turn-event` (main → renderer, broadcast) | turn phase envelope: `queued/thinking/tool_call/tool_result/interrupt/streaming/finished/failed/cancelled`, deltas, trace steps, approval payload (requests + auto-deny deadline), node telemetry payload (`TurnEvent.node`: node name/label, outcome, duration, `resumed` — plan 13). Terminal phases (`finished`/`failed`/`cancelled`) broadcast only after the assistant message is persisted, so a renderer refresh on those events always sees the final transcript |
| `ai:fetch-models` | list models for a configured provider |
| `stt:transcribe` | speech-to-text (assigned Whisper-compatible model; honors `voice.language`) |
| `voice:evaluate-utterance` | voice-endpoint verdict `{ complete }` for a dictated phrase (fails closed on unassigned model, `voice.autoSend` off, errors, or timeout) |

### Tools & policy

| Channel | Purpose |
|---|---|
| `tools:get-catalog` | native tool catalog rows: name, description, risk, `category` (files/system/desktop/network/power), editableArgs, enabled, granted, source, `parameters` (flattened from the zod schema: type/required/description/enum/default) and the effective `verification` settings (`verificationCustom` = per-tool override decides). Since plan 15 S6 the catalog also carries enabled app tools (source `mcp`, `appName` set, `enabled` reflects connection state) — the Tools tab keeps native rows; the inspector groups by `appName` |
| `tools:set-tool-enabled` | per-tool kill switch (persisted in `config.tools.disabledTools`) |
| `tools:revoke-tool-grant` | revoke a persistent "always allow" grant |
| `tools:set-tool-grant` | set/clear the persistent "always allow" grant (Tools tab detail modal) |
| `tools:set-verification` | per-tool verification override (`standard`/`always_ask`/`conditions`/`never` + rules; `null` or `standard` clears) persisted in `config.tools.toolSettings` |
| `tools:set-class-defaults` | class-level default verification (`readOnly`: `run`/`always_ask`, `stateChanging`: `standard`/`never`/`always_ask`) persisted in `config.tools.classDefaults`; built-in tools only — MCP tools are never affected |
| `tools:pick-root` | OS folder picker; grants a filesystem root for file tools (persisted in `config.tools.grantedRoots`) |
| `tools:remove-root` | revoke a granted root |
| `tools:get-result` | on-demand fetch of a stored tool result (`ToolResultView | null`) by trace-step id — full text + data-URL images; backed by the durable `ToolResult` table + image files (`ToolResultService`), so results survive restarts until age-pruned |
| `tools:open-result-viewer` | opens (or reloads) the frameless result-viewer window for a stored call id; `false` when the result is unknown or pruned |
| `tools:cancel-download` | aborts an in-flight `download_file` transfer by `downloadId` (from the trace step's `progress`); the tool removes the partial file and returns a cancelled result |
| `system:open-path` | opens a file-artifact with its default application on explicit user click; main-side re-validates (exists, non-executable, files confined to granted roots — same rails as the `open_path` tool); returns an error string or `null` |
| `schedules:list` / `schedules:create` / `schedules:update` / `schedules:delete` / `schedules:run-now` | scheduled-prompt CRUD + manual run (plan 12 §4). Rows carry the spec (interval/daily/weekly/cron), IANA timezone, `specLabel`, ISO `lastRunAt`/`nextRunAt` and `lastOutcome`. The model has no schedule tools (D4) — this is the only editing surface |
| `docs:get-status` | per granted root: `indexed` flag + indexed file/chunk counts (plan 12 §5) |
| `docs:set-indexed` | opts a granted root into (or out of) the local-docs FTS index; turning on walks + chunks the folder immediately, turning off removes its chunks |
| `docs:re-index` | mtime-delta re-index of one root (or all indexed roots with `null`); returns `{ files, chunks, truncated }` |
| `ai:tts-synthesize` | synthesizes speech for a finished reply via the `tts` task assignment (OpenAI-compatible `/audio/speech`, native Gemini `generateContent` for GOOGLE providers — sanctioned `src/main/ai/tts.ts`, audited); returns `{ audioBase64, mime }`, `null` when the toggle is off / no model is assigned, or rejects with a compact error (status-mapped, `compactTtsError`) that the renderer shows as a notice |
| `tools:usage-stats` | read-only aggregation of the `tool_calls` audit over a 7/30-day or all-time window: per-tool counts, outcomes, approval-source ratios, average durations, recent failures (plan 12 §7) |
| `mcp:*` (retired) | the plan-11 compat channels (`get-servers`/`save-server`/`delete-server`/`set-enabled`/`set-tool-override`/`test-server`/`list-tools`) were removed — servers are managed exclusively as tool apps through the `apps:*` surface above; the plan-11 `mcpServers` config migrated into custom apps (plan 15 D11) |
| `apps:get-state` | tool-app list (plan 15): spec + health + masked secret key names + known-tool rows (`state: null` = new tool pending surfacing), plus `deferredSupported` for the active chat model (S3); fetches also kick the stale-snapshot TTL refresh (5-min, background, fail-soft) |
| `apps:usage-stats` | read-only per-app aggregation of the `tool_calls` audit over a 7/30-day or all-time window; rows attributed via AppService (MCP server name/namespaced tool or native-group membership), unattributed calls excluded (plan-15 polish) |
| `apps:context-digest-stats` | plan 23 S6 readout: cached digest stats per enabled app (`{ entities, ageMinutes }`, raw pre-scope-filter rows; cache-only — never triggers a fetch). Empty when `behavior.appContext` is off |
| `apps:list-presets` | bundled, reviewed tool-app presets (Home Assistant first) for the add-flow permission preview; preset-authored data is applied main-side on save |
| `apps:preview-scope` | runs the app's first discovery tool and returns its discovered entity ids split by the draft scope rules (same matcher as bridge enforcement) — seeds the Apps-tab device-scope preview |
| `apps:save-app` | main-validated create/update of a `ToolAppSpec` (zod + uniqueness + native-name resolution + tighten-only risk); `env`/`headers` values are stripped into the keyring (`app:<id>:*`) on receipt; an optional `authToken` is merged into the stored headers blob as `Authorization: Bearer …` main-side (sibling headers preserved — the renderer never sees stored secret values, so it cannot merge client-side); renderer-authored `baseRisk`/entity-role and `promptNotes` values are stripped — preset id + stored data own the authored layer |
| `apps:remove-app` | remove an app, its backing server config, and all of its keyring blobs |
| `apps:set-enabled` | master switch (`appId: null`) or per-app enable; re-enabling a validation-disabled app is rejected with the surfaced error |
| `apps:set-tool-state` | per-tool curation inside an app (enabled / keyword tags / tighten-only risk override; `null` resets to default-enabled) |
| `apps:set-entity-scope` | ordered allow/deny entity-pattern rules (MCP-backed apps only) |
| `apps:test-connection` | force a connection (latency + tool count) and reconcile `toolState` against the live tool list |
| `search:get-providers` | ordered web-search provider instances (masked: `hasKey` + `keyHint` only, never key material) |
| `search:save-provider` | create/update an instance; `key` is stripped into the keyring on receipt (`''` clears it) |
| `search:delete-provider` | remove an instance and its stored key |
| `search:set-provider-enabled` | enable/disable an instance without deleting it |
| `search:move-provider` | reorder instances (`up`/`down`); array order is failover priority |
| `search:test-provider` | run a 1-result query through the instance; returns latency + result count or error |
| `translation:get-providers` | ordered translation service instances (masked: `hasKey` + `keyHint` only, never key material) |
| `translation:save-provider` | create/update an instance; `key` is stripped into the keyring on receipt (`''` clears it); LibreTranslate requires a server URL, DeepL a key |
| `translation:delete-provider` | remove an instance and its stored key |
| `translation:set-provider-enabled` | enable/disable an instance without deleting it |
| `translation:move-provider` | reorder instances (`up`/`down`); array order is failover priority |
| `translation:test-provider` | translate a tiny "hello" probe through the instance (target = `translation.defaultTarget` or `en`); returns latency + translation or error |
| `translation:translate` | direct one-shot translation for the launcher translate pad (plan 19 S6) — no turn, no persistence; same `TranslateService` funnel (engines, failover, `AiCall` audit, typed errors) |
| `decisions:get-state` | decision-engine settings surface (plan 20 S5): Needle runtime/weights presence, active download + byte progress |
| `decisions:download-weights` | user-initiated pinned Needle weights download (single-flight, checksum-verified, atomic); progress polled via `decisions:get-state` |
| `decisions:cancel-download` | abort an in-progress weights download (partial file removed) |
| `decisions:test` | run the enabled decision engine on a short input against a demo tool set — no execution; returns engine/confidence/band/calls + duration |
| `memory:list` | stored memories (`MemoryView[]`), most recent first, capped |
| `memory:search` | full-text search over memory contents (FTS5, bm25-ranked with exact-match boost; LIKE fallback) |
| `memory:delete` | forget by id; returns whether a row was removed |
| `memory:restore` | re-create a deleted memory (undo path) through the normal save/dedupe rules |
| `memory:consolidate` | on-demand smart-merge pass over gray-zone near-duplicates (plan 16 S2); `plumbing`-task arbitration, ≤ 20 pairs per run with a 60 s cooldown; merges record provenance so manager undo restores both sides; returns `{ checked, merged, kept, skipped }` |
| `desktop:selection-supported` | whether selection capture can work on this OS/session (false on Wayland) |
| `desktop:clipboard-changed` | opt-in (`behavior.clipboardWatcher`) poll-on-summon: hash-compare only, returns text + preview when changed |
| `desktop:capture-selection` | explicit user click only: simulate copy keystroke, read clipboard, restore prior contents |

### Commands (plan 14)

| Channel | Purpose |
|---|---|
| `commands:get-catalog` | assembled catalog snapshot (`CommandCatalogSnapshot`): entries from native tools (destructive/kill-switched excluded) + builtins (nav set, calculator, file search), recent ids from `CommandInvocation`, pins from `commands.pins`; `commands.hidden` and the `commands.enabled` kill switch applied |
| `commands:execute` | user-initiated execution of builtin/web/app commands in main (`{ status: 'done' | 'turn' | 'error' }`); tool-backed entries return `turn` — they ride `ai:turn-start` with `directTool.commandId` so the policy path is unchanged; builtins may return `turn` with a `prompt` and a named `flow` (`'research'` — plan 13) to start a flow turn; records `CommandInvocation` (args stored for read-only builtins only) |
| `commands:clear-history` | wipe the `CommandInvocation` table (Settings → Commands history card) |
| `commands:refresh-apps` | force an app-discovery rescan; returns `{ count }` — otherwise the scan is cached and refreshed by directory mtimes |
| `commands:get-app-icon` | lazily resolve an app's icon to a raster-only data-URL (PNG/JPEG/WebP — SVG/XPM rejected at this seam); `null` → renderer monogram tile |
| `commands:save-custom` | create/update a user-defined command (tool wrapper or prompt) — main validates tool binding, template arity and reserved aliases before writing `commands.custom` |
| `commands:delete-custom` | remove a custom command by id |
| `commands:import-integration` | validate a declarative `integration.json` manifest (version 1, zod) and install it; `${secret:name}` header refs are stored to the keyring at import and only the refs persist in config — values never round-trip |
| `commands:remove-integration` | remove an installed pack and delete its keyring secrets |

### Desktop mode

| Channel | Purpose |
|---|---|
| `desktop:open` | open/focus the desktop-mode window, optionally synced to a conversation |
| `desktop:open-launcher` | desktop → launcher handoff: hides the desktop window, shows/focuses the launcher, optionally `session-sync`s the desktop's active conversation and pushes `launcher:set-mode` (`compact`/`expanded`) |
| `window:maximize` | toggle maximize on the calling window |
| `session-sync` (main → renderer) | desktop window follows the launcher's active conversation |

### Conversations & messages (SQLite)

| Channel | Purpose |
|---|---|
| `db:conversations:get-all` / `get-by-id` / `create` / `update` / `delete` / `clear-all` | conversation CRUD |
| `db:conversations:set-metadata` | per-conversation metadata (model override) |
| `db:messages:get-by-conversation` / `create` / `update` / `delete` / `clear-by-conversation` | message CRUD |

### Configuration & providers

| Channel | Purpose |
|---|---|
| `config:load` / `save` / `reset` / `get-path` | app configuration |
| `config:export` / `import` | settings backup (JSON file) |
| `provider:add` / `update` / `delete` / `set-default` | LLM provider entries |
| `provider:setup-preset` | one-click BYOK setup (plan 21): `(presetKey, apiKey, name?, options?)` — `name` (optional, ≤80 chars) applies to newly created rows only; adopted rows keep their name; an empty `apiKey` resolves the existing row's stored keyring key (on-demand re-setup, D18); `options` (`SetupPresetOptions`: `curatedIds`/`bindChat`/`bindVision`/`bindStt`) rides the editable review modal — omitted = preset defaults. Fetch-first (D1): the catalog is fetched with the key under an `AbortController` (provider timeout); failure classifies via `classifyProviderError` (`src/shared/ai/providerErrors.ts`) and persists nothing. Success **appends** the curated catalog into `availableModels` (D17 `curatedModels` allowlist matched against exact ids and dated-snapshot suffixes; full-catalog fallback + `curatedMissed` flag on preset-list drift; inferred caps persisted, legacy rows healed), gap-fills the empty `taskAssignments` slots — CHAT/VISION from the preferred or first curated match, STT from the preset's `sttModel` (openai: `whisper-1`) — and adopts existing rows idempotently via `presetKey` (manual rows with the same `type + apiBase` are adopted, earliest first — D6). Broadcasts `config-updated` on success |
| `provider:set-default-model` | `(providerId, modelId, task?)` → upsert the model onto that provider (`customModels`), bind `taskAssignments[task ?? 'chat']` (`task` ∈ chat/vision/stt; vision and stt bindings require the matching capability), set `defaultProviderId`; cross-provider ids rejected |
| `hotkeys:get-settings` / `save-settings` / `register-all` / `start-recording` / `stop-recording` | global shortcuts config |

### Attachments & capture

| Channel | Purpose |
|---|---|
| `process-pdf-attachment` | parse a PDF into content |
| `attachment:download` | save an attachment |
| `get-screen-sources` | enumerate screens/windows for capture |
| `capture-high-res-source` | high-resolution screenshot of a source |

### Window management

| Channel | Purpose |
|---|---|
| `window:show` / `hide` / `close` / `minimize` / `resize` | overlay window control |
| `window:resize-corner-start` / `-update` / `-end` | manual resize of the launcher window via the renderer's bottom-right corner handle: main snapshots the start bounds, applies clamped deltas (min sizes + work area) live via `setBounds` (the WM is not resizable on the launcher — `resizable: false` — so `setSize` must not be used on this window, it is a no-op on X11) |
| `window:set-always-on-top` | pin toggle |
| `settings:open` | open/focus the settings window; accepts a `{ tab, section, commandId }` deep-link (`section` selects an API sub-tab: providers/models/tasks — used by the actionable "no model" banner and first-run entries) |
| `settings:save` | persist settings |
| `settings:navigate` (main → settings window, push) | delivers the deep-link target after the settings renderer mounts |

### System, files & dialogs

| Channel | Purpose |
|---|---|
| `system:get-platform` / `get-arch` / `get-app-version` | environment info |
| `system:autostart-status` | real per-OS login-item state — `{ supported, enabled }`; `supported` is false in dev builds (the settings toggle disables itself), `enabled` reads the OS truth (XDG file on Linux, login item on Windows/macOS) |
| `system:open-external` / `show-item-in-folder` / `quit-app` | shell actions |
| `system:show-context-menu` | native context menu (renderer-driven template) |
| `clipboard:read-text` / `write-text` | clipboard |
| `fs:open-file` / `save-file` | file dialogs |
| `dialog:show-message` / `show-error` | message dialogs |
| `notification:show` | OS notification |

### Diagnostics

| Channel | Purpose |
|---|---|
| `log:info` / `warn` / `error` | renderer → main log forwarding |
| `dev:open-devtools` / `dev:reload` | debugging helpers |

## Security notes

- The renderer is untrusted: handlers validate argument shapes before
  using them; no handler accepts arbitrary paths from the renderer
  without a dialog round-trip.
- Secrets are write-only from the renderer: `config:save` /
  `provider:*` handlers move any submitted API key into OS-protected
  storage (`SecretService`) and persist only a masked hint
  (`apiKeyHint`). No channel returns key material to the renderer, and
  STT/AI calls run in main so the key never crosses the boundary.
- Tool approvals follow default-deny: main auto-denies a pending
  approval after 60 s; `ai:turn-resume` is idempotent (the second
  window's resolution is a no-op); tools never execute in the renderer.
