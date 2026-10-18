# Install lifecycle internals

How packs get onto a machine and stay honest once there: bundled
installation, file import, the sources pipeline, the family-envelope mapping
seam, and exactly where each artifact lives on disk. The using seat —
importing from a file, adding a git source, consenting, updating — is the
user chapter ([mini-apps-sources](../../user/mini-apps-sources.md)); this
page is the operator/developer view under it.

## Modes: bundled vs imported vs listed

| Mode | How it arrives | Tier | Origin class | Default state |
|---|---|---|---|---|
| Bundled | ships with the app under `src/packs/<id>/`; the registry's `ensureBundled` validates and installs/updates at boot | T1 (code packs) / T0 (data packs) | `bundled` | enabled; user removal is sticky (`removedBundled` tombstones), bundled upgrades never clobber a user import or restore over a tombstone without `miniapps:restore-bundled` |
| Imported (file) | Settings → Apps → Mini-apps → **Import pack…** — the renderer reads the file content via the standard open dialog; the channel validates → digests → installs with origin | T0 | `imported` | enabled (historical behavior) |
| Imported (source) | the sources pipeline below — consent-gated, digest-pinned | T0 or T2 | `imported` (with pin + provenance) | **disabled** (the charter's desktop default-off host policy) |
| Listed | discovered by a configured source during sync, compatible, not installed | — | `listed` | not installed; shown only while the source is configured |

Re-importing an installed id must **raise the version** — the registry
rejects same-version (or lower) imports; `version-must-increase` is
preserved through the projection seam too.

## The install record

Installed packs persist in `config.miniApps` (`masterEnabled` + `packs[]`):
the raw manifest, its sha256 digest, origin (bundled | imported path +
timestamp), enabled flag, an optional self-disable `error`, and user
`config` values. On boot **and** on every import, the registry revalidates
each stored manifest with the shared validator **and its digest** — a
tampered or host-downgrade-orphaned pack self-disables instead of running,
with the reason on its card. Run/verdict data lives in the app database
(`MiniAppRun` and friends — see [Reference](reference.md#audit-tables)),
never in config.

Sources add a per-source record (`config.miniApps.sources[]`: validated
descriptor, status, candidates, install sidecars with pins + consent
history) and per-install provenance sidecars
(`config.miniApps.sourceInstalls[]`) — the registry store stays the single
pack source of truth; the sidecar is the provenance/consent/pin view keyed
by pack id.

## The sources pipeline (one shape, two source kinds)

- **git source** — an https-only URL (the schema's root descriptor; ssh,
  file transports and userinfo credentials are structurally inexpressible).
- **local file source** — the schema's structurally distinct
  `$defs.localSourceDescriptor` variant: an absolute path with no `..`
  segments. Local sources ride the SAME git transport with the path as the
  origin — one code path.

The pipeline: resolve (ls-remote per the ref strategy: `release-tag` |
`tag-pattern` | `branch` | `commit-pin`) → shallow fetch (`git clone
--depth 1 --branch <ref>` for tags/branches, `init + fetch --depth 1 +
checkout FETCH_HEAD` for sha pins) → manifest discovery (root + ONE level
of child dirs, `manifest.json`, 512 KB cap) → schema validation against
the vendored family envelope → host-profile mapping/compat → per-extension
consent → pinned, content-addressed install.

Discovery classifies per directory: a valid family envelope ⇒ **T0**; a
document carrying `code` that passes the normative validator's
**sandboxed** shape ⇒ **T2** (the family envelope cannot express code, by
design); everything else fails loudly. **Direct manifest import of code
packs is refused** — Tier 2 installs only through the pipeline (consent +
digest pinning are the price of admission, ADR-0030 clause 5).

The transport is constrained by construction: the allowlisted `git`
executable resolved once via `which`/`where`, every invocation an argv
array (no shell, no interpolation — source-provided strings are
pattern-validated against the vendored schema BEFORE any spawn), 30 s
timeout, `GIT_TERMINAL_PROMPT=0`, credentials ride `GIT_CONFIG_*`
environment variables (never argv, never logs), resolved from keyring slots
(`ext-source:<slot>`) at fetch time. A test seam (injectable
`GitTransport`) keeps the suite network-free; the adversarial suite
exercises a REAL local repo through the child-git path
(`tests/app-pack-sources.test.ts`).

For T2, landing copies the whole subtree under
`<userData>/mini-apps/<id>/<contentDigest>/` and re-verifies the digest of
the **landed copy** before installing.

## The family-envelope → pack-manifest mapping

The importable family class on desktop is **kind mini-app, packKind
assessment**. The projection (`src/shared/app-pack/mapping.ts`, pure +
tested) reads the desktop host profile from the vendored charter (data,
never code):

| Family envelope | Desktop pack manifest | Rule |
|---|---|---|
| `kind: mini-app` | (implicit) | connector/bridge ⇒ self-disable reason (bridge is server-class) |
| `apiVersion` (integer ≤ 1) | `apiVersion` | the mini-app kind keeps the integer lineage; too new ⇒ self-disable reason |
| `packKind` | `kind` | assessment accepted; surface ⇒ self-disable (no desktop rendering host for imported surface envelopes) |
| `capabilities` | `capabilities` | identity map for the charter desktop-profile honors set: `fs-read, fs-write-quarantine, decision, llm, run, report, propose, ui:window` |
| `net` | — | the exfiltration-class rejection at T0 (never an unknown-capability reason) |
| any other capability (`secrets`, `chat-tools`, `ui:page`, `ui:panel`, `ui:chat-card`, `ui:settings`, `notify`, `state`, `sync`, …) | — | unhonored ⇒ self-disable reason naming the id (the charter's D8/D17 law) |
| `surfaces.{page,panel,window}` + `data` | — | no desktop rendering host for per-surface declarative schemas — the window surface renders the pack REPORT; declared surfaces/data self-disable with the degrade chain named |
| `configSchema` | `configSchema` | pass-through; a `required` list (not expressible in the kind refinement) or any `x-secret` field (the pack-config store is not a secret store, D19) ⇒ self-disable with the re-author reason |
| `description` | i18n `description` key | injected into every locale (same-key-set invariant preserved) |
| `author` / `license` / `repository` / `categories` | install record only | provenance renders verbatim on the consent surface + the origin card — no pack-manifest field exists |
| `i18n` / `run` / `report` / `liveCard` / `privacy` / `icon` / `defaults` | identity | identical shapes; the shared validator stays normative |

The projected manifest then passes through `registry.importManifest` — the
ONE validator — so a projection that would half-install fails typed.

## Updates and parking

Update checks ride every sync: ref move + digest change + manifest diff
(capabilities + `configSchema` are the byte-identical test fields). The
rules, mechanically enforced:

- **Digest drift under the SAME pinned ref is a LOUD failure** — pins
  untouched, the source degrades, nothing refetches until the user verifies
  and re-consents.
- **Capability growth or a configSchema change re-consents** (the
  browser-permission model; `source-apply-update` refuses `consent: false`
  for those).
- **The only auto-apply window** is a byte-identical-manifest data diff
  (version bump + i18n tweaks) — and only because desktop imports T0 data
  packs: **there is no code auto-apply path at all** (every T2 update
  re-consents; `requiresReconsent` is always true for T2).
- **Removing a source parks its imports** — disabled + flagged, data and
  consent history intact, tombstone-able via the normal remove;
  `miniapps:source-restore` unparks (still disabled — enabling is the
  user's next explicit act). Bundled tombstones are untouched.

## On-disk layout

| Artifact | Location |
|---|---|
| Registry store (manifests, digests, origins, config) | `<userData>/config.json` under `miniApps` |
| Source-installed content (T2, content-addressed) | `<userData>/mini-apps/<id>/<contentDigest>/` |
| Quarantine (mirrored layout + per-batch `manifest.json`) | `<userData>/mini-apps/<pack>/quarantine/<runId>/` |
| Runs, items, feedback, proposals, quarantine records, windows, sandbox audits | `<userData>/conversations.db` (SQLite — `MiniApp*` tables) |
| Provider/tool secrets (never pack config) | the encrypted key store via `SecretService` (`secrets.json`), e.g. source creds `ext-source:<slot>`, T2 declared secrets `miniapp:<packId>:<slot>` |
| Bundled pack source | in-repo `src/packs/<id>/` — `manifest.json` at the pack root (every bundled pack, code or data; the family file form) |

The install/update/remove IPC surface is enumerated in
[ipc.md](../ipc.md) (`miniapps:get-state` … `miniapps:source-restore`).
