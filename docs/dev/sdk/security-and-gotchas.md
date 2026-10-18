# Security & Gotchas

The pack trust model in one page: the three tiers, what each tier can
never do and where that is enforced, the sandbox watchdogs and quotas with
their defaults, and the residuals the model does NOT cover. The user-side
plain-language companion is
[What a pack can never do](../../user/mini-apps-safety.md); the consent
disclosures quoted there are charter data rendered verbatim.

## The tier table

| Tier | Content | Trust basis | Can run code | Can leave the device | Install path |
|---|---|---|---|---|---|
| T0 | declarative JSON only | validated data — nothing executes | no (nothing to run) | no — `net` is the exfiltration-class rejection | file import or sources pipeline |
| T1 | app code in `src/packs/<id>/` | reviewed like app code, ships in the binary | yes, in-process | only via host-owned engine transport | bundled (`ensureBundled`) |
| T2 | code, imported | **sandboxed, not reviewed** — containment, not trust | yes, in its own sandboxed `utilityProcess` | no — `cap.net.fetch` answers typed `net-denied` | sources pipeline only, consent + content-digest pinned |

Tier is provenance at install time (bundled ⇒ T1, sources import carrying
`code` ⇒ T2, everything else ⇒ T0), never manifest data — a pack cannot
promote itself. **Containment is not trust**: the sandbox limits blast
radius, it does not review intent; the consent dialog says so verbatim.

## The consent model

Before anything installs from a source, the consent payload shows:
capabilities verbatim, tier, provenance **verbatim**
(author/license/repository/description), the pinned sha256 digest, and the
charter disclosure **verbatim** — for T0:

> This extension is declarative data only: it carries no code, and the app
> renders exactly what it declares — validated against a closed UI
> vocabulary and schema at import. Content stays inside the app's rendering
> and theming; nothing from this extension executes or reaches the network
> on its own.

for T2:

> This extension's code runs sandboxed, not reviewed. Sandboxing limits
> the blast radius of this code; it is not a review of its intent. The
> import is pinned to this exact content digest.

Paraphrasing a disclosure away is a conformance failure — these strings are
data (charter `consent.t0DeclarativeDisclosure` / `t2SandboxDisclosure`,
vendored in `contracts/extension-charter.json`). Consent records persist
with the install (`config.miniApps.sourceInstalls[].consents`: what, when,
what digest, the acting user, re-consent markers). Capability growth or a
configSchema change on update re-consents (the browser-permission model);
digest drift under a pinned ref degrades the source loudly; there is no
code auto-apply path at all.

## What the sandbox denies — the enforcement inventory

Each row is a real adversarial test (REAL processes — the process boundary
is never mocked), not an assertion:

| Escape attempt | Contained by | Test |
|---|---|---|
| infinite loop | wall-clock watchdog kill ⇒ self-disable | spine |
| memory bomb | `--max-old-space-size` heap cap, watchdog backstop ⇒ self-disable, bounded runtime; other packs unaffected | adversarial |
| `require('fs')` / process access | frozen vm context — no `require`, no `process` (typeof undefined) | spine |
| `fetch` / `WebSocket` / timers | absent from the context | spine |
| dynamic `import()` escape | vm denies (`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`) | spine |
| `.constructor.constructor` host escape | the RPC client is built INSIDE the context; host primitives ride closures ⇒ context-realm Function only | spine |
| realm crossing via `input` / capability replies | every value crossing into the context is marshalled — JSON serialized outside, parsed INSIDE by context-realm `JSON.parse`; nothing the handler or a `.then` sees has an outer-realm constructor (`tests/app-pack-sandbox-realms.test.ts`, real child) | realms |
| benign `globalThis` feature probes | `Object.getOwnPropertyNames(globalThis)` + typeof chains answer data (banned names `undefined`/absent); the child never crashes on them | realms |
| prototype pollution via IPC payloads | JSON-parsed data stored/shallowed verbatim, never deep-merged into host objects; `Object.prototype` asserted intact | adversarial |
| secret sniffing | scrubbed env (`PATH` + `HOME`→sandbox workdir only), no process surface, `cap.secrets.need` returns status + placeholder only | spine + adversarial |
| `process.exit` crash attempt | denied (`ReferenceError`); the invoke ends cleanly, the pack keeps working | adversarial |
| protocol garbage | child recycles itself at 3 violations; the host router recycles at 3 ⇒ typed `protocol-violation` + self-disable | spine + rpc |
| quota exhaustion | per-invoke/per-minute/bytes-per-day ⇒ typed `budget`, clean end | rpc + adversarial |
| digest drift (manifest or entry tampering) | the child re-derives BOTH pins before any pack byte runs ⇒ refuses (exit 2 ⇒ `digest-drift`) | spine |
| load-failed / broken pack | typed load error at handshake ⇒ self-disable with the reason | spine |
| version mismatch | terminal at either end ⇒ `identity` + self-disable | spine (router) |
| kill switch during a live invoke | user kill ⇒ `canceled`, never a self-disable | spine |

Suites: `tests/app-pack-sandbox.test.ts` (spine + frozen surface),
`tests/app-pack-sandbox-rpc.test.ts` (the seam),
`tests/app-pack-sandbox-adversarial.test.ts` (the matrix above),
`tests/app-pack-sandbox-realms.test.ts` (the realm law — every object
entering pack code is context-native, plus the structural wall that no
crossing seam bypasses the marshalling helpers),
`tests/app-pack-sources.test.ts` (the pipeline, incl. a REAL local-git
transport e2e). Every RPC frame in both directions validates against the
vendored `capability-rpc` schema; the method vocabulary is closed — unknown
methods answer `unsupported`, never dispatch, never reflect.

Death is pack failure, never app failure: crash, watchdog kill, protocol
recycle, or identity/digest refusal self-disables the pack with the
surfaced reason (`sandbox: …`) and it stays disabled until re-import —
consent is the re-arm act. The per-pack kill switch (`setEnabled false`,
remove, master-off, app quit) kills the live sandbox; a waiting invoke
reports `canceled`, never a self-disable. Concurrent live sandboxes cap
(default 4); over the cap answers typed `budget`, never a queue.

## Watchdogs and quota knobs

Host policy lives in `config.miniApps.sandbox`
(`src/shared/app-pack/sandbox.ts`); unknown or non-positive values fall
back to defaults:

| Knob | Default | Meaning |
|---|---|---|
| `callTimeoutMs` | 30 000 | wall-clock per `ext.invoke` / capability call |
| `spawnTimeoutMs` | 10 000 | sandbox spawn deadline |
| `disposeTimeoutMs` | 5 000 | dispose deadline |
| `memoryMb` | 256 | per-process heap cap (`--max-old-space-size`) |
| `maxConcurrent` | 4 | live sandboxes at once |
| `callsPerMinute` | 120 | per-pack capability calls/minute ring |
| `maxCallsPerInvoke` | 120 | per-invoke call cap |
| `bytesPerDay` | 2 097 152 | per-pack bytes/day bucket |
| `eventsPerInvoke` | 200 | `evt.progress`/`evt.log` rate cap (dropped counter surfaced) |
| `itemsPerInvokeMax` | 300 | typed items per invoke |

Charter hard caps sit above these and are tighten-only: rpc line 1 MiB,
state 256 KiB, items 256/call each ≤ 32 KiB, output 1 MiB, input 256 KiB,
entry 256 KiB, content total 2 MiB, secret slots 16, op ≤ 64 chars, error
detail ≤ 500 chars. Over-quota always answers the typed `budget` — never a
silent drop.

One `MiniAppSandboxRun` audit row per spawn; one `MiniAppSandboxCall` row
per capability call (method, argsHash, callNumber, ok, errorCode,
duration); boot reconciliation closes open rows as `interrupted` — host
death is never pack failure.

## ui:window — the host-owned window

`ui:window` (ADR-0040 clause 16) is a declarative-surface capability,
tiers 0+1, and **requires `report`** (the window renders the pack's report
through the same renderer path as the in-app modal — `renderer/pack-window-react/`).
Host-enforced constraints (`src/main/apps/windows.ts`):

- Constrained window: no `nodeIntegration`, `contextIsolation` on,
  sandboxed in production (the shared `getWebPreferences` profile),
  `window.open` denied, navigation locked to the app origin, family
  tokens/theme through the same styling path (test-pinned:
  `tests/a11y-pack-window.test.tsx` keeps the axe bar).
- No new markup path: the window hosts the closed component vocabulary
  only — raw HTML/JS from a pack never renders at any tier; the renderer
  filters unknown node types and action ids at the render seam.
- Per-pack cap of 1: a second open focuses the live window.
- Kill semantics: closes automatically on pack disable, pack removal
  (tombstone), master kill switch, and app shutdown (`before-quit`); boot
  reconciliation destroys anything that slipped through.
- Auditable: one `MiniAppWindow` row per lifetime with the close reason —
  `user · load-failed · pack-disabled · pack-removed · kill-switch ·
  app-shutdown · boot-reconcile`.
- Renderer parity rides the shared fixture suite
  `contracts/surface-renderer.fixtures.json` (12 cases incl. degrade
  probes, all through desktop's renderer core — implementations may differ
  from the family renderer, outputs may not).

## Assessment-side enforcement (T0/T1)

- **Root confinement**: run-root validation (lexical safety,
  realpath-first resolution, system/broad-root refusal on requested AND
  resolved paths), symlink skip, mount-point skip (`st_dev`), regular
  files only, every read re-validated against the root — no
  check-then-act window.
- **Sensitive baseline**: the host's baseline globs (`.env*`,
  `*credential*`, `*secret*`, `id_rsa*`, `*.kdbx`, `*.pem`, `*.key`,
  `*token*`) are enforced regardless of pack declaration (`rule:host-sensitive`
  outranks pack rules; the arm gate unions the baseline).
- **Fail-closed verdicts**: compose's default is `ask`; unresolved signals
  read false; content excerpts require `privacy.sendsContent` AND
  `readContext` AND the per-run `readContextWhen` — file content is
  untrusted input: it can inform questions, never arm an action.
- **The one destructive verb**: move-to-quarantine behind a fail-closed
  HITL Class-B gate (candidate ∧ confidence ≥ threshold ∧ not sensitive),
  re-fingerprinted at execution (changed files drop to `ask`), reversible
  (restore never overwrites), 30-day retention pruned on boot, permanent
  deletion only via the user-armed "empty quarantine".
- **Scheduled runs stay report-only, structurally**: sandboxed packs are
  surface-kind (the validator rejects the assessment shape for sandboxed
  validation), cannot declare `fs-write-quarantine`/`run` (the arm gate's
  prerequisites), and `RunService.start` fails them at the capability
  gate — arming against a visible proposal remains the only destructive
  path anywhere in the pack stack.

## Disclosed residuals

- **T2 consent is a bet on containment, not review.** The context boundary
  marshals every crossing value (realm law above); a sufficiently novel bug
  in V8/Electron sandbox primitives beyond that boundary is out of the
  model's scope; the digest pin means you re-consent to the *exact* bytes,
  which is the strongest claim made.
- **File names/paths/metadata always ride decide questions** when a pack
  runs `decide` — the split (metadata yes, content only opt-in) is
  disclosed at run start.
- **Quota exhaustion is a pack failure, not a host alarm** — the sandbox
  ends cleanly with typed `budget`; watch the audit rows if a pack is
  cycling.
- **`state` persists host-side** (`MiniAppSandboxState`, 256 KiB/pack) —
  it outlives sandbox restarts; removing the pack removes it.
- **The host honors what the charter's desktop profile lists** — anything
  else self-disables with a reason; the *degrade* rules (page→panel→…)
  are data in the vendored charter, never code branches.

## Authoring gotchas

- Packs never half-run: an unknown field/step/capability/slot, apiVersion
  too new (or outside the 2-major deprecation window), failed digest,
  privacy inconsistency or broken cross-reference self-disables at
  install/boot with a path-precise reason. Validate in CI, not in prod.
- Re-import over an installed id must RAISE the version — plan releases,
  don't lob same-version files at users.
- Fixed dates in fixtures are time bombs (family rule): a pinned mtime
  ages past every relative rule; backdate with `utimesSync` instead.
- System `/tmp` and `/var` are refused run roots — build test trees under
  `node_modules/.tmp`, never `/tmp`.
- Don't fight the vocabulary: if the report/pipeline can't say it, it
  can't be said — file a contract change (append-only), don't encode
  semantics into labels.
