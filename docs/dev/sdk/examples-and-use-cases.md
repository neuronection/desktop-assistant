# Examples & Use Cases

Four complete recipes, each in the recipe frame: **when to use**, **when NOT
to use**, **complete code**, **what to be careful at**. Every code block
here is real: the assessment manifest below passes
`npm run app-pack -- validate` verbatim (transcript shown), the surface
pack is the shipped `mini-calc` source, the Tier-2 pack is the repo's
sandbox reference fixture, and the distribution recipe mirrors what the
sources pipeline expects. For the field-by-field meaning see
[Authoring & Configuration](authoring-and-configuration.md).

## Recipe 1 — a minimal declarative assessment pack (report-only)

**When to use.** You want a repeatable, evidence-backed review of a folder
that deterministic rules can decide almost entirely — no model calls, no
destructive steps. Repo hygiene audits, naming-convention sweeps, "list
everything odd" triage. This is also the smallest honest assessment pack:
the shape every bigger assessment grows from.

**When NOT to use.** When the judgments genuinely need a model, use the
full pipeline (add a `decide` step — the reference pack
`src/packs/file-deletion-review/manifest.json` is the worked example). When
nothing is folder-shaped at all, a pack is the wrong tool — a command or a
native tool is cheaper ([Overview](overview.md#when-not-to-use-a-pack)).
When you want files *moved*, you need `propose` + `fs-write-quarantine`
(and the approval flow that comes with them) — do not ship a "report-only"
pack and ask users to act on it manually if the action is mechanical.

**Complete code** (`repo-health.json` — validated verbatim):

```json
{
  "apiVersion": 1,
  "id": "repo-health",
  "version": "0.1.0",
  "kind": "assessment",
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

```console
$ npm run app-pack -- validate /tmp/opencode/qs-demo/repo-health.json
OK repo-health@0.1.0 (assessment; capabilities: fs-read, run, report)
```

No `decide`, no `propose` — rules finalize everything; unmatched items land
in `ask` with the review queue. Import it via Settings → Apps → Mini-apps →
**Import pack…**.

**What to be careful at.**

- The `evidence` node is **mandatory** wherever recommendations render —
  the validator refuses the schema without it; a recommendation without
  justification is treated as a bug.
- Every classify rule needs its `rule.<id>` i18n key in **every** locale
  (here one locale). Same-key-set completeness is validated, not advisory.
- `scan.excludeGlobs` should skip VCS dirs — the walk already skips
  symlinks and mount points, but `.git` objects are regular files.
- Run roots are host-refused for system and over-broad locations (`/`,
  home itself, `/tmp`, `/var`, drive roots…); test on a real subfolder.

## Recipe 2 — a bundled surface pack with commands (Tier 1)

**When to use.** A first-party launcher surface: an input mode or palette
command with live behavior, shipped with the app and reviewed like app
code. The calculator and translate pad are exactly this.

**When NOT to use.** For anything distributed outside the app binary —
bundled packs are in-repo code (`src/packs/<id>/`), which third parties
cannot ship; distribute declarative data (recipe 1) or a sandboxed code
pack (recipe 3) instead. And if the surface needs no live renderer state
(just a command that runs a turn), a custom command
([commands](../../user/commands.md)) is far cheaper than a pack.

**Complete code** — `src/packs/mini-calc/manifest.json` (the shipped
pack, abridged only by omission of nothing):

```json
{
  "apiVersion": 1,
  "id": "mini-calc",
  "version": "1.1.0",
  "kind": "surface",
  "capabilities": ["ui"],
  "contributions": {
    "commands": [{ "id": "calc:evaluate" }],
    "input-mode": [{ "id": "calc:evaluate" }]
  },
  "i18n": {
    "defaultLocale": "en",
    "locales": {
      "en": {
        "title": "Calculator",
        "description": "Takes over the launcher input as a live calculator (palette: calc)."
      }
    }
  }
}
```

Plus `src/packs/mini-calc/evaluate.ts` (pure logic the app shares with the
command layer) and `src/packs/mini-calc/renderer.ts` (the renderer binding:
mode chrome config, `match` mapping, `useLive` behavior hook). Register the
manifest in `src/packs/index.ts` (main, `SURFACE_COMMAND_BINDINGS`) and the
binding in `src/packs/renderer.ts` (`SURFACE_RENDERER_BINDINGS`) — see
[`src/packs/README.md`](https://github.com/neuronection/desktop-assistant/blob/main/src/packs/README.md).

**What to be careful at.**

- One directory per app, both registration points, same commit; CI
  validates every manifest under `src/packs/` and **fails on an unregistered
  directory**.
- `ui` is a trusted-tier capability: it cannot appear in an imported
  manifest — the validator rejects it with the trusted-tier reason.
- A disabled surface pack falls back to normal command behavior (the
  launcher mode disappears, palette entries go with it) — design the
  command id so the fallback path still makes sense.
- Keep per-app behavior in `useLive` hooks + `applyOpenOptions` in the pack
  module; the mode controller and `MiniAppSurface` are generic — no
  pack/command ids outside `src/packs/<id>/`.

## Recipe 3 — a sandboxed Tier-2 code pack

**When to use.** You need actual logic (computation, state, unit
conversion, calls to *host* capabilities) that cannot be expressed as
declarative conditions, and you want to distribute it as an import. The
code runs in its own sandboxed process behind the capability RPC; the host
renders whatever it emits through the closed vocabulary.

**When NOT to use.** When plain conditions + config thresholds cover it
(recipe 1 costs nothing to run and nothing to trust). When you need the
network (`cap.net.fetch` answers a typed `net-denied` in this version) or
filesystem access beyond sandbox state (there is none). When you need
custom visuals (pack code contributes commands/settings — new visual
components are a NO at every tier). And you cannot skip the pipeline:
direct manifest import of code packs is refused; T2 installs only through
a source with consent + digest pinning.

**Complete code.** The runnable example is the repo's reference fixture
[`tests/fixtures/sandbox/reference-pack/`](https://github.com/neuronection/desktop-assistant/blob/main/tests/fixtures/sandbox/reference-pack/manifest.json)
— **copyable**; it is exactly the template the sandbox tests install
through the real pipeline. Its manifest:

```json
{
  "apiVersion": 1,
  "kind": "mini-app",
  "packKind": "surface",
  "id": "refpack",
  "version": "1.0.0",
  "author": "Neuronection",
  "license": "Apache-2.0",
  "repository": "https://github.com/neuronection/desktop-assistant",
  "description": "The Tier-2 reference pack: one command exercising the full sandbox surface.",
  "capabilities": ["state", "secrets", "ui:chat-card", "ui:settings"],
  "secrets": [{ "id": "api-token", "domains": ["example.com"] }],
  "entry": "code/entry.js",
  "configSchema": {
    "type": "object",
    "properties": {
      "rate": { "type": "number", "default": 2, "title": "config.rate" },
      "unit": { "type": "string", "default": "km", "title": "config.unit" }
    }
  },
  "contributions": {
    "commands": [
      { "id": "command:convert", "labelKey": "cmd.convert" },
      { "id": "command:full-surface", "labelKey": "cmd.fullSurface" }
    ],
    "settings-page": [{ "id": "refpack:settings" }]
  },
  "i18n": {
    "defaultLocale": "en",
    "locales": {
      "en": {
        "title": "RefPack",
        "description": "The Tier-2 reference pack: one command exercising the full sandbox surface.",
        "config.rate": "Conversion rate",
        "config.unit": "Target unit"
      }
    }
  },
  "entry": "code/entry.js"
}
```

`code/entry.js` — the whole program surface is a `handlers` object plus the
`capability` RPC client and `SandboxError` (the only non-standard globals
in the frozen vm context):

```js
handlers = {
  'command:convert'(input) {
    const value = Number(input.args.argv[0] ?? 0);
    if (!Number.isFinite(value)) {
      throw new capability.SandboxError({ code: 'invalid', detail: 'give a number', retryable: 'no' });
    }
    return { converted: value * (input.config.rate ?? 2), unit: input.config.unit ?? 'km' };
  },
  async 'command:full-surface'(input) {
    await capability.stateSet('last', input.args.argv[0] ?? null);
    const last = await capability.stateGet('last');
    const accepted = await capability.itemsEmit([{ kind: 'conversion', value: last }]);
    capability.progress(50, 'refpack.progress.half');
    capability.log('info', 'halfway through the full-surface probe');
    let secretStatus;
    try {
      secretStatus = { injectedAs: await capability.secretsNeed('api-token') };
    } catch (error) {
      secretStatus = { code: error.code, retryable: error.retryable };
    }
    let net;
    try {
      await capability.netFetch('https://example.invalid/');
      net = 'allowed';
    } catch (error) {
      net = error.code;
    }
    return { last, accepted, secretStatus, net };
  },
};
```

Note what the entry file does NOT contain: no `require`, no `process`, no
`fetch`, no timers — those names do not exist in the context. Distribution
= recipe 4 (put the directory in a git source; the pipeline classifies it
T2).

Validation is pipeline-shaped, not CLI-shaped: the plain validator
deliberately rejects this manifest outside the sandbox path —

```console
$ npm run app-pack -- validate tests/fixtures/sandbox/reference-pack/manifest.json
INVALID — 7 issue(s):
  $.capabilities: Unknown capability "state". [capability]
  $.capabilities: Unknown capability "secrets". [capability]
  $.capabilities: Unknown capability "ui:chat-card". [capability]
  $.capabilities: Unknown capability "ui:settings". [capability]
  $.code: Imported packs cannot carry code entries (Tier 0 is declarative only). [reserved]
  $.contributions: Slot contributions are a bundled-code (Tier 1) privilege. [reserved]
  $.secrets: Manifest secret slots are an imported-code-pack (Tier 2) declaration. [reserved]
```

— the sandboxed shape is validated by the sources pipeline at install (and
in-repo by `tests/app-pack-sandbox*.test.ts`, which install this very
fixture through the real pipeline). That failure output is the honest
signal you are holding a Tier-2 manifest.

**What to be careful at.**

- The T2 grant set is closed: `state`, `secrets`, `ui:chat-card`,
  `ui:settings` (+ `contributions` + `code`); anything else — including
  `net` — is refused at validation.
- Contribution ids must be namespaced (`<namespace>:<name>`) — reserved op
  prefixes stay unreachable.
- Entry budget: 256 KiB entry / 2 MiB content total; both digests are
  re-derived by the child before any pack byte runs — tampering is a
  `digest-drift` refusal, not a load.
- A crashed/killed sandbox **disables its own pack** (consent is the
  re-arm: re-import); every capability call is audited; quota exhaustion
  answers typed `budget`. Author handlers to end cleanly on typed errors.
- `secretsNeed` resolves to status only (`resolved: true` + the
  `{{secret:<slot>}}` placeholder) or the typed `needs-secret` — no
  message shape can carry a secret value toward the sandbox.

## Recipe 4 — distributing packs from a git source

**When to use.** You maintain packs for other people (or your own machines):
a git repository — public or private — that a Desktop Assistant source can
subscribe to; users add the URL once and get offer lists, consent dialogs,
digest pins and update gating for free.

**When NOT to use.** For a one-off handoff, a single JSON file over any
channel is simpler (T0 import needs no source). For anything the app should
own and review, contribute a bundled pack instead. And a source is not a
package registry: there is no version constraint solving — the ref strategy
decides what is offered.

**Complete code** — there is none to run on your side beyond git; the
recipe is the repository layout the pipeline discovers:

```
your-pack-repo/
├── manifest.json            pack A (repo root) — T0 family envelope,
│                            or a desktop pack manifest / T2 dir with code/
├── sub-pack/
│   └── manifest.json        pack B (ONE level of child dirs — no deeper)
```

- Every `manifest.json` must be ≤ 512 KB; discovery reads the root + one
  level of child directories, nothing deeper.
- Family envelopes (kind `mini-app`, `packKind: assessment`) project onto
  desktop packs; a directory carrying `code` + the sandboxed shape lands
  Tier 2; anything else fails loudly in the sync report.
- Tag releases and point the source at `release-tag` (or pin a
  `tag-pattern` like `v*`, a branch, or a commit sha). Ref moves are what
  "Check for updates" sees; content drift under a *pinned* ref is the loud
  `digest-drift` degrade, never an apply.
- Private repos: users configure named credential slots in their encrypted
  key store (`ext-source:<slot>`); tokens never ride the URL.

Users' side: Settings → Apps → Mini-apps → **Add source…** → paste the
https URL → **Check for updates** → **Install…** (consent) — the flow is
documented in
[Importing packs from sources](../../user/mini-apps-sources.md).

**What to be careful at.**

- Growing capabilities or changing `configSchema` between versions forces
  re-consent for every user — batch such changes deliberately; pure data
  diffs (version bump, i18n tweaks) are the one-click window.
- What desktop honors is the charter's desktop profile (`fs-read,
  fs-write-quarantine, decision, llm, run, report, propose, ui:window` for
  T0 envelopes); a pack declaring `net` or unhosted surfaces is shown to
  users as incompatible with the exact reason — test with a real sync
  before announcing.
- Installs land **disabled** by default (desktop's default-off policy) —
  tell your users to flip the switch.
- Removing the source parks installs (disabled + flagged, data kept); users
  restore per pack. Don't rely on source removal as an uninstall mechanism.
