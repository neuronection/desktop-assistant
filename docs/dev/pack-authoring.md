# Pack authoring guide

How to build a mini-app pack for Desktop Assistant: what a pack can
declare, how the host executes it, and how to test and debug one. The
normative contract is
[`contracts/mini-app-packs.json`](../../contracts/mini-app-packs.json)
(family canonical:
[dev/contracts](https://github.com/neuronection/dev)) — this guide
explains it with examples. Architecture internals live in
[app-packs.md](app-packs.md).

- [What a pack is](#what-a-pack-is)
- [Quickstart](#quickstart)
- [Manifest reference](#manifest-reference)
- [Capabilities](#capabilities)
- [Config schema](#config-schema)
- [Privacy](#privacy)
- [i18n](#i18n)
- [The pipeline](#the-pipeline)
  - [scan](#scan)
  - [classify](#classify)
  - [decide](#decide)
  - [compose](#compose)
  - [propose](#propose)
- [Conditions](#conditions)
- [Report schema](#report-schema)
- [Live card schema](#live-card-schema)
- [Actions](#actions)
- [Runs, verdicts and the cache](#runs-verdicts-and-the-cache)
- [Typed errors](#typed-errors)
- [Limits](#limits)
- [Worked examples](#worked-examples)
- [Code packs (bundled surfaces)](#code-packs-bundled-surfaces)
- [How it works](#how-it-works)
- [Testing your pack](#testing-your-pack)
- [Debugging](#debugging)

## What a pack is

A pack is a **manifest** — validated data — that the host installs,
configures and executes. Two kinds:

| Kind | What it is | Example |
|---|---|---|
| `assessment` | A pipeline over a folder: `scan → classify → decide → compose → propose?`, producing evidence-backed verdicts and (optionally) a quarantine proposal | `file-deletion-review` |
| `surface` | A launcher input mode + commands, contributed by bundled code (Tier 1) | `mini-calc`, `mini-translate` |

Three trust tiers (ADR-0029 clause 10):

- **Tier 0 — imported data packs.** What this guide is mostly about. A
  single JSON file. No code executes, ever. `net` is denied. Anyone can
  author one.
- **Tier 1 — bundled code packs.** Code shipped with the app
  (`src/packs/<id>/`), reviewed like app code. Surfaces and executors
  live here.
- **Tier 2 — imported code packs.** Deferred by design (isolated
  process + RPC shim). `ui`, `ui:custom-code`, `contributions` and
  `code` in an imported manifest are **rejected**.

The host — never the pack — owns every dangerous power: filesystem
confinement, model access, runs, approvals, deletion. A pack cannot
escape its root, call the network, name a provider/model, or delete
anything permanently.

## Quickstart

```bash
npm run app-pack -- init my-pack --id my-first-pack   # scaffolds mini-app-pack.json
$EDITOR mini-app-pack.json
npm run app-pack -- validate mini-app-pack.json       # iterate until OK
```

Then Settings → Apps → Mini-apps → **Import pack…** and pick the file.
Invalid imports are rejected with path-precise reasons; nothing
installs half-way.

## Manifest reference

```jsonc
{
  "apiVersion": 1,                  // integer; > host = self-disable "requires host ≥ N"
  "id": "my-pack",                  // ^[a-z][a-z0-9-]{2,39}$, unique per install
  "version": "1.0.0",               // semver; re-import over same id must RAISE it
  "kind": "assessment",             // or "surface"
  "description": "...",             // optional ≤400 chars (i18n key "description")
  "icon": "data:image/png;base64,…",// optional inline png/jpeg/webp ≤64 KiB (SVG rejected)
  "capabilities": [...],            // see below
  "configSchema": {...},            // JSON-Schema subset; settings auto-form
  "defaults": {...},                // initial config values (must satisfy the schema)
  "runParams": {...},               // per-run inputs schema (advanced)
  "privacy": {...},                 // required for assessment
  "run": {...},                     // pipeline (assessment only)
  "report": {...},                  // report schema (with `report` capability)
  "liveCard": {...},                // optional live run-card schema (assessment; default card otherwise)
  "i18n": {...},                    // required labels
  "contributions": {...},           // Tier 1 only — rejected in imports
  "code": { "entry": "..." }        // Tier 1 only — rejected in imports
}
```

Unknown **any** field anywhere self-disables the pack at install/boot
with a path-precise reason — packs never half-run.

## Capabilities

| Capability | Grants | Notes |
|---|---|---|
| `fs-read` | File metadata inside the run root; content excerpts only with `privacy.sendsContent` + `readContext` | required for `assessment` |
| `fs-write-quarantine` | The destructive verb: host-executed move-to-quarantine after your HITL approval | requires a `propose` step |
| `fs-write-mutate` | — | **reserved, apiVersion ≥ 2** (rename/move with undo journal); v1 rejects with a typed reason |
| `net` | — | **denied**; only the host's engine transport leaves the device |
| `decision` | Typed questions through the decision-engine registry (jev/llm/needle per the user's config); 1 audited `AiCall` per item | requires a `decide` step |
| `llm` | Gateway model I/O for synthesis | task-bound at call time; packs never name providers |
| `run` | Own-run lifecycle (start/progress/cancel) | required for `assessment` |
| `report` | Declarative report rendered by the host | |
| `propose` | HITL Class-B arming declarations | |
| `ui` / `ui:custom-code` | Slot contributions / custom surfaces | Tier 1 (bundled) only |

## Config schema

A restricted JSON Schema (draft 2020-12 subset) the Settings form
renders deterministically:

- types: `string`, `number`, `boolean`, array-of-`string` — only these
- keywords: `enum`, `default`, `minimum`, `maximum`, `minLength`,
  `maxLength`, `pattern`, `minItems`, `maxItems`, `title`,
  `description`; `additionalProperties: false`
- no `$ref`, no `allOf/anyOf/oneOf`, nesting depth ≤ 3, ≤ 64 properties
- `title`/`description` are **i18n key references** (`config.<name>`)

All user-tweakable behavior is config — thresholds, exception lists,
extensions, the read-context toggle — never a pack re-release. Config
values feed conditions as `config.<key>` signals, and the effective
config hash keys the verdict cache (change config → verdicts recompute).

## Privacy

```jsonc
"privacy": {
  "sendsContent": true,          // may file content ride questions? (readContext also required)
  "sensitiveGlobs": ["*.key"],   // never sent, never armed
  "contentCapBytes": 4096        // excerpt cap (≤ 8192)
}
```

The host unions your globs with its own baseline (`.env*`, `*secret*`,
`id_rsa*`, `*.kdbx`, …). File **names/paths/metadata are always part of
question framing** when `decide` runs — the run-start surface discloses
this split. A `decide` step reading content without
`sendsContent: true` fails validation (privacy-consistency lint).

## i18n

```jsonc
"i18n": {
  "defaultLocale": "en",
  "locales": {
    "en": { "title": "Deletion review", "rule.fresh": "Recently modified", ... }
  }
}
```

Every locale carries the **same key set** (validated). Required keys:

- `title`
- `rule.<id>` for every classify rule
- `config.<name>` for every config property (drives the settings form labels)
- `report.<id>` for every non-`actions` report node

Labels resolve through the host locale with `defaultLocale` fallback.
Question `instructions` are locale-free manifest data (they target the
engine; they render in the evidence drilldown as data).

## The pipeline

Assessment packs declare `run` with steps in fixed order. The host
executes: deterministic rules first, the model only on what rules
cannot decide, every verdict checkpointed with evidence.

### scan

```jsonc
"scan": {
  "includeHidden": false,
  "excludeGlobs": ["**/.git/**"],
  "fileCap": 20000,     // ≤ 100000
  "maxDepth": 32        // ≤ 64
}
```

Walk rules are host-enforced regardless of config: symlinks skipped,
mount points skipped (`st_dev` change), regular files only, every path
re-validated against the root.

### classify

Four ordered lists; **veto → keep → ask → candidate** decides, and
within a list the **first matching rule** is the evidence rule.

- `veto` / `keep` / `ask` matches **finalize** without the model.
- `candidate` matches are **provisional** — confirmed or demoted by
  `compose` after `decide`.
- Unmatched items are the residual → `decide`.

```jsonc
"classify": {
  "veto":      [{ "id": "exceptions", "when": { "signal": "meta.path", "op": "matches-any", "valueSignal": "config.exceptions" } }],
  "keep":      [{ "id": "fresh",     "when": { "signal": "meta.ageDays", "op": "lt", "valueSignal": "config.freshDays" } }],
  "ask":       [{ "id": "empty",     "when": { "signal": "meta.size", "op": "eq", "value": 0 } }],
  "candidate": [{ "id": "junk",      "when": { "signal": "meta.name", "op": "matches-any", "value": ["*.log", "*.tmp"] } }]
}
```

### decide

```jsonc
"decide": {
  "questions": [
    { "id": "safe", "type": "noul", "instructions": "Is this file safe to delete?", "criteria": { "true": "safe", "false": "keep" } },
    { "id": "recoverability", "type": "score", "instructions": "How recoverable if deleted?", "levels": ["irreplaceable", "regenerable"] },
    { "id": "category", "type": "choice", "instructions": "Which category?", "options": { "logs": null, "temp": null } }
  ],
  "readContext": true,
  "readContextWhen": { "signal": "config.readContext", "op": "eq", "value": true },
  "engine": "jev"   // optional preference; resolution stays host-owned
}
```

- One engine call per residual item carrying **all** questions.
- `readContext` is the hard allow for excerpts; `readContextWhen`
  (condition over config signals) gates it per run — the user's
  read-context knob without a re-release. Both required for content.
- Question types (the ADR-0019 neutral vocabulary):
  - `noul` — a number 0..1
  - `choice` — closed option set
  - `score` — ordinal levels

### compose

Runs on every model-decided item over rule + answer signals:

```jsonc
"compose": {
  "keepWhen":      { "all": [{ "signal": "answer.recoverability.value", "op": "gte", "value": 2 },
                             { "signal": "answer.recoverability.confidence", "op": "gte", "value": 0.9 }] },
  "candidateWhen": { "signal": "answer.safe.confidence", "op": "gte", "value": 0.8 }
}
```

Evaluation: `keepWhen → candidateWhen → askWhen → default ask`
(**fail-closed** — unresolved signals read false, `ask` is never
silently promoted).

### propose

```jsonc
"propose": {
  "verb": "quarantine",
  "groupBy": "answer.category.choice",
  "gate": { "minConfidence": 0.8 }
}
```

The fail-closed gate (confidence ≥ threshold ∧ not on the exception /
sensitive lists) runs at **arm** time, and every item is
re-fingerprinted at **execution** time — a changed file drops to `ask`
and is never moved.

## Conditions

Shared grammar for classify rules, `compose`, `readContextWhen`:

```
condition = { all: [condition, ...] } | { any: [...] } | { not: condition }
          | { signal, op, value? | valueSignal? }
```

| op | meaning |
|---|---|
| `eq` / `ne` | equality (string, number, boolean) |
| `lt` `lte` `gt` `gte` | comparison |
| `in` | membership (literal array, or a config array via `valueSignal`) |
| `matches` | single glob |
| `matches-any` | glob list (literal array, or config array via `valueSignal`) |
| `exists` | signal resolves |

Signals: `meta.size`, `meta.ageDays`, `meta.ext`, `meta.name`,
`meta.path`, `rule.<id>` (true when matched, **unresolved** otherwise),
`config.<key>`, `answer.<id>.value | .confidence | .choice`.
`valueSignal` compares against another signal (config-driven
thresholds without scripts).

## Report schema

Closed component vocabulary; the host renders everything:

| Node | Fields |
|---|---|
| `stat` | `bind` (e.g. `totals.scanned`) |
| `badge` | `bind` (`run.status`) |
| `progress` | decided/scanned bar |
| `table` | `columns`: `path`, `verdict`, `confidence`, `decidedBy` |
| `cards` | `of`: `items` \| `groups` |
| `filter-bar` | verdict chips + search |
| `select` | `bind` + `options` |
| `actions` | closed typed action ids |
| `evidence` | the per-item drilldown — **mandatory** wherever recommendations render |

Every non-`actions` node needs an i18n `report.<id>` key.

## Live card schema

Optional `liveCard: { nodes }` (plan 28): which nodes the **live run
card** in the chat transcript shows while a run is in flight. Same
posture as the report — closed vocabulary, host-rendered, pack data is
untrusted input:

| Node | Fields |
|---|---|
| `badge` | `bind`: `run.status` (the one status surface) |
| `stat` | `bind`: a numeric path — `totals.scanned/keep/ask/candidate/pending`, `run.estimateCalls/actualCalls/inputTokens/outputTokens` |
| `progress` | `bind`: `progress` (host resolves done/total from run events + persisted totals) |

Every `stat` node needs an i18n `live.<id>` key (all locales). A pack
declaring no `liveCard` gets the SDK `DEFAULT_LIVE_CARD` (status,
progress, verdict tallies) — live cards are zero-config by default.
Limit: `liveCardComponentsMax` 16.

## Actions

Closed set — buttons emit typed ids, never scripts:- run: `run:cancel` `run:retry` `run:resume` `run:arm` `run:export` `run:diff`
- item: `item:exclude` `item:override` `item:restore` `item:reveal` `item:open`

`run:arm` requires a `propose` step + `fs-write-quarantine`.

## Runs, verdicts and the cache

- Verdicts: `keep` / `ask` / `candidate` (three classes; `ask` needs a
  human or a later override — the review queue captures those as
  `MiniAppFeedback`, applied by later runs **over** rules and model).
- Each run: a real conversation in history with a live progress card
  that settles into a persistent result summary (calls, tokens, totals).
- Run statuses: `queued running paused done failed canceled interrupted`
  (boot reconciles orphans to `interrupted`).
- Verdict cache key: `(rootId, fingerprint, packVersion, configHash,
  engineId)` where fingerprint = `sha256(root|path|size|mtime[|excerpt])`.
  Resume and re-runs never re-pay decided items — proven by `AiCall`
  audit-row counts in the framework's own tests.
- Budget: calls estimated before the run ("≈ N model calls" at start,
  actuals + tokens on the result card); exhaustion pauses cleanly —
  "N items pending, resume?".
- Concurrency: runs share the decision funnel's limiter and **yield to
  interactive chat/voice**.

## Typed errors

Every capability call fails with `{ code, detail }`:

| code | meaning |
|---|---|
| `not-ready` | engine/task unassigned, pack disabled |
| `needs-secret` | keyring key absent (e.g. the Jev key) |
| `budget` | run budget exhausted (resumable) |
| `rate-limited` | limiter engaged (`retryAfterMs` in detail) |
| `path-denied` | outside root / traversal / symlink / mount / refused root |
| `canceled` | user cancel / abort |
| `provider` | upstream model failure |
| `io` | OS fs error on an allowed path |
| `not-found` | unknown run/item; post-retention artifact |
| `invalid` | malformed request at the boundary |

## Limits

`manifestMaxBytes` 524288 · `localesMax` 16 · `i18nKeysPerLocaleMax`
400 · `i18nValueMaxChars` 400 · `questionsPerPackMax` 24 ·
`classifyRulesMax` 256 · `reportComponentsMax` 96 ·
`liveCardComponentsMax` 16 ·
`configPropertiesMax` 64 · `contentExcerptMaxBytes` 8192 ·
`scanFileCapDefault`/`Hard` 20000/100000 · `scanDepthDefault`/`Hard`
16/64 · `evidenceJsonMaxBytes` 16384 · `iconMaxBytes` 65536 ·
`runsRetainedPerPack` 50 · quarantine retention 30 days.

## Worked examples

**The reference pack** —
[`src/packs/file-deletion-review/pack.json`](../../src/packs/file-deletion-review/pack.json)
— exercises everything: veto/keep/ask/candidate rules, three question
types, `readContextWhen`, compose bands, category grouping, the
quarantine gate, i18n labels, a five-node report. Copy it as a starting
point.

**A minimal report-only assessment** (repo-health style):

```jsonc
{
  "apiVersion": 1, "id": "repo-health", "version": "0.1.0", "kind": "assessment",
  "capabilities": ["fs-read", "run", "report"],
  "privacy": { "sendsContent": false, "sensitiveGlobs": [] },
  "run": {
    "scan": { "excludeGlobs": ["**/.git/**"] },
    "classify": {
      "keep": [{ "id": "has-readme", "when": { "signal": "meta.path", "op": "matches", "value": "README*" } }],
      "ask":  [{ "id": "no-tests",   "when": { "signal": "meta.path", "op": "matches-any", "value": ["test/*", "tests/*"] } }]
    },
    "compose": {}
  },
  "report": { "nodes": [
    { "id": "scanned", "type": "stat", "bind": "totals.scanned" },
    { "id": "items", "type": "table", "columns": ["path", "verdict"] },
    { "id": "ev", "type": "evidence" }
  ]},
  "i18n": { "defaultLocale": "en", "locales": { "en": {
    "title": "Repo health",
    "rule.has-readme": "Has a README", "rule.no-tests": "Test directory item",
    "report.scanned": "Files scanned", "report.items": "Items", "report.ev": "Evidence"
  }}}
}
```

No `decide`, no `propose` — rules finalize everything; unmatched items
land in `ask` with the review queue.

## Code packs (bundled surfaces)

First-party surfaces (`mini-calc`, `mini-translate`) are Tier 1: one
directory under `src/packs/<id>/` — `pack.ts` (manifest, SDK builders),
optional pure logic (`evaluate.ts`), and `renderer.ts` (the renderer
binding: mode chrome config, `match` mapping, `useLive` behavior hook,
optional `applyOpenOptions`). Register in `index.ts` (main) +
`renderer.ts` (renderer root). See
[`src/packs/README.md`](../../src/packs/README.md).

## How it works

```
manifest ──validate──► registry (install / digest / self-disable)
                             │  config.miniApps (+ removedBundled tombstones)
                             ▼
        run start ──► capabilities (fs root validation · decide bridge · run bridge)
                             ▼
        runner: scan → classify → decide → compose   (per-item checkpoints)
                             │  MiniAppRun / MiniAppRunItem (fingerprint cache)
                             ▼
        RunService: budget · pause/resume · boot reconcile · run:* events
                             ▼
        report renderer (closed vocabulary + evidence) ── review queue (feedback)
                             ▼
        propose (fail-closed gate) ──► Class-B approval ──► quarantine (undo/restore)
```

- Renderer↔main only via the preload bridge (`miniapps:*` IPC); the
  renderer renders `run:*` events, never orchestrates.
- Model access only through the decision funnel — every call an
  audited `AiCall` row, budgets enforced, interactive traffic first.
- Deletion is **move-to-quarantine** under
  `<userData>/mini-apps/<pack>/quarantine/<run>/` with a per-batch
  `manifest.json`; restore never overwrites; the only purge is the
  user-armed "empty quarantine".

## Validating in other languages

The pack contract ships a **generated JSON Schema** (draft 2020-12):
`contracts/mini-app-packs.manifest.schema.json` (family canonical in
`dev/contracts/`, regenerated by `sync-app-pack-contract.mjs --schema`
and drift-gated in CI). It is a **structural gate** — vocabularies,
patterns, required fields, size limits and the imported-vs-bundled
variant (`$defs.bundledManifest`). A pack passing the schema is NOT
"valid": cross-references, i18n completeness, privacy lint and the
host-sensitive baseline are validator-owned and listed in the schema's
`$comment` block — port those rules per host. Desktop runs the same
schema as a cheap pre-check on imports (`schemaCheck.ts` over the
generated module) before its full validator, which stays normative.

## Testing your pack

1. **CLI**: `npm run app-pack -- validate <file>` — path-precise
   author-time errors; exit 1 on failure (CI-able).
2. **Validator corpus** (repo pattern:
   `tests/app-pack-validate.test.ts`): load your manifest, mutate one
   field per case, assert the typed issue — the fastest way to pin
   schema behavior.
3. **Runs without a model** (`tests/app-pack-runner.test.ts`): the
   runner accepts a stubbed decide seam; classify/compose/order
   semantics run entirely offline.
4. **Real trees**: build fixtures under `node_modules/.tmp` (⚠ system
   `/tmp` is a **refused run root** by contract) with backdated mtimes
   (`utimesSync`).
5. **Full stack**: wire the real `PackDecideBridge` with a scripted
   model + `setAuditSink` and assert **AiCall row counts** — the
   framework's own proof for budget-stop, resume and cache-hit
   behavior.
6. **Bundled packs**: drop the manifest in `src/packs/<id>/`, register
   it — CI auto-validates every manifest in the directory and fails if
   a directory is unregistered.

## Debugging

- **Self-disable reasons**: Settings → Apps → Mini-apps shows the
  path-precise validation error on the pack card.
- **Run state**: the Runs list (status, estimate/actual calls, tokens,
  pending counts) and the run's conversation card; live progress rides
  the `run:*` event stream.
- **DB rows**: `MiniAppRun`, `MiniAppRunItem`, `MiniAppFeedback`,
  `MiniAppProposal`, `MiniAppQuarantine` in `<userData>/conversations.db`
  (SQLite) — e.g. `sqlite3 ... 'select relPath, verdict, decidedBy from
  MiniAppRunItem where runId="…"'`.
- **Quarantine**: `<userData>/mini-apps/<pack>/quarantine/<runId>/` —
  mirrored layout + `manifest.json` (origins, fingerprints, timestamps).
  Restore from the report or by run batch.
- **Logs**: main-process console (`npm run dev`); engine calls are
  audited per task in `AiCall` — filter by the run's time window.
- **Model wire**: `DA_AI_DEBUG=1 npm run dev` logs each agent model
  call start/end (not pack decide calls — those surface via the audit
  rows and run events).
- **Common failures**: refused roots (`/`, home, `/tmp`, `/var`,
  `/mnt`, drive roots, symlinks escaping), stale-run resume rejected
  (pack version/config/engine changed → start a new run), `rate-limited`
  pauses (resume later), budget `paused` (resume continues exactly
  where it stopped — decided items are cached).
