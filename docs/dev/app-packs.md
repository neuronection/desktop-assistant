# Mini-app packs

Mini-app packs (plan 26, ADR-0029) are **declarative, importable task
apps**: a manifest plus a typed run pipeline and a report schema. The
host — never the pack — owns every capability: filesystem access, model
calls, runs, approvals and rendering. v1 ships **Tier 0 data packs
only** (imported JSON, no code execution, `net` denied); bundled code
packs (Tier 1) exist as a trusted tier for the dogfooding surfaces.

Family contract (single source): `dev/contracts/mini-app-packs.json`
(vendored byte-identically at `contracts/mini-app-packs.json`).
Everything below derives from it.

## Where the code lives

```
src/shared/app-pack/     the SDK — pure TypeScript, no Electron/Node APIs
├── contract.generated.ts   GENERATED from contracts/mini-app-packs.json
│                          (scripts/sync-app-pack-contract.mjs; --check drift gate)
├── types.ts                manifest/verdict/run/report types + settings shapes
├── validate.ts             the ONE validator (SDK + runtime share it — parity
│                          is test-enforced, ADR-0029 clause 11)
├── builders.ts             definePack / question / rule / run / ui helpers
└── cli-core.ts             pack init | validate core (used by scripts/app-pack/)

src/main/apps/
├── registry.ts             install/enable/disable/remove, digest + origin,
│                          apiVersion negotiation, boot self-disable
├── capabilities/           S2 — the trust boundary (see Stage status)
├── runner/                 S3 — evaluate.ts (pure) + runner.ts pipeline
└── run/                    S3 — store.ts seam + RunService orchestration

src/renderer/settings-react/apps/MiniAppsSection.tsx
                            Settings → Apps → Mini-apps: pack list, capability
                            badges, self-disable reasons, config auto-form,
                            import from file
```

The CLI: `npm run app-pack -- init [dir] [--id x] [--title y]` scaffolds
a valid `mini-app-pack.json`; `npm run app-pack -- validate <file>
[--bundled]` prints path-precise issues. The runner bundles the shared
validator through vite — the CLI is the same code the runtime runs.

## Manifest shape (summary)

`apiVersion` (integer, currently 1), identity (`id`/`version`/`kind`:
`assessment` | `surface`), `capabilities` (closed list from the
contract), `configSchema` (a JSON-Schema subset the settings form renders
deterministically), `privacy` (`sendsContent`, `sensitiveGlobs`,
`contentCapBytes`), `run` (assessment only: `scan → classify → decide →
compose → propose?` in fixed order), `report` (closed component
vocabulary incl. a **mandatory `evidence` component** wherever
recommendations render), `i18n` (every locale carries the same key set;
labels resolve through the host locale), and Tier-1-only
`contributions` + `code` (rejected in imported manifests).

Key invariants the validator enforces:

- **Packs never half-run** — unknown field/step/capability/slot, apiVersion
  too new, failed digest, privacy inconsistency or broken cross-reference
  (compose referencing an undeclared rule/question/config key)
  self-disables the pack with a path-precise reason.
- **Deterministic-first** — classify rules are four ordered lists
  (`veto → keep → ask → candidate`); compose's default verdict is always
  `ask` (fail-closed); model questions run only on the residual.
- **Privacy lint** — `decide.readContext` requires `privacy.sendsContent`.
- **Trust tiers** — `ui`, `ui:custom-code`, `contributions` and `code`
  are bundled-only; `net` and `fs-write-mutate` are reserved for a future
  apiVersion and rejected with the contract-upgrade reason.

## Install lifecycle

Installed packs persist in `config.miniApps` (`masterEnabled` +
`packs[]`, toolApps parity): raw manifest, sha256 digest, origin
(bundled | imported path + timestamp), enabled flag, optional self-disable
`error`, user `config` values. On boot (and on import) the registry
revalidates every stored manifest with the shared validator **and its
digest** — a tampered or host-downgrade-orphaned pack self-disables
instead of running. Re-importing an installed id must raise the version;
run/verdict data will live in the app DB from S3 onward (not in config).

## IPC

`miniapps:get-state` / `miniapps:import` / `miniapps:remove` /
`miniapps:set-enabled` (id `null` = master) / `miniapps:save-config` —
see [ipc.md](ipc.md). Import takes the file **content** (the renderer
reads it via the standard open-file dialog channel) and validates with
the same options an imported manifest always gets.

## Authoring a pack

1. `npm run app-pack -- init my-pack-dir --id my-pack` — a minimal valid
   assessment pack.
2. Edit the pipeline/rules/questions/report; keep every locale's key set
   complete (`title`, `rule.<id>`, `config.<key>`, `report.<id>`).
3. `npm run app-pack -- validate my-pack-dir/mini-app-pack.json` until
   it prints `OK`.
4. Import from Settings → Apps → Mini-apps.

Config values feed predicates via the `config.<key>` signal; thresholds
compare signals (`valueSignal`) so user config never requires a pack
re-release. The full vocabulary (slots, capabilities, the 10-code typed
error model, run statuses/events, quarantine rules, limits) lives in the
contract file — treat it as normative, this page as the map.

## Stage status (plan 26)

S0 complete (ADR-0029 accepted 2026-10-08). S1 complete: contract
tooling, SDK, registry, settings surface, CLI, sample fixture.
**S2 complete: the capability layer** (`src/main/apps/capabilities/`) —
the trust boundary between packs and the host:

- `fs.ts` — run-root validation (contract `fs.rootValidation`: lexical
  safety, realpath-first resolution, system/broad-root refusal on BOTH
  the requested and the resolved path, per-platform lists) and the pack
  walk (`scanTraversal`: symlinks skipped, mount points skipped via
  `st_dev`, regular files only, hidden/excludeGlobs/fileCap/maxDepth,
  deadline-bounded budget). `PackFs` re-validates every read against the
  root (realpath containment + same-device + regular-file) — no
  check-then-act window. Content excerpts are capped by the contract
  limit. All fs ops are injected (`node-fs.ts` is the production
  adapter) — packs hold no OS handles, tests hold no real fs.
- `decide.ts` — `PackDecideBridge.ask(input, questions)` through the
  EXISTING decision funnel (`runDecision`): registry resolution,
  task-bound engines, exactly one `AiCall` audit row per call. Failures
  map onto the contract's typed error model (`off`/`unconfigured` →
  `not-ready`, keyless cloud engine → `needs-secret`, 429 →
  `rate-limited`, other upstream → `provider`). No provider, model or
  SDK name ever crosses the bridge.
- `run.ts` — `PackRunBridge`: start/progress/cancel only, per-pack
  isolation (one pack can never address another's run), AbortController
  cancellation, `paused` runs resumable with a fresh signal. The S3
  RunService layers persistence/checkpointing/budgets on this seam.
- `index.ts` — `capabilitiesFor(pack, deps)`: capability-gated
  registration; accessing an undeclared bridge throws
  `PackCapabilityError` at registration, never mid-run. There is no
  `net` member at any tier; `fs-write-quarantine` arrives with the S6
  propose executor.

**S3 complete: the assessment runner + RunService.**

- `runner/evaluate.ts` (pure) — the condition evaluator (all/any/not,
  comparisons, membership, `matches`/`matches-any` globs, `valueSignal`
  config thresholds) and the pinned classify/compose semantics:
  lists evaluate veto → keep → ask → candidate (first match is the
  evidence rule); veto/keep/ask finalize without the model; candidate
  matches + unmatched items form the residual; compose runs on every
  model-decided item (keepWhen → candidateWhen → askWhen → default
  `ask`). Unresolved signals fail closed (an unmatched rule reads as
  unresolved, not false-vs-true).
- `runner/runner.ts` — scan → classify → decide → compose with per-item
  checkpointing, the fingerprint cache (`sha256(root|path|size|mtime[|excerpt])`),
  budget pre-flight (estimate = residual count, emitted before any model
  call), resumable budget/rate-limit exhaustion (`paused`), provider
  failure failing the run (resumable), cooperative cancellation between
  items, and `readContext` excerpts (capped, privacy-gated, hashed into
  the fingerprint).
- `run/RunService.ts` — main-owned orchestration: one active run per
  pack, persisted `MiniAppRun`/`MiniAppRunItem` rows (Prisma → runtime
  `schema.sql` in the same commit), resume that REJECTS stale runs
  (pack version / config / engine changed → start a new run — the cache
  key would silently invalidate everything), boot reconciliation of
  orphaned `running` rows to `interrupted`, and merged totals across
  resumed segments. Wired in `ipc-handlers` with the Prisma store
  adapter; the `broadcast` seam is where S4 attaches window push
  (`miniapps:run-event` lands WITH its preload listener + renderer
  surface, never before).
- `ai/decide/limiter.ts` — the ONE priority semaphore at the decision
  funnel: every `runDecision` caller shares it; interactive requests
  (tool dispatch, gates, voice) overtake queued background work when a
  slot frees, so assessment runs yield to chat/voice. The pack decide
  bridge passes `priority: 'background'` — no second limiter exists.

Proven by tests, not assertions: the full-stack suites run the real
`PackDecideBridge` → `runDecision` → scripted model with the audit sink
attached — budget exhaustion stops at exactly N audit rows, resume adds
exactly the pending count (never re-deciding), and a fresh run over an
unchanged tree adds ZERO audit rows (pure cache service).

**S4 complete: runs in history, reporting, exports.**

- History model (user decision 2026-10-08): a **real Conversation per
  run** (the schedules precedent). `start` creates a dedicated
  conversation and an assistant run-card message; the card carries
  `TurnMetadata.miniAppRun` (status, totals, estimate/actual calls,
  tokens) and is rewritten when the run settles — live progress rides
  the `miniapps:run-event` push instead of message churn. Terminal
  settle fires the standard completion notification
  (`behavior.notifyOnComplete`-gated).
- `miniapps:run-*` IPC + the `miniapps:run-event` broadcast landed
  together with their preload listener (see ipc.md): start (root pick +
  typed refusals), cancel, resume, runs-list, report, export
  (markdown/JSON/CSV), diff.
- The runs UI (`PackRuns` in Settings → Apps → Mini-apps): start/cancel/
  resume, the **pre-flight estimate** ("≈ N model calls") and live
  progress from events, run history with per-run cost (calls + tokens),
  pending counts, exports and the changed-since-last-run diff modal.
- Exports + diff are pure (`run/export.ts`) with snapshot tests; the
  e2e jsdom suite drives the REAL `run:*` event sequence through the
  actual preload listener seam (estimate → progress → paused → resumed
  → finished), and a completed run survives a "restart" (a fresh
  service over the same store).

S5+ (declarative report surface + review queue, arm + quarantine, the
`file-deletion-review` reference pack) land stage by stage.
