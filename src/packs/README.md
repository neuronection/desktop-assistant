# Mini-app packs

This directory holds the app's **bundled mini-app packs** — one
directory per app. A pack is a validated manifest (plus, for bundled
code apps, host bindings) that the desktop assistant installs,
configures, runs and renders through the pack framework
([ADR-0029](../../../../dev/decisions/0029-mini-app-packs-and-sdk.md), plan 26).

```
src/packs/
├── mini-calc/               code pack (Tier 1): launcher calculator mode
│   ├── pack.ts              manifest (id, capabilities, contributions, i18n)
│   ├── evaluate.ts          pure logic the app shares with the command layer
│   └── renderer.ts          renderer binding: mode chrome + live behavior
├── mini-translate/          code pack (Tier 1): translate pad
│   ├── pack.ts              manifest + config schema (target, debounce)
│   └── renderer.ts          binding + live translation hook
├── file-deletion-review/    data pack (Tier 0): the reference assessment app
│   └── pack.json            pure declarative manifest — scan→classify→decide→compose→propose
├── index.ts                 MAIN registration: manifests + host command bindings
└── renderer.ts              RENDERER registration: renderer bindings + live-state runner
```

## Adding an app

1. Create `src/packs/<id>/` with a manifest (`pack.ts` via the SDK
   builders, or `pack.json` for pure data — see the
   [authoring guide](../../docs/dev/pack-authoring.md)).
2. Code apps: add `renderer.ts` and register it in `renderer.ts` (root).
3. Register the manifest in `index.ts` (root). Command executor
   bindings go in `SURFACE_COMMAND_BINDINGS` there.
4. `npm run app-pack -- validate` your manifest; CI re-validates every
   manifest in this directory automatically.
5. Boot installs/updates bundled packs (a newer shipped version
   upgrades in place; user removals are never clobbered).

Importable **third-party packs** are data-only (Tier 0): a single JSON
file, no code, `net` denied. The full authoring guide — every
capability, pipeline step, condition operator, report component, the
typed error model, examples, testing and debugging — is
[docs/dev/pack-authoring.md](../../docs/dev/pack-authoring.md).
