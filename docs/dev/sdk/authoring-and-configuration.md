# Authoring & Configuration

The manifest reference: every field a pack can declare, what the host does
with it, and the rules the validator enforces. The normative source is
[`contracts/mini-app-packs.json`](https://github.com/neuronection/desktop-assistant/blob/main/contracts/mini-app-packs.json);
this page explains it with examples (verified against the validator). For
complete worked packs, see [Examples & Use Cases](examples-and-use-cases.md).

## Manifest reference

```jsonc
{
  "apiVersion": 1,                   // integer; > host = self-disable "requires host ≥ N"
  "id": "my-pack",                   // ^[a-z][a-z0-9-]{2,39}$, unique per install; host-/neuro- reserved
  "version": "1.0.0",                // semver; re-import over same id must RAISE it
  "kind": "assessment",              // or "surface"
  "title": "…",                      // optional plain title (i18n `title` remains the label source)
  "description": "...",              // optional ≤400 chars (i18n key "description")
  "author": "Neuronection",          // optional envelope-shared provenance ≤120 chars — rendered verbatim (D25)
  "license": "Apache-2.0",           // optional envelope-shared provenance ≤120 chars — SPDX preferred
  "repository": "https://…",         // optional envelope-shared provenance — https-only git URL ≤512 chars
  "categories": ["files"],           // optional closed browse vocabulary (≤3, unique): files, data, search,
                                     //   productivity, utilities, developer, home, learning (charter mirror)
  "docs": "docs/docs-tree.json",     // optional FIXED pointer: when present, that tree must exist beside the
                                     //   manifest and validate (import/bundled gates) — plan 34 §10.3
  "icon": "data:image/png;base64,…", // optional inline png/jpeg/webp ≤64 KiB (SVG rejected)
  "capabilities": [...],             // see below
  "secrets": [{ "id": "api-token" }],// sandboxed T2 only: declared keyring slots (status-only resolution)
  "configSchema": {...},             // JSON-Schema subset; settings auto-form
  "defaults": {...},                 // initial config values (must satisfy the schema)
  "runParams": {...},                // per-run inputs schema (advanced)
  "privacy": {...},                  // required for assessment
  "run": {...},                      // pipeline (assessment only)
  "report": {...},                   // report schema (with `report` capability)
  "liveCard": {...},                 // optional live run-card schema (assessment; default card otherwise)
  "i18n": {...},                     // required labels
  "contributions": {...},            // Tier 1 + sandboxed Tier 2 only — rejected in plain imports
  "code": { "entry": "..." }         // Tier 1 (bundled) + Tier 2 (sandboxed) only — rejected in plain imports
}
```

Unknown **any** field anywhere self-disables the pack at install/boot with a
path-precise reason — packs never half-run.

### The envelope-shared fields (D25 metadata + the docs pointer)

The five optional fields above are the family envelope's display
metadata, adopted into the mini-app kind (append-only within
apiVersion 1 — older hosts ignore them, older packs simply omit them):

- `author` / `license` / `repository` — provenance, **rendered
  verbatim** on settings cards, consent dialogs and the family
  brochure surfaces. Never paraphrased, never localized.
- `categories` — the closed browse vocabulary mirrored from the
  charter (see the comment above); browse UIs group by it.
- `docs` — the per-extension documentation binding (plan 34 §10.3):
  the one fixed value `docs/docs-tree.json`. When present, the
  referenced tree must exist **beside the manifest** (a `docs/`
  directory at the bundle root) and validate against the vendored
  docs-tree schema's `extensionDocsTree` form — the import pipeline
  and the bundled-pack CI gate both enforce it; a broken promise
  rejects the bundle exactly like an invalid manifest. Markdown
  pages beside the tree, closed seven-slug categories, docs
  versioning rides the manifest `version` (never separate). The
  bundled packs (`src/packs/*/docs/`) are in-repo reference
  instances.

## Capabilities

| Capability | Grants | Tier | Notes |
|---|---|---|---|
| `fs-read` | File metadata inside the run root; content excerpts only with `privacy.sendsContent` + `readContext` | 0–1 | required for `assessment` |
| `fs-write-quarantine` | The destructive verb: host-executed move-to-quarantine after your HITL approval | 0–1 | requires a `propose` step |
| `fs-write-mutate` | — | reserved | apiVersion ≥ 2 (rename/move with undo journal); v1 rejects with a typed reason |
| `net` | — | denied | only the host's engine transport leaves the device |
| `decision` | Typed questions through the shared decision funnel (the assigned decision model); 1 audited `AiCall` per item | 0–1 | requires a `decide` step |
| `llm` | Gateway model I/O for synthesis | 0–1 | task-bound at call time; packs never name providers |
| `run` | Own-run lifecycle (start/progress/cancel) | 0–1 | required for `assessment` |
| `report` | Declarative report rendered by the host | 0–1 | |
| `propose` | HITL Class-B arming declarations | 0–1 | |
| `ui:page` / `ui:panel` | Declarative surfaces over the closed component vocabulary | 0–1 | family vocabulary; desktop hosts no per-surface rendering for imports — the mapping seam self-disables these for now |
| `ui:window` | The pack's report opens in a host-owned window (one per pack) | 0–1 | requires `report` (there is nothing to render otherwise) |
| `ui` / `ui:custom-code` | Slot contributions / custom surfaces | 1 (bundled) | `ui` also granted to sandboxed T2 via `contributions` (logic in the sandbox, rendering host-side) |

Risk classes, in one line each: filesystem capabilities touch user data
(read is metadata+excerpts, quarantine is the only write path and it is
approval-gated + reversible); `decision`/`llm` spend model calls (audited,
budgeted); `report`/`ui:*` are rendering-only; `net`/`fs-write-mutate` are
the contract-level denials of v1.

## Config schema

A restricted JSON Schema (draft 2020-12 subset) the Settings form renders
deterministically:

- types: `string`, `number`, `boolean`, array-of-`string` — only these
- keywords: `enum`, `default`, `minimum`, `maximum`, `minLength`,
  `maxLength`, `pattern`, `minItems`, `maxItems`, `title`, `description`;
  `additionalProperties: false`
- no `$ref`, no `allOf/anyOf/oneOf`, nesting depth ≤ 3, ≤ 64 properties
- `title`/`description` are **i18n key references** (`config.<name>`)
- `pattern` must be **timeout-safe**: the import validator refuses
  patterns where a quantifier iterating more than once applies to a
  group that already contains one (`(a+)+$` — the catastrophic
  backtracking class), backreferences, quantifiers inside lookarounds,
  and counted repetitions above 1000 or nested past a 100 000 product
  (`src/shared/app-pack/safePattern.ts` is the normative guard). The
  bounded wrapper `(...)+?`/`(...)?` shape stays accepted; validated
  values are additionally capped at 256 chars per pattern check.

All user-tweakable behavior is config — thresholds, exception lists,
extensions, the read-context toggle — never a pack re-release. Config values
feed conditions as `config.<key>` signals, and the effective config hash
keys the verdict cache (change config → verdicts recompute). Saved values
are validated against the schema on save; a pack can never receive
arbitrary configuration.

**`x-secret` is not pack vocabulary.** The family envelope can express
sealed secret slots; desktop's pack-config store deliberately cannot (it is
not a secret store, D19). An imported envelope whose configSchema carries
`x-secret` (or a `required` list) self-disables with the re-author reason
— author defaults instead. Sandbox T2 packs declare secret *slots* on the
manifest (`secrets: [{ id }]`) resolved from the keyring at call time (see
[Security & Gotchas](security-and-gotchas.md)).

## Privacy

```jsonc
"privacy": {
  "sendsContent": true,          // may file content ride questions? (readContext also required)
  "sensitiveGlobs": ["*.key"],   // never sent, never armed
  "contentCapBytes": 4096        // excerpt cap (≤ 8192)
}
```

The host unions your globs with its own baseline (`.env*`, `*credential*`,
`*secret*`, `id_rsa*`, `*.kdbx`, `*.pem`, `*.key`, `*token*`) — the baseline
is enforced regardless of pack declaration. File **names/paths/metadata are
always part of question framing** when `decide` runs — the run-start surface
discloses this split. A `decide` step reading content without
`sendsContent: true` fails validation (privacy-consistency lint).

## i18n

```jsonc
"i18n": {
  "defaultLocale": "en",
  "locales": {
    "en": { "title": "Deletion review", "rule.fresh": "Recently modified" }
  }
}
```

Every locale carries the **same key set** (validated; ≤ 16 locales, ≤ 400
keys/locale, values ≤ 400 chars). Required keys:

- `title`
- `rule.<id>` for every classify rule
- `config.<name>` for every config property (drives the settings form labels)
- `report.<id>` for every non-`actions` report node
- `live.<id>` for every live-card `stat` node

Labels resolve through the host locale with `defaultLocale` fallback.
Question `instructions` are locale-free manifest data (they target the
engine; they render in the evidence drilldown as data).

## The pipeline

Assessment packs declare `run` with steps in fixed order. The host executes
deterministic rules first, the model only on what rules cannot decide,
every verdict checkpointed with evidence.

### scan

```jsonc
"scan": {
  "includeHidden": false,
  "excludeGlobs": ["**/.git/**"],
  "fileCap": 20000,     // ≤ 100000
  "maxDepth": 32        // ≤ 64
}
```

Walk rules are host-enforced regardless of config: symlinks skipped, mount
points skipped (`st_dev` change), regular files only, every path
re-validated against the root (no check-then-act window).

### classify

Four ordered lists; **veto → keep → ask → candidate** decides, and within a
list the **first matching rule** is the evidence rule.

- `veto` / `keep` / `ask` matches **finalize** without the model
  (veto/keep both land on `keep`).
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
  "readContextWhen": { "signal": "config.readContext", "op": "eq", "value": true }
}
```

- One engine call per residual item carrying **all** questions (≤ 24 per
  pack).
- `readContext` is the hard allow for excerpts; `readContextWhen` (a
  condition over config signals) gates it per run — the user's read-context
  knob without a re-release. Both required for content.
- Question types (the ADR-0019 neutral vocabulary): `noul` — a number
  0..1 · `choice` — a closed option set · `score` — ordinal levels.

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
(**fail-closed** — unresolved signals read false, `ask` is never silently
promoted).

### propose

```jsonc
"propose": {
  "verb": "quarantine",
  "groupBy": "answer.category.choice",
  "gate": { "minConfidence": 0.8 }
}
```

The fail-closed gate (confidence ≥ threshold ∧ not on the exception /
sensitive lists) runs at **arm** time, and every item is re-fingerprinted
at **execution** time — a changed file drops to `ask` and is never moved.

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

Signals: `meta.size`, `meta.ageDays`, `meta.ext`, `meta.name`, `meta.path`,
`rule.<id>` (true when matched, **unresolved** otherwise), `config.<key>`,
`answer.<id>.value | .confidence | .choice`. `valueSignal` compares against
another signal (config-driven thresholds without scripts). Unresolved
signals fail closed.

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
| `evidence` | the per-item drilldown — **mandatory** wherever recommendations render (the validator refuses a schema without it) |

Every non-`actions` node needs an i18n `report.<id>` key. With `ui:window`
declared, the report modal gains an **Open in window** button and the same
renderer hosts it in a constrained app window (one per pack — see
[Security & Gotchas](security-and-gotchas.md#uiwindow-the-host-owned-window)).

## Live card schema

Optional `liveCard: { nodes }`: which nodes the **live run card** in the
chat transcript shows while a run is in flight. Same posture as the report —
closed vocabulary (`badge`, `stat`, `progress`), host-rendered, pack data is
untrusted input:

| Node | `bind` |
|---|---|
| `badge` | `run.status` (the one status surface) |
| `stat` | a numeric path — `totals.scanned/keep/ask/candidate/pending`, `run.estimateCalls/actualCalls/inputTokens/outputTokens` |
| `progress` | `progress` (host resolves done/total from run events + persisted totals) |

Every `stat` node needs an i18n `live.<id>` key (all locales). A pack
declaring no `liveCard` gets the SDK `DEFAULT_LIVE_CARD` (status, progress,
verdict tallies) — live cards are zero-config by default. Limit:
`liveCardComponentsMax` 16.

## Actions

Closed set — buttons emit typed ids, never scripts:

- run: `run:cancel` `run:retry` `run:resume` `run:arm` `run:export` `run:diff`
- item: `item:exclude` `item:override` `item:restore` `item:reveal` `item:open`

`run:arm` requires a `propose` step + `fs-write-quarantine`.

## Contributions & slots (code packs)

Code packs — bundled Tier 1 and sandboxed Tier 2 — contribute through the
existing declarative slot vocabulary; logic runs in the executor (in-app
for T1, the sandbox for T2), rendering stays host-side, and the renderer
NEVER imports pack code:

- slots: `commands`, `input-mode`, `composer-toolbar`, `panel-header`,
  `card-actions`, `result-actions`, `status`, `settings-page`
- Tier 1: `src/packs/<id>/` — `manifest.json` (the pack manifest,
  authored as JSON or scaffolded by the CLI), optional pure logic,
  `renderer.ts` (the renderer binding);
  registered in `src/packs/index.ts` (main, with
  `SURFACE_COMMAND_BINDINGS`) + `src/packs/renderer.ts` (with
  `SURFACE_RENDERER_BINDINGS`). CI validates every manifest under
  `src/packs/` and fails on an unregistered directory.
- Tier 2: contribution descriptors cross the sandbox seam as data only; ids
  are **namespaced** (`<namespace>:<name>`, validator-enforced for sandboxed
  packs — reserved ops stay unreachable), and a declared command id maps to
  exactly ONE sandboxed invoke (`miniapps:command-execute`; palette entries
  ride `miniapp:cmd:<packId>:<commandId>`). Settings render from the pack's
  `configSchema` through the same settings form — no provider CRUD home.
  **New visual components from pack code: NO** (ADR-0030 clause 3).

## Validating in other languages

The pack contract ships a **generated JSON Schema** (draft 2020-12):
`contracts/mini-app-packs.manifest.schema.json` (family canonical in the
dev repo, regenerated by `sync-app-pack-contract.mjs --schema` and
drift-gated in CI). It is a **structural gate** — vocabularies, patterns,
required fields, size limits and the imported-vs-bundled variant
(`$defs.bundledManifest`). A pack passing the schema is NOT "valid":
cross-references, i18n completeness, privacy lint and the host-sensitive
baseline are validator-owned and listed in the schema's `$comment` block —
port those rules per host. Desktop runs the same schema as a cheap
pre-check on imports before its full validator, which stays normative.
