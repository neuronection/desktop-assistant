# IPC surface

The preload bridge (`src/preload/preload.ts`, exposed as
`window.electronAPI`) is the **only** renderer→main channel. All
renderer→main channels are `ipcMain.handle` (invoke/promise semantics);
handlers live in `src/main/ipc-handlers.ts`.

Main also **pushes** to renderers via `webContents.send` (registered
through preload listener methods, never raw `ipcRenderer.on` in feature
code): `ai:turn-event` (turn stream, every window), `session-sync`
(desktop conversation handoff), `launcher:toggle-expand` (global hotkey),
`launcher:new-conversation` (palette builtin), `config-updated` (config
changes), `focus-input` (summon focus), and `hotkey:start-recording`.

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
| `ai:turn-start` | start a main-owned chat turn (persists the user message, streams through the gateway) |
| `ai:turn-cancel` | cancel the in-flight turn (partial text is kept; during an approval the pending calls are denied) |
| `ai:turn-resume` | resolve the pending tool approval (`decisions` aligned with the interrupt batch + optional grant scope); false when nothing is pending (second responder = no-op) |
| `ai:turn-event` (main → renderer, broadcast) | turn phase envelope: `queued/thinking/tool_call/tool_result/interrupt/streaming/finished/failed/cancelled`, deltas, trace steps, approval payload (requests + auto-deny deadline), node telemetry payload (`TurnEvent.node`: node name/label, outcome, duration, `resumed` — plan 13). Terminal phases (`finished`/`failed`/`cancelled`) broadcast only after the assistant message is persisted, so a renderer refresh on those events always sees the final transcript |
| `ai:fetch-models` | list models for a configured provider |
| `stt:transcribe` | speech-to-text (assigned Whisper-compatible model; honors `voice.language`) |
| `voice:evaluate-utterance` | voice-endpoint verdict `{ complete }` for a dictated phrase (fails closed on unassigned model, `voice.autoSend` off, errors, or timeout) |

### Tools & policy

| Channel | Purpose |
|---|---|
| `tools:get-catalog` | native tool catalog rows: name, description, risk, `category` (files/system/desktop/network/power), editableArgs, enabled, granted, source, `parameters` (flattened from the zod schema: type/required/description/enum/default) and the effective `verification` settings (`verificationCustom` = per-tool override decides) |
| `tools:set-tool-enabled` | per-tool kill switch (persisted in `config.tools.disabledTools`) |
| `tools:revoke-tool-grant` | revoke a persistent "always allow" grant |
| `tools:set-tool-grant` | set/clear the persistent "always allow" grant (Tools tab detail modal) |
| `tools:set-verification` | per-tool verification override (`standard`/`always_ask`/`conditions`/`never` + rules; `null` or `standard` clears) persisted in `config.tools.toolSettings` |
| `tools:set-class-defaults` | class-level default verification (`readOnly`: `run`/`always_ask`, `stateChanging`: `standard`/`never`/`always_ask`) persisted in `config.tools.classDefaults`; built-in tools only — MCP tools are never affected |
| `tools:pick-root` | OS folder picker; grants a filesystem root for file tools (persisted in `config.tools.grantedRoots`) |
| `tools:remove-root` | revoke a granted root |
| `tools:get-result` | on-demand fetch of a stored tool result (`ToolResultView | null`) by trace-step id — full text + data-URL images; backed by the durable `ToolResult` table + image files (`ToolResultService`), so results survive restarts until age-pruned |
| `tools:open-result-viewer` | opens (or reloads) the frameless result-viewer window for a stored call id; `false` when the result is unknown or pruned |
| `mcp:get-servers` | server list with masked secrets (env/header key names only) + live status |
| `mcp:save-server` | create/update a server; env/header values are stripped into the keyring on receipt |
| `mcp:delete-server` | remove a server and its stored secrets |
| `mcp:set-enabled` | enable/disable a server |
| `mcp:set-tool-override` | per-tool enable/risk override (namespaced tool name) |
| `mcp:test-server` | force a connection; returns latency + tool count or error |
| `mcp:list-tools` | connect (or reuse the live client) and describe a server's tools: raw + namespaced names, description, parameters, effective risk/enabled/verification; on failure returns cached tools + the error |
| `search:get-providers` | ordered web-search provider instances (masked: `hasKey` + `keyHint` only, never key material) |
| `search:save-provider` | create/update an instance; `key` is stripped into the keyring on receipt (`''` clears it) |
| `search:delete-provider` | remove an instance and its stored key |
| `search:set-provider-enabled` | enable/disable an instance without deleting it |
| `search:move-provider` | reorder instances (`up`/`down`); array order is failover priority |
| `search:test-provider` | run a 1-result query through the instance; returns latency + result count or error |
| `memory:list` | stored memories (`MemoryView[]`), most recent first, capped |
| `memory:search` | keyword search over memory contents (ranked) |
| `memory:delete` | forget by id; returns whether a row was removed |
| `memory:restore` | re-create a deleted memory (undo path) through the normal save/dedupe rules |
| `desktop:selection-supported` | whether selection capture can work on this OS/session (false on Wayland) |
| `desktop:clipboard-changed` | opt-in (`behavior.clipboardWatcher`) poll-on-summon: hash-compare only, returns text + preview when changed |
| `desktop:capture-selection` | explicit user click only: simulate copy keystroke, read clipboard, restore prior contents |

### Commands (plan 14)

| Channel | Purpose |
|---|---|
| `commands:get-catalog` | assembled catalog snapshot (`CommandCatalogSnapshot`): entries from native tools (destructive/kill-switched excluded) + builtins (nav set, calculator, file search), recent ids from `CommandInvocation`, pins from `commands.pins`; `commands.hidden` and the `commands.enabled` kill switch applied |
| `commands:execute` | user-initiated execution of builtin/web/app commands in main (`{ status: 'done' | 'turn' | 'error' }`); tool-backed entries return `turn` — they ride `ai:turn-start` with `directTool.commandId` so the policy path is unchanged; records `CommandInvocation` (args stored for read-only builtins only) |
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
| `settings:open` | open/focus the settings window; optionally accepts a `{ tab, commandId }` deep-link target (plan 14 §6 row menu → Configure) |
| `settings:save` | persist settings |
| `settings:navigate` (main → settings window, push) | delivers the deep-link target after the settings renderer mounts |

### System, files & dialogs

| Channel | Purpose |
|---|---|
| `system:get-platform` / `get-arch` / `get-app-version` | environment info |
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
