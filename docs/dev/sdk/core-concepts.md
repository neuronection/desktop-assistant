# Core Concepts

This chapter defines the nouns the rest of the pack SDK uses — manifest,
kind, tier, capability, run, source, consent and digest — each once, and
shows how they connect. The vocabulary is family-wide (the extension
charter); this page describes desktop's host profile over it.

## The nouns

**Manifest** — the pack itself: one JSON document, `manifest.json` at
the pack/bundle root (the family file form — never code-declared).
Identity (`id` must match
`^[a-z][a-z0-9-]{2,39}$`, `version` semver), `apiVersion` (integer, currently
1), `kind`, `capabilities`, an optional `configSchema`, and kind-specific
blocks (`run`/`report` for assessments, `contributions` for surfaces).
Unknown fields anywhere self-disable the pack at install/boot with a
path-precise reason — packs never half-run.

**Kind** — what the pack *is*:

| Kind | What it is | Example |
|---|---|---|
| `assessment` | a pipeline over a folder: `scan → classify → decide → compose → propose?`, producing evidence-backed verdicts and (optionally) a quarantine proposal | `file-deletion-review` |
| `surface` | a launcher input mode + commands contributed by code (bundled Tier 1, or sandboxed Tier 2) | `mini-calc`, `mini-translate` |

**Tier** — where the pack's content comes from, i.e. how much it is trusted.
Tier is **provenance at install time, never manifest data**: bundled ⇒ T1,
sources-pipeline import carrying `code` ⇒ T2, everything else ⇒ T0.

- **Tier 0 — imported data packs.** A single JSON file; no code executes,
  ever; `net` denied at the mapping seam as the exfiltration-class
  rejection. Anyone can author one.
- **Tier 1 — bundled code packs.** Shipped with the app under
  `src/packs/<id>/`, reviewed like app code. Surfaces and executors live
  here (`ui`, `ui:custom-code`, `contributions`, `code` are
  bundled-and-sandbox-only vocabulary).
- **Tier 2 — sandboxed code packs.** Imported through the sources pipeline
  only; each runs in its own sandboxed `utilityProcess` behind the
  capability RPC. **Containment is not trust**: the sandbox limits blast
  radius, it does not review intent.

**Capability** — a closed, contract-enumerated grant a pack declares and the
host polices: `fs-read`, `fs-write-quarantine`, `fs-write-mutate` (reserved),
`net` (denied), `decision`, `llm`, `run`, `report`, `propose`, `ui`,
`ui:custom-code`, `ui:page`, `ui:panel`, `ui:window`. Tiers gate them:
desktop honors `fs-read, fs-write-quarantine, decision, llm, run, report,
propose, ui:window` for imports; declaring anything else self-disables the
pack at the mapping seam with a reason naming the capability.

**Run** — one execution of an assessment pack over a root folder: a real
Conversation in history with a live card (status, progress, tallies, cost)
that settles into a persistent result. Runs produce **verdicts** — `keep`,
`ask`, `candidate` — checkpointed per item with evidence, cached by
fingerprint (`sha256(root|path|size|mtime[|excerpt])`) so unchanged items
are never re-paid.

**Source** — a subscription a user configures: a git URL (https only) or a
local folder, with a ref strategy (`release-tag`, `tag-pattern`, `branch`,
`commit-pin`). Sources feed the one pipeline: resolve → shallow fetch →
manifest discovery (root + one level of child dirs) → envelope validation →
host-profile mapping → consent → pinned install.

**Consent** — the explicit, recorded confirmation before anything installs
from a source. The consent payload shows capabilities, tier, provenance
verbatim (author/license/repository/description), the digest, and the
charter's disclosure **verbatim** — T0 the declarative-data disclosure, T2
the sandbox disclosure. Consent records persist with the install.

**Digest** — the sha256 pin of what was consented to and installed. For T0
it is the manifest content digest; for T2 the **content digest** over the
whole landed subtree (sorted relative paths + NUL + size + NUL + bytes,
`.git`/symlinks skipped). The sandbox re-derives both digests before any
pack byte runs; drift is a loud failure, never an apply.

## How it connects

```
author ──► manifest (manifest.json)
              │
   ┌──────────┴────────────────────────────────┐
   │ file import          sources pipeline      │
   │ (content, direct)    (git/local source:    │
   │                      fetch → discover →    │
   │                      envelope validate →   │
   │                      map → CONSENT →       │
   │                      digest-pinned land)   │
   └──────────┬────────────────────────────────┘
              ▼
        the registry (config.miniApps.packs[]: manifest + sha256 digest
              + origin + enabled + config + self-disable reason)
              │  revalidated (validator + digest) at boot and import
              ├─ T0 data ──► runner: scan → classify → decide → compose
              │                (capabilities: fs root, decide bridge,
              │                 run bridge; fingerprint cache)
              │                     ▼
              │               RunService (persisted runs, budgets,
              │                 pause/resume, run:* events)
              │                     ▼
              │               report renderer (closed vocabulary +
              │                 evidence) → review queue → propose →
              │                 Class-B approval → quarantine (undo)
              ├─ T1 bundled code ──► in-app executors + renderer
              │                     bindings (src/packs/<id>/)
              └─ T2 sandboxed code ──► utilityProcess (frozen vm surface,
                                    capability RPC: state/items/secrets/
                                    events; net denied; watchdogs)
```

Two more nouns ride this diagram: **instance** (an installed pack — the
registry row with its config and provenance sidecar) and **origin class**
(`bundled` | `imported` | `listed`) which drives the card chrome: official
packs are never labeled as imports, source installs carry their pin +
provenance, and `listed` marks candidates a configured source offers but
that are not installed.

## Where the code lives

```
src/shared/app-pack/     the SDK — pure TypeScript, no Electron/Node APIs
├── contract.generated.ts   GENERATED from contracts/mini-app-packs.json
│                          (scripts/sync-app-pack-contract.mjs; drift gate)
├── extension.generated.ts  VERBATIM embeddings of the vendored family
│                          artifacts (charter + envelope/sources schemas)
├── manifest.schema.generated.ts  the generated draft-2020-12 JSON Schema
│                          (import pre-check; see Versioning & Migration)
├── mapping.ts              the family-envelope → pack-manifest projection
├── sources.ts              sources/consent/updates wire shapes
├── sandbox.ts              T2 wire shapes + host policy knobs + defaults
├── types.ts                manifest/verdict/run/report types
├── validate.ts             the ONE validator (SDK + runtime + CLI share it)
├── builders.ts             definePack / question / rule / run / ui helpers
└── cli-core.ts             pack init | validate core (scripts/app-pack/)

src/packs/                 bundled packs — ONE directory per app
src/main/apps/
├── registry.ts             install/enable/disable/remove, digest + origin,
│                          apiVersion negotiation, boot self-disable,
│                          ensureBundled (tombstone-aware install/upgrade)
├── sources/                the sources pipeline (descriptor → constrained
│                          git transport → discovery → consent → install)
├── capabilities/           the trust boundary (fs / decide / run bridges)
├── sandbox/                the T2 spine: spawn, protocol, capabilities seam
├── runner/ + run/          the assessment pipeline + RunService
├── windows.ts              the ui:window host surface
└── quarantine.ts           move / retention / restore, audited
```

The renderer never imports pack code and never orchestrates: it renders
`run:*`/`miniapps:*` events over the preload bridge
([ipc.md](../ipc.md) has the full channel registry).
