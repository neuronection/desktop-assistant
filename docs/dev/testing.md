# Testing

Tests live in `tests/` and run on [Vitest](https://vitest.dev/). The
commit gate is:

```bash
npm run verify   # prisma generate + lint + typecheck + named contract gates + test + conformance + build
```

The named gates are `verify:ext-contract` (hash-stamped vendored
extension-contract manifest, byte-identical to the dev canonical when the
sibling exists), `verify:app-pack-contract` (generated pack module +
manifest schema drift) and `verify:extension-conformance` (the vendored
charter/fixture walls). CI without a `../dev` sibling still proves
byte-identity through `contracts/extension-contract.sync.json`.

Run just the tests with `npm run test` (or `npx vitest run`).

### Suite sizing under load

The suite runs 250 files, including expensive axe scans and multi-await
jsdom flows. Vitest's 5s default timeout is sized for a quiet single-file
run; under full-suite worker contention the heaviest classes (three axe
scans in one test, or a dynamic `ChatApp` import plus chained `findBy`
waits) crossed it while passing in isolation. `vitest.config.ts` therefore
uses `testTimeout: 20_000` / `hookTimeout: 20_000` and caps
`maxWorkers: 8` on a 16-core host. `isolate: false` was evaluated and
rejected: several files rely on module-level state (`commandSource`'s
catalog cache, the config/secret singletons) and jsdom globals
(`window`, `ResizeObserver`, `matchMedia`), so worker reuse would trade a
timeout for cross-file leakage. Timeouts stay global; never bump them per
test, skip a scan, or weaken an assertion.

Voice capture tests use **scripted audio-level ticks** and a manually
pumped `requestAnimationFrame` queue (`voice-indicator`,
`recording-manager`). Their speech/silence boundaries are frame-count
deterministic, not wall-clock sleeps; the product's 60 ms phrase timer
is still waited for with `vi.waitFor`, but a loaded runner can no longer
sample a 400 ms speech burst in too few frames. The sparse-frame pin
sets a controlled `Date.now` clock to prove the elapsed-speech fallback.
Other zero-delay yields (`live-session`, `speech-queue`) are
microtask scheduling, not frame choreography.

## The test pyramid (plan 46 S4)

Four layers, each owning what the layers below it cannot see:

| Layer | What it owns | Where it runs |
|---|---|---|
| **Unit** (services, reducers, pure logic) | business rules, persistence seams, state machines, decision math | `npm run test` (node) |
| **Component / axe** (renderer) | rendered DOM, keyboard maps, event-driven surfaces, accessibility | `npm run test` (jsdom, mocked `electronAPI`) |
| **IPC payload / contract gates** | channel registry ↔ registrar ↔ preload parity, envelope and charter drift, conformance fixtures | `npm run verify` named gates + source-level tests |
| **Playwright smoke** (real app) | the composed product: real windows, real IPC, real SQLite, real policy — over scripted providers | `npm run smoke:e2e` (mocked network) |

The mocked layers stay hermetic (no real Electron, keyring or network —
see "What tests must never touch"); the smoke layer is the one place a
real app instance runs, and it only ever talks to local scripted mocks.
A feature is "done" when the layers that apply to it are green — most
features need only the first two; cross-process surfaces need the third;
the launcher-to-persistence spine is pinned by the fourth.

## Setup

`vitest.config.ts` sets:

- `environment: 'node'` — the default, used by service, shared and AI tests.
- Path aliases matching the app: `@main`, `@renderer`, `@shared`,
  `@preload`, and `generated/prisma/client`.
- `include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']`.

A global setup file (`tests/setup/canvas.ts`) installs a no-op 2D canvas
context on `HTMLCanvasElement`; jsdom otherwise prints a
`Not implemented: getContext` warning for every render that touches the
canvas API (markdown/diagram surfaces). No native canvas package is
needed.

Component tests opt into a DOM with a **per-file pragma** on the first
line:

```ts
// @vitest-environment jsdom
```

`tests/a11y-chat-app.test.tsx` and `tests/streaming-live.test.tsx` are the
templates for that setup (they install `ResizeObserver`, `scrollIntoView`
and `matchMedia` shims in `beforeAll`).

## What tests must never touch

Tests never touch a real app instance, the OS keyring, or the network.
Electron is mocked with `vi.mock('electron')`; `window.electronAPI` is
replaced with a hand-built mock that captures listener callbacks. MCP
tests run against in-process fixture servers under `tests/fixtures/`
(stdio and streamable HTTP).

Helpers:

- `tests/helpers/scripted-model.ts` — `ScriptedChatModel`, a
  `BaseChatModel` that replays a script of `AIMessage`s. Use it to drive
  the agent graph without a provider; it also records the prompts it
  received so tests can assert prompt composition.
- `tests/fixtures/mcp-*.mjs` — SDK-based MCP servers (initialize →
  listTools → call) used by the MCP and tool-app trajectory tests.

## Test categories

| Category | Examples | Environment |
|---|---|---|
| Shared logic | `commands-parse`, `schedule-math`, `languages`, `turn-events-map` | node |
| Main services | `memory-service`, `tool-policy`, `schedule-service`, `secret-service`, `message-service`, `conversation-service`, `attachment-service`, `hotkey-service`, `database-migration`, `desktop-assistant-boot` | node |
| AI layer | `ai-gateway`, `assistant-graph`, `decide-*`, `translate-*` | node |
| Renderer components | `inspector`, `approval-card`, `command-palette`, `settings-*` | jsdom |
| Accessibility scans | `a11y-chat-app`, `a11y-desktop-app`, `a11y-settings-app`, `a11y-result-viewer` | jsdom |
| Event-driven streaming | `streaming-live`, `desktop-streaming-live` | jsdom |
| Trajectories | `app-ha-trajectory`, `mcp-e2e`, `research-graph` | node |
| Crash & permission posture | `error-boundary`, `renderer-error-reporting`, `main-crash-handlers`, `window-crash-recovery`, `permission-matrix` | node/jsdom |
| E2E smoke (real app, mocked providers) | `tests/e2e/smoke.spec.ts` via `npm run smoke:e2e` | Playwright + Electron |

## Event-driven renderer surfaces

**This is the important one.** Unit tests of a reducer plus main-side
tests can both stay green while the feature is dead end-to-end. The
2026-09 launcher regression is the cautionary tale: the desktop-mode
refactor dropped a single `dispatch({ type: 'send' })`, every event landed
in `idle` and was dropped, and only an end-to-end test that fires the real
event sequence through the actual channel would have caught it.

Any event-driven surface (turn streaming, approvals, notices, node
telemetry) needs a jsdom test that:

1. Renders the real component with a mocked `window.electronAPI` that
   captures the `onTurnEvent` callback.
2. Emits the real `TurnEvent` sequence through that captured callback.
3. Asserts the rendered result.

`tests/streaming-live.test.tsx` is the template; extend it (or copy its
shape) whenever the launcher state machine or the submit path changes.

## Accessibility

The axe scans are the family bar. They must stay **violation-free and
exclusion-free** — `RULE_EXCLUSIONS` stays empty, and new UI surfaces ship
with a scan in the same commit. Keyboard-map behavior (the Escape ladder,
`Ctrl+E`/`Ctrl+D`, `Enter`/`Shift+Enter`) is regression-tested in the same
files.

## Coverage (plan 46 S2)

```bash
npm run coverage   # vitest run --coverage (v8, text + json-summary)
```

`vitest.config.ts` carries **per-directory thresholds as floors**
(lines/branches, measured 2026-10-24 and recorded in the config
comment): main `ai` 82/74, `apps` 65/58, `db` 88/85, `services` 75/70,
`turns` 88/79, `renderer` 70/67, `shared` 65/72, `packs` 90/86,
`preload` 85/95, plus a 50/50 global net. Floors rise as suites grow
and are **never lowered without a recorded reason** in the commit.
Electron-lifecycle shells are deliberately ungated: the `src/main/ipc/`
registrars execute only under the live `register` wrapper (their parity
is proven by the source-level registry/conformance tests), and
`window.ts`/`tray.ts`/`main.ts`/`ipc-handlers.ts` run only in the real
app (covered by the packaged `--smoke` boot and the E2E smoke below).

Coverage is **not** part of `npm run verify`: v8 instrumentation
roughly doubles the suite's wall time and the commit gate must stay
fast. Run it locally or in CI when coverage-relevant code lands; the
threshold gate is proven to fail red.

## Playwright E2E smoke (plan 46 S3)

```bash
npm run smoke:e2e   # builds main, starts vite + the demo mocks, runs Playwright
```

The smoke drives the **real Electron app** over the demo harness — the
same reproducible recipe as the tour capture (`scripts/ui-capture/`):
a fresh `--demo-fresh` workspace and the local scripted
assistant/search services, zero external network. Two paths, pinned
end-to-end:

1. **Launcher turn** — boot → summon → type → send → the scripted
   `memory_save` state-changing tool call → the approval card →
   "Allow once" → completion text → the **persisted transcript**
   verified by opening the desktop window (which reads the SQLite store
   through IPC).
2. **Settings provider form** — expand → settings → API tab → provider
   card menu → Edit → clear the name → Save → the exact
   validation-error copy (`TEXT.API_NAME_REQUIRED`) surfaces as a toast.

Specs live in `tests/e2e/`, driven by `playwright.config.ts` (one
worker; each test boots its own app instance serially).
`.github/workflows/ci.yml` runs the script under `xvfb-run` as the
`e2e-smoke` job. The tour capture harness is untouched — the smoke
reuses its mocks but never changes capture behavior. Headless runs need
an X server (`xvfb-run` in CI; a desktop session locally).

Demo determinism notes: `applyDemoConfig` opts the demo into
`stateChanging: 'always_ask'` (so the approval flow is demonstrable) and
keeps the demo provider's documented fake credential (`demo-local`) in
the isolated workspace config — demo turns work without a keyring
backend; real providers still scrub into OS-protected storage.

## Conventions

- New behavior ships with its tests in the **same commit**.
- Prefer testing the seam (the service function, the reducer input, the
  emitted event) over private internals.
- Don't assert on log text; assert on outcomes and payloads.
- Keep tests deterministic — no real timers, network, or keyring. Inject a
  clock where one is needed (see the schedule service).
