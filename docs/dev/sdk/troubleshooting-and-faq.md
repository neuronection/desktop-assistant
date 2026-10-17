# Developer diagnostics

Testing and debugging packs: the author-time loop, the validator corpus
pattern, stubbed and full-stack runs, where the truth lives on disk, and
the failure table. The user-side symptom walkthrough is
[mini-apps troubleshooting](../../user/mini-apps-troubleshooting.md);
every failure mode the repo's own suites test has a row here or there.

## Testing your pack

1. **CLI**: `npm run app-pack -- validate <file>` — path-precise
   author-time errors; exit 1 on failure (CI-able).
2. **Validator corpus** (repo pattern:
   `tests/app-pack-validate.test.ts`): load your manifest, mutate one
   field per case, assert the typed issue — the fastest way to pin schema
   behavior.
3. **Runs without a model** (`tests/app-pack-runner.test.ts`): the runner
   accepts a stubbed decide seam; classify/compose/order semantics run
   entirely offline.
4. **Real trees**: build fixtures under `node_modules/.tmp` (⚠ system
   `/tmp` is a **refused run root** by contract) with backdated mtimes
   (`utimesSync`) — fixed dates are time bombs.
5. **Full stack**: wire the real `PackDecideBridge` with a scripted model
   + `setAuditSink` and assert **AiCall row counts** — the framework's own
   proof for budget-stop, resume and cache-hit behavior.
6. **Bundled packs**: drop the manifest in `src/packs/<id>/`, register it
   — CI auto-validates every manifest in the directory and fails if a
   directory is unregistered.
7. **Sandboxed packs**: the reference fixture
   (`tests/fixtures/sandbox/reference-pack/`) installs through the REAL
   pipeline in `tests/app-pack-sandbox*.test.ts` — copy it, then keep your
   variant in a fixture dir with its own suite.

## Debugging

- **Self-disable reasons**: Settings → Apps → Mini-apps shows the
  path-precise validation error on the pack card. `MiniAppView.error` is
  the wire field.
- **Run state**: the Runs list (status, estimate/actual calls, tokens,
  pending counts) and the run's conversation card; live progress rides the
  `run:*` event stream (`miniapps:run-event`).
- **DB rows**: `MiniAppRun`, `MiniAppRunItem`, `MiniAppFeedback`,
  `MiniAppProposal`, `MiniAppQuarantine` in
  `<userData>/conversations.db` (SQLite) — e.g. `sqlite3 … 'select
  relPath, verdict, decidedBy from MiniAppRunItem where runId="…"'`. The
  sandbox adds `MiniAppSandboxRun`/`MiniAppSandboxCall`/
  `MiniAppSandboxState`; windows add `MiniAppWindow`.
- **Quarantine**:
  `<userData>/mini-apps/<pack>/quarantine/<runId>/` — mirrored layout +
  `manifest.json` (origins, fingerprints, timestamps). Restore from the
  report or by run batch.
- **Logs**: main-process console (`npm run dev`); engine calls are audited
  per task in `AiCall` — filter by the run's time window. Sandbox
  lifecycle logs carry the `sandbox: ` reason prefix on death.
- **Model wire**: `DA_AI_DEBUG=1 npm run dev` logs each agent model call
  start/end (not pack decide calls — those surface via the audit rows and
  run events).

## Failure table (dev-facing)

| Symptom | Cause | Fix |
|---|---|---|
| `INVALID — … $.<path>: <message> [<code>]` | the validator's path-precise rejection | fix the named path; unknown-field rejections mean exactly that — remove the field, don't rename it |
| Pack card "Disabled — reason" after app change | boot revalidation failed: vocabulary the host no longer knows, apiVersion outside the 2-major window, digest mismatch, or (source packs) mapping-seam self-disable (unhonored capability/kind/surface, `required`/`x-secret` in configSchema) | read the reason verbatim; re-import a fixed, higher-version pack |
| Import refused: version must raise | same id installed at ≥ version | bump `version` (semver) |
| `path-denied` at run start | refused run root (`/`, `$HOME`, `/tmp`, `/var`, `/mnt`, drive roots, symlink escape…) | run on a real subfolder |
| Stale-run resume rejected | pack version, config or engine changed since the run (cache key invalid) | start a new run — deliberate, not a bug |
| Run `paused` with `rate-limited`/`budget` | limiter engaged / budget exhausted | resume later; decided items are cached and never re-paid |
| Fresh run over unchanged tree makes model calls | fingerprint cache miss — config/engine changed, or excerpts gated by `readContextWhen` flipped | expected on config change; check the run's config hash |
| Sandbox died, pack disabled with `sandbox: …` | crash, watchdog kill, protocol recycle (3 violations), identity/digest refusal — death is pack failure, never app failure | fix the pack code; re-import (consent is the re-arm) |
| Sandbox invoke answers `budget` | per-invoke call cap, calls/minute ring, bytes/day bucket, or the concurrent-sandbox cap (default 4) | wait/retune `config.miniApps.sandbox` knobs; author handlers to end cleanly on typed errors |
| `miniapps:command-execute` refused | pack unknown/disabled, command id not in the installed manifest's `contributions.commands`, or the id is not namespaced for a sandboxed pack | check the manifest declares the command; namespaced ids only for T2 |
| Window "opens" but focuses the existing one | per-pack window cap is 1 (`opened: false`) | by design |
| Test tree vanishes / roots refused | fixtures under system `/tmp` | build under `node_modules/.tmp` |

## FAQ

**Is a pack that passes the JSON Schema "valid"?** No — the generated
schema is a structural pre-check; cross-references, i18n completeness,
privacy lint and the host-sensitive baseline are validator-owned. The CLI
and the runtime run the full validator.

**Can a pack see other packs' data?** No. Runs are per-pack isolated (one
pack can never address another's run); sandbox state is per-pack with its
own quota; capability calls are namespaced to the calling pack.

**Can a pack name a model or provider?** No — packs declare `decision`
/`llm` capabilities; the host resolves the assigned decision model through
the funnel. No provider, model or SDK name ever crosses the decide bridge.

**Does disabling a pack delete its data?** No — disable only switches it
off (runs, config, quarantine, consent history stay). Removal tombstones
bundled packs stickily (`restore-bundled`); source installs park on source
removal with everything intact.

**Why did my sandbox pack stop after a config change?** `needs-secret` /
`not-ready` / `budget` retry as `after-config-change` — the typed error
names the remedy; the pack itself stays installed and enabled.

**Where do I report contract gaps?** The contract lives in the family dev
repo; amendments are append-only and land through the sync
(`scripts/sync-app-pack-contract.mjs` / `sync-extension-contract.sh`) with
tests — file it there, not as a local fork.
