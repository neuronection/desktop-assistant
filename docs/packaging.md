# Packaging & releases

How Desktop Assistant is packaged today, and where it is heading under
the family release standard.

## Current build

```bash
npm run dist     # prisma generate + main + renderer build, then electron-builder
```

Configuration: `electron-builder.json` — appId
`io.neuronection.desktop-assistant`, productName "Desktop Assistant".

| Platform | Target | Artifact |
|---|---|---|
| Linux | AppImage + deb | `release/Desktop Assistant-*` |
| Windows | NSIS | installer exe |
| macOS | DMG | disk image |

### What gets packed

- `dist/**` (compiled main, preload, renderer)
- `prisma/schema.prisma` (extraResources)
- `src/generated/client` filtered to `*.node` (Prisma query engines —
  `binaryTargets` in `prisma/schema.prisma` controls which platforms)
- `src/main/resources/**` (runtime SQL bootstrap)
- `assets/**` (icons, demo assets)

Anything else the app reads at runtime must be added to
`files`/`extraResources` or it will work in dev and break packaged
(classic failure mode — see the debugging skill).

### Data dir conventions

Runtime data resolves under the OS user-data directory (XDG-style on
Linux). The `DESKTOP_ASSISTANT_DATA_DIR` env override redirects config,
secrets and the database — used by tests and the CI packaged-bundle smoke
test.

## Release process (family standard, tag-driven)

1. Version: `python3 scripts/version_manager.py bump …` (family-unified
   script; config in `version_manager.toml` — version source
   `package.json`, propagates to the lockfile and the README badge).
2. Tag: push `vX.Y.Z` (must equal the declared version — CI asserts the
   shape too: `vX.Y.Z` or `vX.Y.Z-rc.N`). **rc tags publish as GitHub
   prereleases automatically.**
3. `release.yml` builds all three platforms in CI: verify gate →
   electron-builder (AppImage/deb, NSIS x64, DMG **arm64 + x64**) →
   **packaged smoke test on every platform** (frozen bundle +
   `--smoke` readiness flag + throwaway `DESKTOP_ASSISTANT_DATA_DIR`,
   must print `SMOKE_OK`; Windows uses `--enable-logging` because the
   GUI subsystem has no stdout) → `SHA256SUMS.txt` → artifacts
   published on the GitHub release.
4. The workflow re-runs safely: tag/version assertion, per-job
   timeouts, a per-tag concurrency group, `if-no-files-found: error`
   artifact checks and `fail_on_unmatched_files` make partial or
   mismatched releases fail loudly instead of publishing garbage.

Releases run only in CI; local `npm run dist` is for testing packaging.

## Known limitations

- **No code signing** (Windows/macOS): org certificates don't exist yet;
  SmartScreen/Gatekeeper warnings are expected. The release workflow
  already wires the standard hooks (`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`,
  `MACOS_CSC_LINK`/`MACOS_CSC_KEY_PASSWORD` repo secrets) and they stay
  inert until the secrets exist — signing then turns on with zero
  workflow changes. Notarization needs a small `notarize` config addendum
  when Apple credentials arrive.
- **No auto-update** yet (electron-updater decision deferred — revisit
  when a second Electron product exists, family two-app rule).
- The `.env` file is dev/CLI-only; packaged builds never read it.
