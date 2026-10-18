# Mini-app packs

This directory holds the app's **bundled mini-app packs** — one
directory per app. A pack is a validated manifest (plus, for bundled
code apps, host bindings) that the desktop assistant installs,
configures, runs and renders through the pack framework
([ADR-0029](https://github.com/neuronection/dev/blob/main/decisions/0029-mini-app-packs-and-sdk.md), plan 26).

Every pack carries its manifest as **`manifest.json` at the pack
root** — the family file form (never code-declared, never a second
filename).

```
src/packs/
├── mini-calc/               code pack (Tier 1): launcher calculator mode
│   ├── manifest.json        manifest (id, capabilities, contributions, i18n)
│   ├── evaluate.ts          pure logic the app shares with the command layer
│   └── renderer.ts          renderer binding: mode chrome + live behavior
├── mini-translate/          code pack (Tier 1): translate pad
│   ├── manifest.json        manifest + config schema (target, debounce)
│   └── renderer.ts          binding + live translation hook
├── file-deletion-review/    data pack (Tier 0): the reference assessment app
│   └── manifest.json        pure declarative manifest — scan→classify→decide→compose→propose
├── index.ts                 MAIN registration: manifests + host command bindings
└── renderer.ts              RENDERER registration: renderer bindings + live-state runner
```

## Adding an app

1. Create `src/packs/<id>/` with a `manifest.json` (hand-author the
   JSON, or scaffold it with `npm run app-pack -- init` and edit —
   see the
   [authoring chapter](../../docs/dev/sdk/authoring-and-configuration.md)).
2. Code apps: add `renderer.ts` and register it in `renderer.ts` (root).
3. Register the manifest in `index.ts` (root). Command executor
   bindings go in `SURFACE_COMMAND_BINDINGS` there.
4. `npm run app-pack -- validate` your manifest; CI re-validates every
   manifest in this directory automatically.
5. Boot installs/updates bundled packs (a newer shipped version
   upgrades in place; user removals are never clobbered).

Importable **third-party packs** are data-only (Tier 0): a
`manifest.json` bundle, no code, `net` denied. The full authoring
reference — every capability, pipeline step, condition operator,
report component, the typed error model, examples, testing and
debugging — is the
[pack SDK doc set](../../docs/dev/sdk/overview.md).
