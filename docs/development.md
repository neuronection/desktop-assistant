# Development

How to build, run, and debug Desktop Assistant. Architecture lives in
[architecture.md](architecture.md); the IPC surface in [ipc.md](ipc.md).

## Setup

```bash
./scripts/run-dev.sh      # bootstrap + verify-deps + dev group
                          # + prisma generate + the whole dev group
```

Under the hood (or step by step):

```bash
npm install
npm run prisma:generate   # required — src/generated/ is not committed
```

`./scripts/run-dev.sh` supports `--force` (free the dev port), `--force-stop`,
`--no-bootstrap`, `--smoke` (production build + packaged-style smoke boot in a
temp data dir) and `--help` — the same interface as the other family products.

Requires Node 18+ and a desktop environment (Electron). The Prisma CLI
reads `.env` (`DATABASE_URL`, see `.env.example`) for CLI commands only;
the app sets its datasource URL explicitly at runtime. `npm run verify`
regenerates the Prisma client, so a fresh clone works without a manual
generate step.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server (:5173) + tsc watch (main/preload) + Electron with inspector |
| `npm run lint` | ESLint (flat config, `src/`) |
| `npm run typecheck` | `tsc --noEmit` for renderer and main projects |
| `npm run test` | Vitest (`tests/`, no real Electron/keyring/network) |
| `npm run verify` | Prisma generate + lint + typecheck + test + build — **the commit gate** (fresh-clone safe: it regenerates `src/generated/` itself) |
| `npm run build` | Prisma generate + main/preload + renderer production builds |
| `npm run dist` | `build` + electron-builder packages (see [packaging.md](packaging.md)) |
| `npm run debug:main` | Electron with `--inspect=5858` for main-process debugging |

### Verification gate

`npm run verify` — green before every commit. Tests for new behavior land
in the same commit (Vitest, `tests/`); UI changes additionally get a
manual smoke via `npm run dev`.

## Data locations (runtime)

Everything lives under Electron's `userData` directory — Linux:
`~/.config/<app-name>/`:

- `conversations.db` — SQLite (Prisma) conversations + messages
- `config.json` — app + provider configuration
- `window-state.json` — overlay window geometry

Deleting the directory resets the app to first-run state. The directory
name follows the app identity (changed during the family adoption — old
development data from the previous identity is not picked up).

## Project conventions

- User-facing strings route through `src/shared/constants/text.ts`
  (`TEXT` + `interpolate`/`pluralize`); no display literals in
  components — i18n adoption stays mechanical.
- Accessibility is a family bar: axe scans (`tests/a11y-chat-app.test.tsx`,
  `tests/a11y-settings-app.test.tsx`) must stay violation- and
  exclusion-free — new UI surfaces ship with a scan; keyboard-map
  behavior (Escape ladder, Ctrl+E/Ctrl+D, Enter/Shift+Enter) is
  regression-tested in the same files.
- Renderer talks to main **only** through the preload bridge
  (`src/preload/preload.ts`); adding an operation means touching
  `ipc-handlers.ts` + `preload.ts` + `src/shared/types.ts` together
  (rules and registry: [ipc.md](ipc.md)).
- Main process owns all privileged work (fs, DB, AI, OS integration);
  renderer is untrusted and stays DOM-only.
- Schema changes: edit `prisma/schema.prisma`, then regenerate the
  runtime bootstrap SQL (`npm run prisma:gensql`) in the same change.
- Window look: frameless + rounded corners is a product trait; keep
  window transparency + CSS radius working when touching `window.ts`.
  Transparency is config-driven (`window.transparent`, Settings →
  General → "Transparent window", applied live by recreating the main
  window; legacy seeds migrate to the glass default via
  `window.transparentSet`). Cinnamon still forces opaque unless config
  or `DESKTOP_ASSISTANT_OPAQUE=1|0` / `./scripts/run-dev.sh --opaque|
  --glass` says otherwise.
- Drag vs resize: `.chat-drag-root` is the drag region; only real
  controls (buttons/inputs/textarea, `[data-no-drag]`) opt out; the
  expanded panel header is an explicit drag handle
  (`[data-as='chat-panel-header']`, grab cursor — buttons inside stay
  no-drag). The launcher window is `resizable: false` — no OS resize
  grips; manual resize happens through the in-app bottom corner handles
  (`ResizeHandle.tsx` → `window:resize-corner-*`, bounds math in
  `computeCornerResizeBounds`) which suspend the auto-resize until the
  next send/dismiss. X11 + `resizable: false`: `setSize` is a no-op
  (use `setBounds`) and `getMaximumSize()` reports the current size —
  never clamp resize targets against it. The desktop and settings
  windows keep native OS resizing.
- CSS box-shadows on full-window roots paint into the rounded-corner
  notches of a transparent frameless window (clipped haze) — the window
  edge is defined by the root `border`, not a shadow.
