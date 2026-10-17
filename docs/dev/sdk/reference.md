# Reference

The tables: error codes, the capability-RPC protocol, the CLI, the closed
vocabularies, limits, the IPC surface, kill switches and audit rows.
Everything here is as-landed — vocabularies come from the generated
contract (`src/shared/app-pack/contract.generated.ts`), which derives from
[`contracts/mini-app-packs.json`](https://github.com/neuronection/desktop-assistant/blob/main/contracts/mini-app-packs.json)
and the vendored family charter.

## Pack error codes (10)

Every pack-level capability failure is `{ code, detail }` — typed, never a
raw exception string:

| code | meaning |
|---|---|
| `not-ready` | engine/task unassigned, pack disabled |
| `needs-secret` | keyring key absent for the assigned decision provider |
| `budget` | run budget exhausted (resumable) |
| `rate-limited` | limiter engaged (`retryAfterMs` in detail) |
| `path-denied` | outside root / traversal / symlink / mount / refused root |
| `canceled` | user cancel / abort |
| `provider` | upstream model failure |
| `io` | OS fs error on an allowed path |
| `not-found` | unknown run/item; post-retention artifact |
| `invalid` | malformed request at the boundary |

## Charter error codes (15) — the sandbox wire

`ExtensionError { code, detail, retryable }` crosses the T2 seam (and is
the family-wide extension error model). `retryable` is a closed sub-enum:
`yes · no · after-delay · after-config-change`; resumability is
independent of retryability.

| code | retryable | meaning |
|---|---|---|
| `not-ready` | after-config-change | engine/model/task unassigned, extension disabled, surface prerequisites missing |
| `needs-secret` | after-config-change | a declared secret slot is absent/unresolved; a value never flows back over the T2 seam |
| `invalid` | no | malformed capability arguments at the boundary |
| `unsupported` | no | the host does not honor this capability/kind/tier/surface — self-disable territory |
| `io` | no | OS fs failure on an ALLOWED path; the run remains resumable |
| `not-found` | no | unknown run/item/extension id, or past retention |
| `path-denied` | no | outside the allowlist, traversal/symlink/mount escape, refused root |
| `net-denied` | no | the polite runtime's SSRF guard blocked the request — on the T2 seam in v1, `cap.net.fetch` answers this for every call |
| `auth` | after-config-change | upstream rejected credentials (401/403) |
| `rate-limited` | after-delay | upstream or host limiter; detail carries `retryAfterMs` when known |
| `unreachable` | yes | transport-level failure before an HTTP verdict (DNS, connection, timeout) |
| `protocol` | after-config-change | wire-shape violation from the endpoint |
| `provider` | yes | upstream server failure (5xx, malformed response) |
| `budget` | after-config-change | run/call budget exhausted; stops cleanly, resumable |
| `canceled` | no | AbortSignal fired or the user canceled |

## Capability RPC (`capability-rpc/1`)

The vendored law: `contracts/capability-rpc.md` + `.schema.json` (family
canonical, embedded verbatim as `CAPABILITY_RPC_SCHEMA`). Frames ride the
host-provided `parentPort` pipe (Electron `utilityProcess` cannot pipe
stdin; the vitest suite runs the same child over real stdio pipes so the
process boundary is never mocked). The method vocabulary is closed —
unknown methods answer `unsupported`, never dispatched, never reflected:

| Method | Requires | Grants / answers |
|---|---|---|
| `cap.state.get` / `cap.state.set` | `state` capability | host-persisted state; keys `^[a-z][a-z0-9_.-]{0,127}$`; 256 KiB/pack quota, over ⇒ `budget` |
| `cap.items.emit` | — | ≤ 256 items/call, each ≤ 32 KiB, per-invoke cap; invalid batches rejected typed `invalid`, never partially accepted |
| `cap.secrets.need` | declared slot + `secrets` capability | status only: `resolved: true` + the `{{secret:<slot>}}` placeholder, or typed `needs-secret`. No shape carries a value toward the sandbox |
| `cap.net.fetch` | — | **denied in v1**: every call answers typed `net-denied` (`no` retryable) + an audit row |
| `evt.progress` / `evt.log` | — | observations only; rate-capped per invoke (`eventsPerInvoke`, dropped counter surfaced); progress is percent/messageKey data, never raw prose |

The seam (`src/main/apps/sandbox/capabilities.ts`): quota gate → per-call
validation → host execution → one `MiniAppSandboxCall` audit row per call
(method, argsHash, callNumber, ok, errorCode, duration), written in
`finally` either way. Errors never leak raw exception strings — pack
crashes arrive as capped JSON (`exceptionType`).

## CLI (`npm run app-pack --`)

| Command | Effect |
|---|---|
| `init [dir] [--id <id>] [--title <title>]` | write a minimal valid `mini-app-pack.json` (does NOT create the dir; path resolves from the repo root under `npm run`) |
| `validate <file> [--bundled]` | validate a manifest with the ONE shared validator; prints `OK <id>@<version> (<kind>; capabilities: …)` or `INVALID — N issue(s)` with `path: message [code]` rows; exit 0/1 (CI-able); `--bundled` uses bundled-pack rules (Tier-1 vocabulary) |

The CLI bundles the shared validator — the same code the runtime runs; it
has no `--sandboxed` mode (the T2 shape validates in the sources pipeline
and the sandbox suites).

## Vocabularies

- **Kinds**: `assessment` · `surface`
- **Capabilities**: `fs-read` · `fs-write-quarantine` · `fs-write-mutate`
  (reserved) · `net` (denied) · `decision` · `llm` · `run` · `report` ·
  `propose` · `ui` · `ui:custom-code` · `ui:page` · `ui:panel` ·
  `ui:window`
- **Sandbox grants (T2)**: `state` · `secrets` · `ui:chat-card` ·
  `ui:settings`
- **Slots**: `commands` · `input-mode` · `composer-toolbar` ·
  `panel-header` · `card-actions` · `result-actions` · `status` ·
  `settings-page`
- **Pipeline steps** (fixed order): `scan` → `classify` → `decide` →
  `compose` → `report` → `propose`
- **Verdicts**: `keep` · `ask` · `candidate`
- **Question types**: `noul` (0..1) · `choice` · `score`
- **Run statuses**: `queued` · `running` · `paused` · `done` · `failed` ·
  `canceled` · `interrupted` (boot reconciles orphans)
- **Run events**: `run:created` · `run:started` · `run:progress` ·
  `run:item` · `run:paused` · `run:resumed` · `run:finished` ·
  `run:failed` · `run:canceled`
- **Item states**: `pending` · `scanned` · `rule-decided` ·
  `model-decided` · `composed` · `overridden` · `excluded` ·
  `quarantined` · `restored` · `changed-after-assessment`
- **Condition composites / ops**: `all` · `any` · `not` / `eq` · `ne` ·
  `lt` · `lte` · `gt` · `gte` · `in` · `matches` · `matches-any` ·
  `exists`
- **Report components**: `stat` · `table` · `cards` · `filter-bar` ·
  `select` · `badge` · `progress` · `actions` · `evidence`
- **Live-card components / binds**: `badge` · `stat` · `progress` /
  `run.status` · `run.estimateCalls` · `run.actualCalls` ·
  `run.inputTokens` · `run.outputTokens` · `totals.scanned` · `totals.keep`
  · `totals.ask` · `totals.candidate` · `totals.pending` · `progress`
- **Run actions**: `run:cancel` · `run:retry` · `run:resume` · `run:arm` ·
  `run:export` · `run:diff` — item actions: `item:exclude` ·
  `item:override` · `item:restore` · `item:reveal` · `item:open`
- **Export formats**: `markdown` · `json` · `csv`
- **Propose verbs**: `quarantine`
- **Origin classes**: `bundled` · `imported` · `listed`; source kinds:
  `git` · `local`; source statuses: `ok` · `degraded` · `failing` ·
  `stale`; ref strategies: `release-tag` · `tag-pattern` · `branch` ·
  `commit-pin`; update states: `available` (with `requiresReconsent`) ·
  `digest-drift` · `absent-from-source`
- **Refused roots (run roots)**: exact — `/`, `$HOME`, `$USERDATA`,
  `/mnt`, `/media`, windows-drive-roots; prefix — `/proc` `/sys` `/dev`
  `/run` `/boot` `/bin` `/sbin` `/usr` `/lib` `/lib64` `/etc` `/var`
  `/tmp` `/private` `$SYSTEMROOT` `$PROGRAMFILES` `$PROGRAMDATA` `/System`
  `/Library`
- **Host-sensitive baseline**: `.env*` · `*credential*` · `*secret*` ·
  `id_rsa*` · `*.kdbx` · `*.pem` · `*.key` · `*token*`

## Limits

`manifestMaxBytes` 524288 · `localesMax` 16 · `i18nKeysPerLocaleMax` 400 ·
`i18nValueMaxChars` 400 · `questionsPerPackMax` 24 · `classifyRulesMax`
256 · `reportComponentsMax` 96 · `liveCardComponentsMax` 16 ·
`configPropertiesMax` 64 · `configDepthMax` 3 ·
`contentExcerptMaxBytes` 8192 · `scanFileCapDefault`/`Hard` 20000/100000 ·
`scanDepthDefault`/`Hard` 16/64 · `evidenceJsonMaxBytes` 16384 ·
`iconMaxBytes` 65536 · `runsRetainedPerPack` 50 · quarantine retention 30
days · sandbox hard caps: rpc line 1 MiB · state 256 KiB · error detail
500 chars · items 256/call each ≤ 32 KiB · output 1 MiB · input 256 KiB ·
entry 256 KiB · content total 2 MiB · secret slots 16 · op 64 chars.
Sandbox policy knobs + defaults: see
[Security & Gotchas](security-and-gotchas.md#watchdogs-and-quota-knobs).

## IPC channels

The full registry with rules is [ipc.md](../ipc.md); the pack surface in
brief — lifecycle: `miniapps:get-state` · `miniapps:import` ·
`miniapps:remove` · `miniapps:set-enabled` (id `null` = master) ·
`miniapps:save-config` · `miniapps:restore-bundled`; runs:
`miniapps:pick-root` · `miniapps:run-start` · `miniapps:run-cancel` ·
`miniapps:run-resume` · `miniapps:runs-list` · `miniapps:run-report` ·
`miniapps:run-stats` · `miniapps:run-export` · `miniapps:run-diff` ·
`miniapps:live-card`; review: `miniapps:override-item` ·
`miniapps:exclude-item` · `miniapps:reveal-item` · `miniapps:open-item`;
arming: `miniapps:arm-run` · `miniapps:resolve-proposal` (idempotent) ·
`miniapps:abort-proposal`; quarantine: `miniapps:restore-item` ·
`miniapps:restore-batch` · `miniapps:quarantine-status` ·
`miniapps:quarantine-list` · `miniapps:restore-quarantine-record` ·
`miniapps:feedback-list` · `miniapps:feedback-clear` ·
`miniapps:empty-quarantine`; windows: `miniapps:window-open`; sources:
`miniapps:sources-list` · `miniapps:source-add` · `miniapps:source-remove`
· `miniapps:source-sync` · `miniapps:source-install` ·
`miniapps:source-apply-update` · `miniapps:source-restore`; T2 commands:
`miniapps:command-execute`; broadcasts: `miniapps:run-event` ·
`miniapps:proposal-event`.

## Kill switches

| Switch | Effect |
|---|---|
| Per-pack enable (`miniapps:set-enabled`) | disables the pack's surfaces, commands, runs; closes its window; kills its live sandbox |
| Pack removal (`miniapps:remove`) | tombstone (bundled removal is sticky; `restore-bundled` restores); window closes; sandbox killed |
| Master switch (`masterEnabled`) | every pack off at once — same teardowns |
| App quit (`before-quit`) | windows close, sandboxes die; boot reconcile closes/audits anything that slipped through |
| Abort a pending proposal (`miniapps:abort-proposal`) | not-yet-moved items return to `ask`; already-moved stay restorable |

## Audit tables

SQLite, `<userData>/conversations.db`:

| Table | One row per |
|---|---|
| `MiniAppRun` | run (status, totals, estimate/actual calls, tokens, conversation link) |
| `MiniAppRunItem` | per-item verdict with evidence (fingerprint, decidedBy) |
| `MiniAppFeedback` | review-queue override (unique per pack+root+path) |
| `MiniAppProposal` | arming batch (pending → approved/rejected → executed/failed/aborted) |
| `MiniAppQuarantine` | quarantined item (origin, movedAt, restoredAt) |
| `MiniAppWindow` | window lifetime (open + close reason) |
| `MiniAppSandboxRun` | sandbox spawn (outcome) |
| `MiniAppSandboxCall` | capability call (method, argsHash, callNumber, ok, errorCode, duration) |
| `MiniAppSandboxState` | persisted sandbox state per pack |
| `AiCall` | every model call the funnel makes on a pack's behalf (task `intent`, resolved model) |

Retention: runs pruned to the newest 50 finished per pack at boot
(paused/interrupted kept); quarantine 30 days; the sandbox tables persist.
