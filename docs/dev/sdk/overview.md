# Pack SDK overview

Mini-app packs are **focused task apps Desktop Assistant installs, configures,
runs and renders** — a folder-assessment workflow ("review this directory for
files I could delete"), a launcher surface (the calculator, the translate
pad), or a sandboxed command tool. A pack is either **declarative data**
(one validated JSON manifest the host executes) or **sandboxed code** (an
imported code pack confined to its own OS process behind a capability RPC).
The host — never the pack — owns every dangerous power: filesystem access,
model calls, runs, approvals, windows and rendering.

This chapter-set documents the pack SDK end to end: authoring, installing,
securing and troubleshooting. It replaces the former `app-packs.md` and
`pack-authoring.md` pages (architecture, authoring guide, and the sources
pipeline now live here, re-shelved per chapter).

## The mental model

- **A pack is a manifest, validated data first.** The ONE shared validator
  (`src/shared/app-pack/validate.ts`) gates every install, boot and import;
  an unknown field, capability or cross-reference anywhere self-disables the
  pack with a path-precise reason — packs never half-run.
- **Capabilities are granted by declaration, confined by the host.** A pack
  declares what it needs (`fs-read`, `decision`, `ui:window`, …); the host
  decides what each trust tier may actually touch. Ordinary imported packs
  carry no code at all; imported code packs run in a sandboxed utility
  process with no fs, network, process or timer surface.
- **Everything irreversible is a human act.** The only destructive verb is
  move-to-quarantine, armed by an explicit approval, reversible by restore,
  and never permanently deleted except by the user's own "empty quarantine".

## When to use a pack

- You have a **repeatable folder workflow** — triage, review, cleanup,
  auditing over a directory tree — that benefits from deterministic rules
  plus a decision model on the residual, with evidence and reports.
- You want a **launcher surface** (input mode + commands) shipped with the
  app as a first-party mini-app, over the shared registry/validator path.
- You want to **distribute a task app** to other Desktop Assistant users as
  a single JSON file (or a git source they can subscribe to) without them
  installing anything executable.

## When NOT to use a pack

- **It's a chat-time capability** — the assistant answering, searching,
  fetching, running a shell command. That is a native tool or a command
  (see [tools-and-policy](../tools-and-policy.md) and
  [adding-features](../adding-features.md)); packs cannot contribute agent
  tools.
- **It's a setting or a provider integration.** Settings live in the config
  surface; MCP servers and integrations are tool apps
  ([apps-and-mcp](../../user/apps-and-mcp.md)), a different subsystem.
- **It needs arbitrary filesystem writes, the network, or a UI beyond the
  closed declarative vocabulary.** Those are contract-level denials today
  (`fs-write-mutate` and `net` are reserved for a future apiVersion;
  `cap.net.fetch` answers a typed denial at the sandbox seam). Ask for a
  contract change instead of working around it.
- **It's one prompt.** Scheduled prompts
  ([automation](../../user/automation.md)) cover that without a manifest.

## The chapters

| Chapter | Read it for |
|---|---|
| [Quickstart](quickstart.md) | scaffold → validate → import, with real CLI transcripts |
| [Core Concepts](core-concepts.md) | the nouns: manifest, kind, tier, capability, run, source, consent, digest |
| [Installation & Modes](../../user/mini-apps-sources.md) (using) · [internals](installation-and-modes.md) | file import vs git/local sources, consent, updates; the registry and on-disk layout |
| [Authoring & Configuration](authoring-and-configuration.md) | the full manifest reference — pipeline, conditions, reports, contributions |
| [Examples & Use Cases](examples-and-use-cases.md) | four complete recipes in the recipe frame |
| [Security & Gotchas](security-and-gotchas.md) · [the safety model](../../user/mini-apps-safety.md) | trust tiers, the enforcement inventory, watchdogs, residuals |
| [Reference](reference.md) | error codes, capability RPC, CLI, vocabularies, limits, audit tables |
| [Versioning & Migration](versioning-and-migration.md) | apiVersion policy, append-only vocabularies, no shims |
| [Troubleshooting & FAQ](../../user/mini-apps-troubleshooting.md) · [dev diagnostics](troubleshooting-and-faq.md) | symptom → cause → fix |

The normative contract is
[`contracts/mini-app-packs.json`](https://github.com/neuronection/desktop-assistant/blob/main/contracts/mini-app-packs.json)
(family canonical in the
[dev repo](https://github.com/neuronection/dev)); everything here derives
from it and from the family extension charter vendored at `contracts/`.
