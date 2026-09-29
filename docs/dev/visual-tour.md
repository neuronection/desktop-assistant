# Demo tour captures

How the README GIF, the screenshot gallery (`docs/SCREENSHOTS.md`) and
`docs/images/tour.manifest.json` are regenerated for Desktop Assistant —
the reproducible demo presentation embedded in the README, the docs and
the Neuronection website. The pipeline lives in `scripts/ui-capture/`
(family-standard vendored runner + this repo's config and scene catalog).

Desktop Assistant is an Electron app whose renderer needs the main
process, so captures attach to the **real running app** over the DevTools
protocol — no separate browser, real windows, real IPC, demo content
seeded in-process by the `--demo` boot flag (isolated `userData/demo`
directory, three synthetic conversations).

## Regenerating the tour

Three terminals:

```bash
# 1. compile the main process + start the renderer dev server (:3300)
npm run build:main-dev && npm run dev:renderer

# 2. launch the app with demo data and remote debugging (opaque window
#    screenshots better than the default transparent frame)
DESKTOP_ASSISTANT_OPAQUE=1 npx electron . --remote-debugging-port=9222 --demo

# 3. optional but recommended: the local demo translate service (the
#    translate pad's deterministic demo engine; the demo config points at it)
node scripts/ui-capture/mock-translate.mjs &

# 4. capture: screenshots → gallery → manifest → GIF
./scripts/capture_ui.sh
```

Notes:

- The `--demo` instance locks its own userData (`…/demo`), so it runs
  alongside a normal instance without conflict.
- Viewports mirror the real window sizes (launcher bar 650 px, desktop
  chat 1080×720, settings 880×780); viewport emulation resizes the
  captured content, not the OS window.
- Single scene / strict mode / gallery-only rebuilds:

  ```bash
  ./scripts/capture_ui.sh --scene launcher
  ./scripts/capture_ui.sh --strict
  ./scripts/capture_ui.sh --gallery-only
  ```

- Recommended system tools (otherwise the GIF step is skipped and PNGs
  stay large): `pngquant`, `gifsicle`, `ffmpeg`.

## What gets committed

- `docs/images/*.png` + `docs/images/visual-tour.gif` +
  `docs/images/tour.manifest.json` — all generated, all committed.
- `docs/SCREENSHOTS.md` — the generated gallery, registered in
  `docs/docs-tree.json`.
- Scenes live in `scripts/ui-capture/scenes.mjs`: add a window/flow =
  add an object; per-scene `narration` lines feed the future AI-video
  tour.

## After the first capture (one-time wiring)

1. Register the gallery in `docs/docs-tree.json` — a "Visual Tour" item
   (`file: "SCREENSHOTS.md"`) in the user guide's *Start here* category,
   and mirror it in `docs/user/README.md`.
2. Embed the GIF in `README.md` under the header (replacing the
   flow-UI screenshot placeholder noted in `docs/STATUS.md`):

   ```html
   <a href="docs/SCREENSHOTS.md"><img src="docs/images/visual-tour.gif" width="800" alt="Desktop Assistant visual tour"></a>
   ```

Recapture on every release and whenever the UI changes visibly —
screenshots are documentation and follow the same-commit rule.
