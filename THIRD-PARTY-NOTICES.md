# Third-party notices

Open-source projects this app bundles or downloads. Bundled code keeps its
license text in place next to the sources.

## Cactus Compute — Needle

The optional local decision engine (Settings → Tools → Decision, engine
"Local - Cactus-Compute | Needle 3") is built on the Needle project by
Cactus Compute (Apache-2.0):

- **Runtime** — vendored into the app at `src/main/resources/needle/`
  (`needle.js`, `needle.wasm`, `host.cjs`, `host-core.cjs`); the full
  Apache-2.0 text ships alongside it at `src/main/resources/needle/LICENSE`.
- **Weights** — `needle3.cact` (~35 MB, Apache-2.0), downloaded on first
  enable by the user, size- and sha256-pinned to revision
  `b009f8937124b2d0458f4ed040c10c41fd2a0dfc`, offline afterwards:
  <https://huggingface.co/Cactus-Compute/needle3>

Model card and upstream organization:
<https://huggingface.co/Cactus-Compute/needle3>

We thank the Cactus Compute contributors — the on-device, no-network
dispatch experience exists because of their work.
