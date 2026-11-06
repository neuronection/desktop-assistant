# IPC schema registry

`src/shared/ipc/registry.ts` is the single source of truth for every IPC
channel. One descriptor declares:

- `channel` — the exact wire name;
- `direction` — `invoke` (`ipcMain.handle`), `send` (`ipcMain.on`),
  or `event` (main→renderer push);
- `scope` — which windows may call it (`all`, `launcher`, `desktop`,
  `settings`, `pack`, `result`);
- `request` — a zod tuple parsed by the wrapper before the handler runs;
- `response` — the typed result;
- `bridge` — the generated preload method (invoke/send/on);
- `summary` — the generated documentation row.

`src/main/ipc/register.ts` owns the one registration pattern:

```ts
register(IPC['channel'], async (event, ...args) => result);
```

The wrapper validates args through the descriptor, enforces window scope
from the sender URL at invoke time, and uses the one typed error
vocabulary `ipc:<code>: message` (`invalid_args`, `scope_denied`,
`unknown_channel`, `handler_error`).

Registrars under `src/main/ipc/` and `src/main/apps/ipc.ts` contain no
`ipcMain` calls and no hand-rolled argument validation. `preload.ts` and
`docs/dev/ipc.md` are projections of the registry; regenerate the docs
with:

```bash
node scripts/generate-ipc.mjs
```
