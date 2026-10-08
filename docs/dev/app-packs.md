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

src/main/apps/registry.ts   MiniAppRegistry — install/enable/disable/remove,
                            digest + origin, apiVersion negotiation, boot
                            self-disable (the AppService pattern), config
                            persistence via config.miniApps

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

S0 complete (ADR-0029 accepted 2026-10-08). S1 (this page) complete:
contract tooling, SDK, registry, settings surface, CLI, sample fixture.
S2+ (capability layer, runner/RunService, history/reporting, arm +
quarantine, the `file-deletion-review` reference pack) land stage by
stage; until S3 there is **no runtime execution** of pipelines — the
registry only validates, stores and surfaces packs.
