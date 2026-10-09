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
   Content excerpts need `privacy.sendsContent` + `decide.readContext`,
   optionally gated per run by `decide.readContextWhen` over a config
   signal (the reference pack's read-context toggle).
3. `npm run app-pack -- validate my-pack-dir/mini-app-pack.json` until
   it prints `OK`.
4. Import from Settings → Apps → Mini-apps.

Bundled packs ship as JSON in `src/main/resources/packs/` (installed at
boot via `ensureBundled`, validated through the same shared validator —
the CI suite re-validates every bundled file). The
`file-deletion-review` reference pack is the worked example to copy
from.

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

**S5 complete: report surface + review queue.**

- The declarative renderer (`RunReportModal` + `PackReportRenderer`,
  settings-react/apps): host-rendered closed vocabulary driven by the
  pack's report schema (`reportNodes` + `labels` ride the report view,
  with a safe fallback schema when the pack is gone). `stat`/`badge`/
  `progress` bind to run+totals data, `table`/`cards` render items,
  `filter-bar` filters by verdict + search, and the **evidence
  drilldown** (rule label + per-question answers + confidence, as JSON
  disclosure) ships wherever recommendations render — the validator
  already refuses a schema without it.
- The **ask review queue**: `ask` items list Keep / Candidate / Exclude
  actions → `miniapps:override-item` / `miniapps:exclude-item` persist a
  `MiniAppFeedback` row (unique per pack+root+path) AND rewrite the run
  item. Later runs apply overrides **over rules and the model** (no
  model call for overridden paths, `decidedBy: override:*`) — pinned by
  a two-run test.
- Item actions `reveal`/`open` re-validate against the run root in main
  (join-within-root + root re-validation, executables refused).
- Everything axe-scanned exclusion-free (renderer + modal suites).

**S6 complete: arm + quarantine (the destructive path).**

- `quarantine.ts` — the only destructive verb: move-to-quarantine
  under `<userData>/mini-apps/<pack>/quarantine/<run>/` (mirrored
  layout + per-batch `manifest.json`), same-volume rename with EXDEV
  copy+delete fallback, per-item revalidation, restore that never
  overwrites (`.restore-<n>` suffix, parents recreated), 30-day
  retention pruned on boot (the only automatic deletion), and a
  user-armed `empty()` per pack. Every fs op injected; packs never
  touch this module.
- `run/proposals.ts` — HITL Class-B (ADR-0015 Tier 1 floor): the
  fail-closed gate at ARM time (candidate ∧ confidence ≥
  `propose.gate.minConfidence` ∧ not on the sensitive list), a
  `MiniAppProposal` row per batch (pending → approved/rejected →
  executed/failed/aborted), **idempotent resolve** (second responder =
  no-op), and EXECUTION as one revalidate-and-move per item: the live
  fingerprint is re-computed via the same `runnerFingerprint` the
  assessment used — a changed file drops to `ask` and is never moved.
  Batches run sequentially and fail soft; the kill switch returns
  not-yet-moved items to `ask`.
- Surfaces: the report modal's **Quarantine candidates…** card
  (grouped by the pack's `groupBy` category, gate outcome summary,
  approve/reject), per-item **Restore** buttons on quarantined rows,
  `miniapps:proposal-event` push to every window, and a completion
  notification reporting how many actually moved.
- Pinned by tests: the gate matrix (low confidence / sensitive /
  non-candidate excluded), change-after-assessment → `ask`,
  restore round-trip with an occupied origin, retention vs the
  user-armed purge, fail-soft batches, abort, idempotent resolve, and
  an axe-scanned arm card.

**S7 complete: the reference pack + dogfooding.**

- `resources/packs/file-deletion-review.json` — the user's original
  brief as pure data: exception globs, excluded extensions, the fresh
  window and the read-context toggle are ALL config; sensitive globs
  are pack-declared (and union with the host baseline at the gate);
  deterministic rules decide the majority (veto/keep/ask/candidate),
  three typed questions (safe noul, recoverability score, category
  choice) cover the residual; compose confirms candidates at ≥ 0.8
  confidence and keeps confidently-regenerable files; propose groups by
  category with a 0.8 gate. Validated by the CLI and in CI through the
  shared validator, and driven end-to-end by tests: run → arm →
  per-item quarantine (real fs moves) → restore round-trip → idempotent
  re-resolve.
- Bundled pack installation: the registry's `ensureBundled` validates
  and installs bundled manifests (resources JSON + the Tier-1 code
  packs) at boot — origin `bundled`, never clobbering a user import.
- `resources/packs/file-deletion-review.json` and
  `src/main/apps/packs/<id>/` (Tier-1 code packs: manifest +
  `SURFACE_COMMAND_BINDINGS`) + `src/renderer/chat-react/packs/<id>/`
  (renderer bindings, `SURFACE_RENDERER_BINDINGS`) — one directory per
  bundled app on each side of the process boundary, single registration
  points, table-driven dispatch. Adding a first-party surface is one
  manifest + one binding; the layout is the template for Tier 2
  (imported code packs behind an isolated-process RPC shim — a separate
  future plan per ADR-0029 clause 10).
- Contract amendment (append-only): `decide.readContextWhen` — a
  condition over config signals gating content excerpts per run, so
  read-context is a user knob without a pack re-release.
- Dogfooding: the calculator and translate pad are now defined as
  **surface packs** (`mini-calc`, `mini-translate` — kind surface, `ui`
  capability, commands + input-mode contributions) through the same
  registry/validator path; their interactive renderers stay host-owned
  chat-react code keyed by pack id (the Tier-1 contribution model).
  Existing mini-app tests pass unchanged — the byte-compat bar.

S8 (docs, skills, release surfaces) closes the plan.
