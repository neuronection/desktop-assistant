# Versioning & Migration

How the pack contract versions, what may never happen to a vocabulary,
and what concretely becomes of an installed pack when versions move.

## apiVersion policy

`apiVersion` is a single integer (currently **1**), shared by the manifest
and the host, and the ONLY version negotiations that exist:

- **Too new** — a manifest with `apiVersion` > the host's self-disables at
  install/boot with `requires host apiVersion >= N` (path-precise reason on
  the pack card). Nothing runs degraded.
- **Too old** — a manifest more than
  `PACK_DEPRECATION_WINDOW_MAJORS` (**2**) majors behind the host
  self-disables with the deprecation-window reason. Hosts keep N and N−1
  alive; N−2 is gone.
- **In window** — older manifests validate unchanged. apiVersion bumps are
  rare by design: v1's deliberately-rejected capabilities
  (`fs-write-mutate`, `net`) are the concrete v2 candidates, and they will
  arrive with new consent surface, not silently.

What a bump does NOT do: there is no per-field negotiation, no feature
flags, no "mostly compatible" mode. A pack either validates wholly against
the host's vocabulary or it self-disables with the exact reason — packs
never half-run, across versions too.

## Pack `version` vs `apiVersion`

The semver `version` field is the pack's own release line and drives
upgrade mechanics, not compatibility: re-importing an installed id must
**raise** it (the registry rejects same/lower), and bundled upgrades
install in place only when the shipped version is newer — user imports and
removal tombstones are never clobbered. The verdict cache keys on
`(rootId, fingerprint, packVersion, configHash, engineId)`, so a version
bump (or config/engine change) deliberately invalidates cached verdicts:
a stale-run resume is rejected and a new run starts rather than mixing
verdicts across versions.

## Append-only vocabularies

Contract vocabularies never lose or re-mean members — additions append,
removals wait for a major apiVersion with the deprecation window above:

- capabilities, kinds, slots, steps, verdicts, question types, run
  statuses/events, item states, condition ops, report/live-card
  components, action ids, export formats, error codes — all closed sets
  in `contracts/mini-app-packs.json`, generated into
  `src/shared/app-pack/contract.generated.ts`.
- Unknown vocabulary self-disables with a typed reason (e.g.
  `Capability "net" is reserved for a later contract version — requires
  contract apiVersion >= 2.`) — forward-declared members are rejected
  today, reserved tomorrow, never renumbered.
- Amendments follow the `decide.readContextWhen` precedent: new
  vocabulary ships as data in the family contract, syncs byte-identically
  into `contracts/mini-app-packs.json`
  (`scripts/sync-app-pack-contract.mjs`, drift-gated), regenerates the
  module, and lands with its validator rules + tests in one commit.

## The no-shims doctrine

**No runtime compatibility layers, ever.** When a vocabulary changes, the
adopting commit deletes the old form outright — the charter's mapping note
(`legacyMappingNote`) is a one-time re-authoring note for humans, not code
the host runs: "old enums are deleted in the adopting commits". Concretely
in this repo's history: the pack contract's dead `engine` preference left
the manifest schema outright rather than growing a translator, and legacy
config shims were deleted once the one-time migration ran. A pack that no
longer validates self-disables with the reason — the fix is re-authoring
(raise `version`, adjust the manifest), never a shim in the host.

The generated JSON Schema (`mini-app-packs.manifest.schema.json`) is
structure-only and explicitly NOT a compatibility layer either: it is a
cheap pre-check before the normative validator, and the schema's
`$comment` block lists the validator-owned semantics per host — port
those, don't approximate them.

## Tier provenance and versioning

Tier is provenance at install time and never changes for a given install:
a pack that arrived bundled stays T1 even if a later app ships the same id
as importable data; a T2 install is pinned to its exact content-tree
digest — every update re-consents, and there is no code auto-apply path
(the only auto-apply window is a byte-identical canonical manifest on a
T0 data pack). Provenance (author/license/repository) passes through to
the pack manifest and is recorded verbatim on the install/consent record,
so it versions with the source, not the app.

## What happens to installed packs, concretely

| Event | Installed packs |
|---|---|
| host major bump (apiVersion N→N+1) | packs on N keep validating (in window); packs on N−2 self-disable with the window reason; re-import after the pack updates its apiVersion |
| manifest vocabulary the host no longer knows | self-disable at boot revalidation, path-precise reason; stays inert (data intact) until re-import of a fixed version |
| digest mismatch (tampered store or downgrade orphan) | self-disable at boot revalidation — the registry re-derives and compares the sha256 every boot |
| pack update via source, byte-identical manifest | auto-apply window: one click, no dialog (the canonical manifest is unchanged; only non-manifest content moved) |
| pack update via source, any manifest change (version/labels/report/data/provenance/capabilities/configSchema) | re-consent dialog with the machine change-summary; refusing leaves the pin untouched |
| pinned-ref content drift | loud `digest-drift` source degrade; nothing refetches until verified + re-consented |
| source removed | installs park: disabled + flagged, data and consent history intact |
