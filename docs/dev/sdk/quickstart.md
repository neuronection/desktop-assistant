# Quickstart

Scaffold a mini-app pack, validate it with the same CLI the runtime uses,
and import it into Desktop Assistant — about ten minutes, no model or
provider needed to install. Every command and transcript below was run
against this repository exactly as written (plan 34's runnable-examples
rule; the transcripts are real output, not illustrations).

**Prerequisites:** a checkout of this repo with dependencies installed
(`npm install`). The CLI validates offline — no provider key, no app boot.
All `npm run app-pack -- …` invocations must run **from the repo root**:
`npm run` executes with the package root as the working directory, so
relative paths resolve against the repo, not your shell's cwd.

## 1. Validate an existing pack (the reference example)

The bundled reference pack
[`src/packs/file-deletion-review/manifest.json`](https://github.com/neuronection/desktop-assistant/blob/main/src/packs/file-deletion-review/manifest.json)
is the worked example for everything in this set. Validate it:

```console
$ npm run app-pack -- validate src/packs/file-deletion-review/manifest.json

> desktop-assistant@0.9.0 app-pack
> node scripts/app-pack/cli.mjs validate src/packs/file-deletion-review/manifest.json

OK file-deletion-review@1.0.0 (assessment; capabilities: fs-read, fs-write-quarantine, decision, run, report, propose)
```

Exit code 0. One line of `OK <id>@<version> (<kind>; capabilities: …)` is
the success criterion for any pack file. The CLI bundles the ONE shared
validator (`src/shared/app-pack/validate.ts`) — the same code the runtime
runs at install and boot, never a re-implementation.

## 2. Scaffold your own pack

`init` writes a minimal valid assessment manifest. It does **not** create
the target directory, and (see prerequisites) its path resolves from the
repo root — give it an absolute path:

```console
$ mkdir -p /tmp/opencode/qs-demo
$ npm run app-pack -- init /tmp/opencode/qs-demo --id my-first-pack

> desktop-assistant@0.9.0 app-pack
> node scripts/app-pack/cli.mjs init /tmp/opencode/qs-demo --id my-first-pack

app-pack: wrote /tmp/opencode/qs-demo/manifest.json (validate it: npm run app-pack -- validate /tmp/opencode/qs-demo/manifest.json)
```

The scaffold is a complete, valid assessment pack — two classify rules
(recently-modified files stay; `*.tmp` files become candidates), a table +
evidence report, and the required i18n labels:

```json
{
  "apiVersion": 1,
  "id": "my-first-pack",
  "version": "0.1.0",
  "kind": "assessment",
  "capabilities": ["fs-read", "run", "report"],
  "privacy": { "sendsContent": false, "sensitiveGlobs": [] },
  "run": {
    "scan": {},
    "classify": {
      "keep": [
        { "id": "fresh", "when": { "signal": "meta.ageDays", "op": "lt", "value": 7 } }
      ],
      "candidate": [
        { "id": "cache", "when": { "signal": "meta.name", "op": "matches", "value": "*.tmp" } }
      ]
    },
    "compose": {}
  },
  "report": {
    "nodes": [
      { "id": "items", "type": "table", "columns": ["path", "verdict"] },
      { "id": "ev", "type": "evidence" }
    ]
  },
  "i18n": {
    "defaultLocale": "en",
    "locales": {
      "en": {
        "title": "my-first-pack",
        "rule.fresh": "Recently modified",
        "rule.cache": "Temporary file",
        "report.items": "Items",
        "report.ev": "Evidence"
      }
    }
  }
}
```

## 3. Validate it

```console
$ npm run app-pack -- validate /tmp/opencode/qs-demo/manifest.json

> desktop-assistant@0.9.0 app-pack
> node scripts/app-pack/cli.mjs validate /tmp/opencode/qs-demo/manifest.json

OK my-first-pack@0.1.0 (assessment; capabilities: fs-read, run, report)
```

Invalid packs fail loudly, path-precise, exit 1 — for example after adding
the (reserved) `net` capability:

```console
$ npm run app-pack -- validate /tmp/opencode/qs-demo/bad.json

> desktop-assistant@0.9.0 app-pack
> node scripts/app-pack/cli.mjs validate /tmp/opencode/qs-demo/bad.json

INVALID — 1 issue(s):
  $.capabilities: Capability "net" is reserved for a later contract version — requires contract apiVersion >= 2. [reserved]
```

## 4. Import it into the app

Open **Settings → Apps → Mini-apps → Import pack…** and pick the
`manifest.json` file. The import validates with the same options, then
installs: the pack appears on its own card with its capabilities and origin
(*imported*), enabled. **Run…** on the card, pick a folder (system folders
and over-broad locations are refused), and the run lands as a live card in
a conversation — with **View report** one click away. That is the working
result this quickstart promises: a pack you wrote, validated by the real
validator, running on a real folder.

Variations (model questions, quarantine proposals, code packs, git
distribution) are recipes, not forks of this path — see
[Examples & Use Cases](examples-and-use-cases.md). To go deeper into what
each manifest field means, read
[Authoring & Configuration](authoring-and-configuration.md); for what
imported packs may never do, read
[Security & Gotchas](security-and-gotchas.md).
