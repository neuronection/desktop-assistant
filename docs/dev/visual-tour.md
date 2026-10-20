# Demo tour captures

How the README GIF, the screenshot gallery (`docs/SCREENSHOTS.md`) and
`docs/images/tour.manifest.json` are regenerated for Desktop Assistant —
the reproducible product presentation embedded in the README, the docs and
the Neuronection website. The pipeline lives in `scripts/ui-capture/`
(family-standard vendored runner + this repo's config and scene catalog).

Desktop Assistant is an Electron app whose renderer needs the main
process, so captures attach to the **real running app** over the DevTools
protocol — no separate browser, real windows, real IPC, demo content
seeded in-process by the `--demo` boot flag (isolated `userData/demo`
directory, three synthetic conversations).

## Regenerating the tour

One command starts the whole stack (vite, the three local demo services,
a **fresh** demo app) and builds screenshots → gallery → manifest → GIF:

```bash
./scripts/ui-capture/run-demo-capture.sh
# same via npm:
npm run capture:tour
# single chapter / strict mode:
./scripts/ui-capture/run-demo-capture.sh --scene launcher-search --strict
```

The script:

1. builds the main process, reuses vite on :3300 (or starts it);
2. starts `mock-translate.mjs` (:8333), `mock-assistant.mjs` (:8334) and
   `mock-search.mjs` (:8335);
3. launches `electron . --remote-debugging-port=9222 --demo --demo-fresh`
   (the fresh flag wipes only the isolated demo workspace);
4. runs `./scripts/capture_ui.sh`;
5. stops only the processes it started.

Logs: `/tmp/desktop-assistant-{vite,demo,mock-*}.log`.

### Manual recipe (advanced)

```bash
npm run build:main-dev && npm run dev:renderer          # :3300
node scripts/ui-capture/mock-translate.mjs &            # :8333
node scripts/ui-capture/mock-assistant.mjs &            # :8334
node scripts/ui-capture/mock-search.mjs &               # :8335
DESKTOP_ASSISTANT_OPAQUE=1 \
  npx electron . --remote-debugging-port=9222 --demo --demo-fresh
./scripts/capture_ui.sh
```

## How the storyboard works

- **Scenes are chapters, beats are frames.** `scenes.mjs` declares each
  chapter and its `beats` (`actions`, optional `waitForSelector`,
  `settleMs`, `holdMs`, `still`, `caption`). Every beat is captured as
  `<scene>-<viewport>--<beat>.png`; the chapter still is the beat marked
  `still: true` (default: the last one). Scenes without beats keep the
  old one-shot behavior; manifests without `frames` still build a GIF.
- **Auto-sized launcher viewports.** Launcher viewports in
  `ui-capture.config.json` use `"height": "auto"`: cdp captures never
  emulate — the runner waits for the app's content-driven window to
  settle and screenshots the real window. No hardcoded launcher heights,
  no clipped meta strip or panel. Desktop (`1080×720`) and settings
  (`880×780`) are fixed-size windows and are resized through the app's own
  IPC before the scene.
- **Real turns, scripted content.** The demo config provisions a local
  `demo-local` provider (model `demo-assistant`) and a local SearXNG
  provider, so `launcher-ask` actually sends and streams a reply, and
  `launcher-search` runs a real `web_search` tool call whose results come
  from `mock-search.mjs`. The mock assistant pauses briefly inside the
  plain answer so the streaming frame is captured after the window has
  settled.
- **Per-frame GIF timing.** `tour.manifest.json` v2 carries the frame
  list with `holdMs`; the assembler builds an ffmpeg concat list with
  explicit durations (typing frames short, answers long) and pads the
  shared canvas transparently.

## What gets committed

- `docs/images/*.png` (chapter stills + `--beat` frames) +
  `docs/images/visual-tour.gif` + `docs/images/tour.manifest.json` — all
  generated, all committed.
- `docs/SCREENSHOTS.md` — the generated gallery (chapter stills plus a
  storyboard section per chapter), registered in `docs/docs-tree.json`.
- Scenes live in `scripts/ui-capture/scenes.mjs`: add a window/flow =
  add a scene (and beats); `narration` feeds the future AI-video tour.
- The website vendors the manifest + referenced stills/frames
  (`sync-tours.mjs`) and offers Story scrollytelling with Play as the
  manifest player (mobile default); README keeps the GIF as the no-JS
  fallback.

## Notes

- The `--demo` instance locks its own userData (`…/demo`), so it runs
  alongside a normal instance without conflict; `--demo-fresh` must not
  be used while another demo instance is running (single-instance lock).
- Recommended system tools (otherwise the GIF step is skipped and PNGs
  stay large): `pngquant`, `gifsicle`, `ffmpeg`.
- Single scene / strict mode / gallery-only rebuilds still work directly:
  `./scripts/capture_ui.sh --scene launcher-ask`, `--strict`,
  `--gallery-only`.

Recapture on every release and whenever the UI changes visibly —
screenshots are documentation and follow the same-commit rule.
