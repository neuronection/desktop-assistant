# Mini-app packs

Author a pack? Read the **[pack authoring guide](pack-authoring.md)** —
the full feature reference with examples, testing and debugging. This
page holds the architecture and the stage map.

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
├── extension.generated.ts  VERBATIM embeddings of the vendored family
│                          artifacts (charter + envelope/sources schemas;
│                          scripts/sync-extension-artifacts.mjs drift gate)
├── mapping.ts              the family-envelope → pack-manifest projection
│                          (the explicit, tested mapping — see below)
├── sources.ts              sources/consent/updates wire shapes
├── types.ts                manifest/verdict/run/report types + settings shapes
├── validate.ts             the ONE validator (SDK + runtime share it — parity
│                          is test-enforced, ADR-0029 clause 11)
├── builders.ts             definePack / question / rule / run / ui helpers
└── cli-core.ts             pack init | validate core (used by scripts/app-pack/)

src/packs/                 bundled packs — ONE directory per app (pack.ts /
│                          pack.json manifest, optional pure logic, renderer
│                          binding); see src/packs/README.md and
│                          docs/dev/pack-authoring.md
src/main/apps/
├── registry.ts             install/enable/disable/remove, digest + origin,
│                          apiVersion negotiation, boot self-disable,
│                          ensureBundled (tombstone-aware install/upgrade)
├── sources/                the family sources pipeline (descriptor
│                          validation, the constrained git transport,
│                          consent + pins + updates + park semantics)
├── capabilities/           the trust boundary (see Stage status)
├── runner/                 evaluate.ts (pure) + runner.ts pipeline
├── run/                    store.ts seam · RunService · proposals · export
├── windows.ts              ui:window host surface (see below)
└── quarantine.ts           move / retention / restore, audited

src/renderer/settings-react/apps/    MiniAppsSection (pack cards, config
                                    auto-form, import) · PackRuns (start/
                                    resume/cancel, estimates, exports, diff) ·
                                    RunReportModal + the declarative renderer
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

Bundled packs live in ONE directory per app under `src/packs/<id>/` —
`pack.ts`/`pack.json` (manifest), pure logic (e.g. `evaluate.ts`), and
`renderer.ts` (the renderer binding). Installed at boot via
`ensureBundled`, validated through the same shared validator; the CI
suite re-validates every bundled manifest. The `file-deletion-review`
reference pack is the worked example to copy from.

Config values feed predicates via the `config.<key>` signal; thresholds
compare signals (`valueSignal`) so user config never requires a pack
re-release. The full vocabulary (slots, capabilities, the 10-code typed
error model, run statuses/events, quarantine rules, limits) lives in the
contract file — treat it as normative, this page as the map.

## Extension sources — import from git or a local folder (plan 32 Phase 8, ADR-0040 D13/D15/D19/D22/D25)

The local-file Tier-0 import rides the **family sources pipeline** — the TS
adoption of the Phase-3 career reference semantics (`app/extensions/lifecycle.py`)
against the SAME vendored schemas. One pipeline, two source kinds:

- **git source** — an https-only URL (the schema's root descriptor; ssh/file
  transports and userinfo credentials are structurally inexpressible).
- **local file source** — the schema's structurally distinct
  `$defs.localSourceDescriptor` variant: an ABSOLUTE path with no `..`
  segments. Structural confinement is schema law; host-side confinement is
  ADDITIONAL host policy (desktop is a local app: the local kind is always
  available and confined to the structural rules).

Code lives in `src/main/apps/sources/`: `descriptor.ts` (vendored-schema
validation via the shared `schemaCheck` interpreter — now covering `not` and
`contains`), `transport.ts` (the git subprocess), `lifecycle.ts` (the service),
`secretKey.ts` (the `ext-source:<slot>` keyring convention). Generated charter/
schema embeddings: `src/shared/app-pack/extension.generated.ts` via
`scripts/sync-extension-artifacts.mjs` (byte-identical law — the vendored JSON
at `contracts/` stays canonical; never hand-edit either side).

### The pipeline (one shape for both kinds)

resolve (ls-remote per the ref strategy: release-tag | tag-pattern | branch |
commit-pin) → shallow fetch (`git clone --depth 1 --branch <ref>` for tags/
branches, `init + fetch --depth 1 + checkout FETCH_HEAD` for sha pins) →
manifest discovery (root + ONE level of child dirs, `manifest.json`, 512 KB
cap) → schema validation against the vendored family envelope → host-profile
mapping/compat → per-extension consent → pinned, content-addressed install.

The transport is constrained: the allowlisted `git` executable resolved once
via `which`/`where`, every invocation an argv array (no shell, no
interpolation — source-provided strings are pattern-validated against the
vendored schema BEFORE any spawn), 30 s timeout, `GIT_TERMINAL_PROMPT=0`,
credentials ride `GIT_CONFIG_*` environment (never argv, never logs), resolved
from keyring slots at fetch time. Local sources ride the SAME git transport
with the path as the origin — one code path (career parity). A test seam
(injectable `GitTransport`) keeps the suite network-free; the adversarial
suite additionally exercises a REAL local repo through the child-git path.

### The family-envelope → pack-manifest mapping (the explicit projection)

The importable family class on desktop is **kind mini-app, packKind
assessment** — the full declarative pipeline. The projection
(`src/shared/app-pack/mapping.ts`, pure + tested) reads the desktop host
profile from the vendored charter (data, never code):

| Family envelope | Desktop pack manifest | Rule |
|---|---|---|
| `kind: mini-app` | (implicit) | connector/bridge ⇒ self-disable reason (bridge is server-class) |
| `apiVersion` (integer ≤ 1) | `apiVersion` | the mini-app kind keeps the ADR-0029 integer lineage; too new ⇒ self-disable reason |
| `packKind` | `kind` | assessment accepted; surface ⇒ self-disable (below) |
| `capabilities` | `capabilities` | identity map for the charter desktop-profile `honors` set: `fs-read, fs-write-quarantine, decision, llm, run, report, propose, ui:window` |
| `net` | — | the exfiltration-class rejection at T0 (never an unknown-capability reason) |
| any other capability (`secrets`, `chat-tools`, `ui:page`, `ui:panel`, `ui:chat-card`, `ui:settings`, `notify`, `state`, `sync`, …) | — | unhonored ⇒ self-disable reason naming the id (the charter's D8/D17 law — the compat check is data) |
| `surfaces.{page,panel,window}` + `data` | — | no desktop rendering host for per-surface declarative schemas — the window surface renders the pack REPORT; declared surfaces/data self-disable with the degrade chain named (page→panel chains to nothing honored) |
| `configSchema` | `configSchema` | pass-through; a `required` list (not expressible in the kind refinement) or any `x-secret` field (the pack-config store is not a secret store, D19) ⇒ self-disable with the re-author reason |
| `description` | i18n `description` key | injected into every locale (same-key-set invariant preserved) |
| `author` / `license` / `repository` / `categories` | install record only | provenance renders verbatim on the consent surface + the origin card (D19/D25) — no pack-manifest field exists |
| `i18n` / `run` / `report` / `liveCard` / `privacy` / `icon` / `defaults` | identity | identical shapes (the family envelope generalizes desktop's plan-30 schema); the shared validator stays normative |

The projected manifest then passes through `registry.importManifest` — the
ONE validator — so a projection that would half-install fails typed, and
version-must-increase is preserved for same-id upgrades.

### Consent (D7/D19 — the display law)

The consent payload is built MAIN-side from the validated envelope: capabilities,
tier (`T0 — declarative data only`), provenance **verbatim**
(author/license/repository/description), the pinned sha256 digest, and the
charter's `t0DeclarativeDisclosure` **verbatim** (paraphrasing a disclosure
away is a conformance failure). Consent records persist per install
(what/when/what-digest + the acting confirmation — desktop is single-user).
Installs from sources land DISABLED (the charter's desktop default-off host
policy; the direct file-import keeps its historical behavior). Origin chips
follow D25: `bundled` (official — never rendered for imports), `imported`
(pinned ref + digest + provenance), `listed` (available-not-installed, shown
only while a source is configured).

### Updates (D15/D22 — no auto-apply path at all)

Update check rides every sync: ref move + digest change + manifest diff
(capabilities + configSchema are the byte-identical test fields). Digest drift
under the SAME pinned ref is a LOUD failure — pins untouched, the source
degrades, and the user verifies + re-consents explicitly. Capability growth or
a configSchema change re-consents (the browser-permission model). Since desktop
imports ONLY T0 data packs, a byte-identical-manifest data diff (version bump +
i18n tweaks) is the only auto-apply window — **there is no code auto-apply path
at all**. Park-on-removal rides the existing tombstone semantics: removing a
source parks its imports (disabled + flagged, data and consent history intact,
tombstone-able via the normal remove); bundled tombstones are untouched.

## Tier 2 — sandboxed code packs (ADR-0030, plan 32)

Imported packs whose content carries a code entry do not run in-process
(T0 declarative, T1 bundled): each one gets its own **sandboxed
`utilityProcess`** behind the family capability RPC
(`contracts/capability-rpc.md`, vendored byte-identically; the message
schema embeds verbatim via `scripts/sync-extension-artifacts.mjs`).
Tier is provenance at install time — bundled ⇒ T1, sources-pipeline
import carrying `code` ⇒ T2, everything else ⇒ T0 — never manifest
data. **Containment is not trust**: the sandbox limits blast radius, it
does not review intent; consent says so verbatim.

### Sandbox spine (S1)

- `src/main/resources/sandbox-child.cjs` — the child bootstrap, spawned
  by path with a scrubbed environment (`PATH` + `HOME`→sandbox workdir)
  and cwd inside the pack's sandbox dir. Stdlib only, zero app imports.
  It **re-derives both digests before any pack byte runs** (the manifest
  object digest = the registry's pin algorithm; a tree digest over the
  installed content, career's `rglob` algorithm: sorted rel paths +
  NUL + size + NUL + bytes, `.git`/symlinks skipped) and refuses to run
  on drift (exit 2 ⇒ `digest-drift`).
- **Frozen module surface** (ADR-0030 clause 2): pack code runs in a
  fresh `vm` context whose only non-standard globals are `capability`
  (the RPC client) and `SandboxError`. There is no `require`, no
  `process`, no `fetch`, no `WebSocket`, no timers, no dynamic import;
  the client is built INSIDE the context with the host primitives
  passed as closure parameters, so no host function object is reachable
  from pack code (the `.constructor.constructor` escape dies). The
  entry file budgets at 256 KiB / 2 MiB content total.
- **Watchdogs** (clause 2): wall-clock per `ext.invoke`/capability call
  (default 30 s, `config.miniApps.sandbox.callTimeoutMs`), spawn and
  dispose deadlines, and a per-process memory cap
  (`--max-old-space-size`, `memoryMb`). One `MiniAppSandboxRun` row per
  spawn; `MiniAppSandboxCall` = one audit row per capability call (S2);
  boot reconciliation closes open rows as `interrupted` — host death is
  never pack failure.
- **Death = pack failure, never app failure**: crash, watchdog kill,
  protocol recycle (3 frame violations), or identity/digest refusal ⇒
  the pack self-disables with the surfaced reason
  (`sandbox: …`, `MiniAppView.error`) and stays disabled until
  re-import (consent is the re-arm act). The per-pack kill switch
  (`setEnabled false`, remove, master-off, app quit) kills the live
  sandbox and a waiting invoke reports `canceled` — never a
  self-disable. Concurrent live sandboxes cap (default 4, `maxConcurrent`);
  over the cap answers typed `budget`, never a queue.
- Transport note: Electron `utilityProcess` cannot pipe stdin, so
  frames ride the **host-provided parentPort pipe** — the protocol's
  sanctioned alternative to stdio; the vitest suite runs the same child
  over REAL stdio pipes (`node_modules/.tmp` content dirs), so the
  process boundary is never mocked in tests.

## Settings surfaces — the family integrations kit (plan 33 Phase C, ADR-0040 D25)

The mini-apps settings view renders through `@neuronection/assistant-ui`'s
integrations kit (plan 33; career is the Phase-B reference adoption): pack
cards are `IntegrationCard`, the pack config auto-form is
`IntegrationConfigForm` (driven by the flattened `MiniAppConfigFieldView`s —
schema parsing stays main-side; the renderer only ever receives field
views), the sources block is `IntegrationSourcesList` +
`AddIntegrationSourceDialog` + `ConsentDialog`, and installed-from-source
packs render as kit instance rows grouped under their source. An app-owned
`IntegrationInstancesList` card keeps installs whose source is gone visible
(parks survive source removal — D22). Desktop chrome — PackRuns,
QuarantineManager, OverridesManager, DiffModal, the import-from-file pack
picker, remove confirmations — stays app-owned and composes into the kit's
detail/action slots (`renderInstanceActions` carries the pin/consented
line, the split auto-apply vs re-consent update buttons, and restore).

The wire→kit mapping is pure and tested:
`src/renderer/settings-react/apps/integration-views.ts` maps pack cards,
config fields, sources/candidates/installs and consent payloads onto the
kit's `integration-contracts` view-models. Capability ids narrow through
the kit's generated vocabulary (unknown ids pass through); consent law
text maps verbatim; update states project onto the kit's
`available`/`digest-drift` views with `absent-from-source` carried in
instance metadata; the kit's `IntegrationSourceDraft` converts to the
validated-descriptor document renderer-side exactly as before (validated
main-side). Every kit label prop is fed from
`src/shared/constants/text.ts` — no hardcoded kit copy.

Dependency mechanism (the career plan-33 Phase-B precedent): the manifest
pins `^0.68.0` — the owner's pending Version-Packages wave
(surface-renderer + the kit, one run) — while local dev runs against the
kept library tarball (`npm install --no-save <assistant-ui>/neuronection-assistant-ui-<version>.tgz`,
uncommitted); the lockfile resolves from the registry once the wave
publishes. Kit components are never forked or patched: additive-only
props (plan-33 §2.5) — gaps go back to the library.

## ui:window — the host-owned window surface (plan 32 Phase 4)

`ui:window` (ADR-0040 clause 16) is a **declarative-surface-class
capability, tiers 0+1** — an imported Tier-0 pack may declare it; the
trusted-tier-only `ui:custom-code` contrast is deliberate. The window
renders the pack's **declared declarative surface** — today its run
report through the same `PackReportRenderer` path the in-app modal
hosts (`renderer/pack-window-react/`, the result-viewer window
precedent); the slot/contribution model is untouched — windows are not
new slots. The validator pins the host cross-reference: `ui:window`
requires `report` (there is nothing to render otherwise).

Host-enforced constraints (`src/main/apps/windows.ts`, the charter's
`hostEnforced` law):

- **Constrained window**: no `nodeIntegration`, `contextIsolation` on,
  sandboxed in production (the shared `getWebPreferences` profile — the
  same one every app window uses), `window.open` denied, navigation
  locked to the app origin, family tokens/theme through the same
  styling path as in-app surfaces (app theme via `loadConfig`), and the
  axe a11y bar (`tests/a11y-pack-window.test.tsx`).
- **No new markup path**: the window hosts the closed component
  vocabulary only — raw HTML/JS from a pack never renders at any tier
  (defense-in-depth behind manifest validation; the renderer filters
  unknown node types and action ids at the render seam).
- **Per-pack cap of 1**: a second open focuses the live window instead
  of creating one (`opened: false` in the result).
- **Kill semantics**: the window closes automatically on pack disable,
  pack removal (tombstone), master kill switch, and app shutdown
  (`before-quit`); boot reconciliation destroys anything that slipped
  through — no orphaned windows.
- **Auditable**: one `MiniAppWindow` row per window lifetime (open +
  close reason: `user · load-failed · pack-disabled · pack-removed ·
  kill-switch · app-shutdown · boot-reconcile`), the pack-stack rows
  convention (proposals persist, runs persist).
- **Degrade rule** (charter `surfaces.degradeRules`): a host may
  decline `ui:window` ⇒ degrade to page/panel — desktop *honors*
  window hosting (the Electron reference host); the rules are data in
  `MINIAPP_WINDOW_DEGRADE_RULES`, never code branches.

Renderer parity with the family is proven by the **shared fixture
suite** (`contracts/surface-renderer.fixtures.json` — all 12 cases incl.
the degrade probes run through desktop's renderer core in
`tests/app-pack-surface-parity.test.tsx`): implementations may differ
from assistant-ui's `SurfaceRenderer`, outputs may not (D23). The
affordance is the report modal's **Open in window** button (shown when
the pack declares the capability).

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
- `runner/runner.ts` — scan → classify → decide → compose with per-item  checkpointing, the fingerprint cache (`sha256(root|path|size|mtime[|excerpt])`),
  budget pre-flight (estimate = residual count, emitted before any model
  call), resumable budget/rate-limit exhaustion (`paused`), provider
  failure failing the run (resumable), cooperative cancellation between
  items, and `readContext` excerpts (capped, privacy-gated, hashed into
  the fingerprint). The decide loop runs a bounded concurrency window
  (min shared funnel slots × 4, plan 28) with an order-preserving drain:
  item rows, totals and progress events are byte-identical to the old
  sequential loop; budget reservations happen at ask time so the cap
  never over-commits; cancellation stops launches and persists in-flight
  verdicts.
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
- The run card is **reachable from the conversation** (plan 27 S1): the
  desktop transcript renders a **View report** chip on every assistant
  message carrying `miniAppRun` metadata (live-run cards included — the
  card is persisted from the start), opening `RunReportModal` in-window.
  The chat session reloads the active conversation on terminal
  `run:finished|failed|canceled` broadcasts, so the settled card appears
  without a manual refresh (the settle itself is a DB write, never a
  turn event — `TurnEvent` carries no `miniAppRun`).
- Starting a run **opens the desktop window on the run's conversation**:
  the palette and typed-slash execution paths both consume the command
  outcome's `conversationId` — the starting window selects the
  conversation (through the manager, so the transcript actually
  switches) and `desktop:open {conversationId}` shows the desktop
  window on it (`session-sync` drives the selection). Runs started from
  the Settings runs list keep their existing behavior (live progress is
  right there).
- **The run card renders as a live card** (plan 28 S2): messages
  carrying `miniAppRun` metadata render the host-owned
  `MiniAppRunCard` in both transcripts instead of the raw markdown —
  pack title, status badge (live region while in flight), decide-phase
  progress bar from the `run:progress`/`run:items` overlay, stat tiles
  from the persisted totals (settled truth), cost line, and the
  View-report action (desktop: in-window modal; launcher: deep-links
  into the settings runs area — plan 27 S2). Node content follows the
  pack's `liveCard` declaration via `miniapps:live-card` (host-resolved,
  cached per pack) with `DEFAULT_LIVE_CARD` as the fallback; the card
  markdown is now a fallback for non-renderer surfaces only and no
  longer leaks the run id.
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
  `renderer/shared` — window-agnostic by design, hosted by the Settings
  runs list and the desktop transcript's View-report chip alike): host-rendered closed vocabulary driven by the
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

- `src/packs/file-deletion-review/pack.json` — the user's original
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
