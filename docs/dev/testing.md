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
| Main services | `memory-service`, `tool-policy`, `schedule-service`, `secret-service` | node |
| AI layer | `ai-gateway`, `assistant-graph`, `decide-*`, `translate-*` | node |
| Renderer components | `inspector`, `approval-card`, `command-palette`, `settings-*` | jsdom |
| Accessibility scans | `a11y-chat-app`, `a11y-desktop-app`, `a11y-settings-app`, `a11y-result-viewer` | jsdom |
| Event-driven streaming | `streaming-live`, `desktop-streaming-live` | jsdom |
| Trajectories | `app-ha-trajectory`, `mcp-e2e`, `research-graph` | node |

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

## Conventions

- New behavior ships with its tests in the **same commit**.
- Prefer testing the seam (the service function, the reducer input, the
  emitted event) over private internals.
- Don't assert on log text; assert on outcomes and payloads.
- Keep tests deterministic — no real timers, network, or keyring. Inject a
  clock where one is needed (see the schedule service).
