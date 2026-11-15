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

- `dist/**` (compiled main, preload, renderer — includes the compiled
  generated Prisma client from `src/generated/prisma`; every renderer
  entry `vite.config.ts` builds must be here, and the smoke asserts it)
- `prisma/schema.prisma` (extraResources; nothing reads it at runtime —
  boot uses `resources/schema.sql`)
- the runtime contracts (extraResources): `contracts/cloud-providers.json`
  plus `src/main/resources/**` (SQL bootstrap + the sandbox child)
- `src/packs/*/docs` + their `docs-tree.json` (pack documentation the
  renderer reads)
- `assets/**` (icons, demo assets) — including the per-platform tray
  icons (`tray-icon.ico` on Windows, `tray-icon.png` on Linux, and
  `tray-iconTemplate.png` + `@2x` on macOS, which the menu bar tints)

Prisma 7 note: there are no query-engine binaries to ship (the Rust
engine is gone; the client uses the TypeScript query compiler plus the
`@libsql/client` N-API driver, whose prebuilt native module ships in
`node_modules` and is ABI-stable across Node and Electron — no
rebuild-for-Electron step exists or is needed).

**One native binary per OS *and* CPU.** `@libsql/*` packages are
`optionalDependencies`, so `npm ci` installs only the build host's arch.
A cross-built target silently packs without its binary and dies at the
first database open. The mac job therefore installs both
`@libsql/darwin-{arm64,x64}` (version read from the installed `libsql`)
before packaging, and `scripts/assert-packed-arch.mjs` asserts the
packed asar carries every path per artifact. Linux/Windows build their
native arch, so no extra step is needed there.

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
   `package.json`, propagated to `package-lock.json`; the README carries
   a live shields.io release badge, so nothing there needs bumping).
2. Tag: push `vX.Y.Z` (must equal the declared version — CI asserts the
   shape too: `vX.Y.Z` or `vX.Y.Z-rc.N`). **rc tags publish as GitHub
   prereleases automatically.**
3. `release.yml` builds all three platforms in CI: verify gate →
   electron-builder (AppImage/deb, NSIS x64, DMG **arm64 + x64 in one
   run** — both arches must share one `latest-mac.yml`, which is what
   the updater reads) → native-module assertion per artifact →
   **packaged smoke test on every platform** (frozen bundle + `--smoke`
   readiness flag + throwaway `DESKTOP_ASSISTANT_DATA_DIR`, must print
   `SMOKE_OK`, `SMOKE_CATALOG_OK`, `SMOKE_BRIDGE_OK` and
   `SMOKE_RENDERERS_OK` — the last one loads every renderer entry from
   the bundle, so a page that failed to ship fails the release instead
   of printing one console line; Windows uses `--enable-logging`
   because the GUI subsystem has no stdout) → `SHA256SUMS.txt` →
   artifacts published on the GitHub release.
   The Linux job runs the full `npm run verify` (all suites + coverage
   floors); Windows and macOS run the toolchain gate only (prisma
   generate + lint + typecheck + build), because the vitest suite still
   has win32/mac portability gaps — every platform still smoke-tests
   its frozen bundle.
4. The release body is the `## [<version>]` section of `CHANGELOG.md`,
   cut by the workflow (`body_path`) — never GitHub's commit digest, which
   advertised dependabot bumps as "what's new". A missing or empty section
   fails the publish job.
5. The workflow re-runs safely: tag/version assertion, per-job
   timeouts, a per-tag concurrency group, `if-no-files-found: error`
   artifact checks and `fail_on_unmatched_files` make partial or
   mismatched releases fail loudly instead of publishing garbage.
6. **After** the tag, verify the release-day surface by hand (the site
   feed is generated outside this repo): artifacts + `SHA256SUMS.txt`
   download, then `neuronection.com/api/v1/versions/desktop-assistant.json`
   reports the new `latestStable`, then the download page links the new
   files. Only then announce — until the feed regenerates, every installed
   app is told it is up to date.

Releases run only in CI; local `npm run dist` is for testing packaging.

## Known limitations

- **No code signing** (Windows/macOS): org certificates don't exist yet;
  SmartScreen/Gatekeeper warnings are expected. The release workflow
  already wires the standard hooks (`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`,
  `MACOS_CSC_LINK`/`MACOS_CSC_KEY_PASSWORD` repo secrets) and they stay
  inert until the secrets exist — signing then turns on with zero
  workflow changes. Notarization needs a small `notarize` config addendum
  when Apple credentials arrive.
- **Auto-apply is consent-gated everywhere, in-place on AppImage only**
  (amended same day to the wizard hand-off): Settings →
  About checks the family version API (neuronection.com). AppImage installs
  get the one-click in-place flow (download → restart-to-update, via
  electron-updater against the GitHub feed, after a cross-check that both
  sources agree). Windows/macOS/deb get the **wizard hand-off**: the
  official installer downloads (SHA256SUMS-verified), opens itself, and the
  user clicks through the native wizard — no certificates required, since
  the wizard is the consent UX. `latest*.yml` + blockmaps ship with every
  release so signed silent updates remain a config flip. A loopback
  E2E feed is available behind `DESKTOP_UPDATE_E2E=1` +
  `DESKTOP_UPDATE_E2E_URL` and never activates in production builds.
- The `.env` file is dev/CLI-only; packaged builds never read it.
