# Adding features

This page is a set of recipes. Each one lists the files that must change
together — the repo's rule is that a unit of work updates its docs and
tests in the **same commit**.

Before starting, run the verification gate once so you know the baseline
is green:

```bash
npm run verify
```

## Module placement

| Work | Goes in |
|---|---|
| Privileged logic (fs, DB, OS) | `src/main/services/` |
| Model I/O | `src/main/ai/` (gateway + factory only) |
| New renderer↔main operation | `ipc-handlers.ts` + `preload.ts` + `src/shared/types.ts` |
| Settings UI | `src/renderer/settings-react/` |
| Chat overlay UI | `src/renderer/chat-react/` |
| Turns / streaming | `src/main/turns/` (TurnManager) |
| Behavior / hotkeys | `config.behavior` + `HotkeyAction` |
| Cross-process constants/types | `src/shared/` |
| User-facing strings | `src/shared/constants/text.ts` |

## Recipe: a new IPC operation

1. Add the handler in `src/main/ipc-handlers.ts` (keep domain grouping).
   Validate argument shapes.
2. Expose a typed method in `src/preload/preload.ts`.
3. Extend `ElectronAPI` in `src/shared/types.ts`.
4. Add the row to [ipc.md](ipc.md).
5. Test the handler (mocked Electron) and, if it drives UI, the
   event-driven renderer path (see [testing.md](testing.md)).

For main → renderer pushes, register the listener method in preload
(never raw `ipcRenderer.on` in feature code) and document the channel.

## Recipe: a new native tool

1. Create `src/main/ai/tools/native/<name>.ts` with a
   `NativeToolDefinition` (name, description, zod `schema`, `risk`,
   `category`, `summarize`, `exec`; `pathArgs` for filesystem paths).
2. Register it in `native/index.ts`.
3. Test exec behavior and the policy/risk expectation.
4. If it writes files, append the `[artifact]` marker
   (`src/shared/artifacts.ts`).
5. Update the user [tools guide](../user/tools-and-approvals.md).

Full details: [tools-and-policy.md](tools-and-policy.md).

## Recipe: a new setting

1. Add the field to the relevant interface in
   `src/shared/config/AppConfig.ts` and to `DEFAULT_CONFIG`.
2. Merge it in `mergeWithDefaults` (deep-merge the section; add a
   migration if a legacy shape must be upgraded).
3. Add strings to `src/shared/constants/text.ts`.
4. Add the control to the right settings tab; use the library components
   (`SegmentedTabs`, `Card`, form primitives) and `--as-*` tokens.
5. Persist through the existing `config:save` path — settings write the
   whole config, so after any provider write the settings window must
   `adoptMainConfig()` or a later Save clobbers it with a stale draft.
6. Add a config-merge test and a settings-render test.
7. Update the user [settings reference](../user/settings.md).

## Recipe: a new AI task

1. Add the value to `AiTask` (`src/shared/types.ts`) and to
   `DEFAULT_CONFIG.taskAssignments`.
2. Define its fallback rule (most tasks fall back to chat; translation
   does not).
3. Route the call through the gateway with `task: AiTask.X` so it is
   audited.
4. Add the assignment row to the API tab (`API_TASK_*` strings).
5. Test resolution and audit.

See [ai-layer.md](ai-layer.md).

## Recipe: a new settings panel or chat surface

1. Build the component with `@neuronection/assistant-ui` primitives; check
   the family `family-ui` / `da-assistant-ui` skills first.
2. Route all strings through `text.ts`.
3. Use `SegmentedTabs` for sub-navigation; single-section panels render
   flat.
4. Add an axe scan (`tests/a11y-settings-app.test.tsx` or
   `tests/a11y-chat-app.test.tsx`) — exclusion-free.
5. If it is event-driven, add the end-to-end jsdom event test.

See [renderer-and-windows.md](renderer-and-windows.md).

## Recipe: a schema change

1. Edit `prisma/schema.prisma`.
2. `npm run prisma:gensql` (regenerate `src/main/resources/schema.sql`).
3. Add the idempotent `ensureTable` / `ensureColumn` bootstrap in
   `DatabaseService.setup()`.
4. Add a database migration test.
5. Update [data-model.md](data-model.md).

See [data-model.md](data-model.md).

## Recipe: a new global hotkey

1. Add the value to `HotkeyAction` (`src/shared/types.ts`).
2. Add a `DEFAULT_HOTKEYS` / `DEFAULT_CONFIG.hotkeys` entry.
3. Add the `executeAction` case in `HotkeyService`.
4. Add the renderer listener through the preload bridge if it targets the
   launcher.
5. Surface it in the Hotkeys tab and test registration.

## Before committing

```bash
npm run verify   # prisma generate + lint + typecheck + vitest + build
```

Then:

- Update the matching docs page(s) here and `docs/user/` if user-visible.
- Add a `CHANGELOG.md` entry under `## [Unreleased]`.
- Update `docs/STATUS.md` if the change moves a tracked area.
- Commit only what you intend; never commit secrets.
- Do not push unless explicitly asked.

For concurrent work, the family uses git worktrees — see the `family-dev`
skill for the bootstrap and ff-only merge-back protocol.
