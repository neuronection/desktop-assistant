# Renderer and windows

Five renderer entries share one React 19 + Tailwind v4 +
`@neuronection/assistant-ui` stack:

- `src/renderer/index.html` + `chat-react/` — the launcher overlay and the
  desktop window (one bundle, two modes).
- `src/renderer/settings.html` + `settings-react/` — the settings window.
- `src/renderer/pack-window.html` + `pack-window-react/` — the constrained
  mini-app report window.
- `src/renderer/result-viewer.html` + `result-viewer-react/` — the tool
  result viewer.
- `src/renderer/speech-overlay.html` + `speech-overlay-react/` — the
  speaking HUD and bus audio host (plan 58).

The canonical window model is in
[architecture.md](architecture.md#windows); this page is the working map.

## Renderer layout

```
src/renderer/
├── index.html + chat-react/     launcher + desktop (mode via ?mode=desktop)
├── settings.html + settings-react/  settings (SettingsShell, tabs/, apps/, tools/)
├── pack-window.html + pack-window-react/  constrained pack report window
├── result-viewer.html + result-viewer-react/  tool-result viewer
├── speech-overlay.html + speech-overlay-react/  speaking HUD + audio host
├── managers/                    app glue reused by both UIs
└── styles/                      tailwind entries + theme
```

Key chat-react modules:

| Module | Responsibility |
|---|---|
| `ChatApp.tsx` | Launcher; Escape ladder, `Ctrl+E`/`Ctrl+D`/`Ctrl+K`, window resize budget |
| `DesktopApp.tsx` | Desktop window (`?mode=desktop` branch in `main.tsx`) |
| `useChatSession.ts` | Shared session/turn wiring — never fork turn logic per window |
| `ipcTransport.ts` + chat-core `useChatStream` | Turn stream over the preload bridge |
| `launcherState.ts` | The launcher state machine reducer |
| `turnTraceStore.ts` / `turnEventsMap.ts` | Trace state; `TurnEvent.node` mapping (the library has no `resumed`) |
| `Composer.tsx`, `ApprovalCard.tsx`, `FlowCard.tsx`, `DownloadCard.tsx`, `Inspector.tsx`, `CommandPalette.tsx` | UI surfaces |
| `areas/LauncherMetaRow.tsx` + `TraceStrip.tsx` + `TraceStepList.tsx` | The persistent meta line above the composer; live status is one line, steps expand on demand |
| `LauncherMenu.tsx`, `RecentSpeechPanel.tsx`, `ShortcutsSheet.tsx` | In-flow launcher chrome: the ⋯ menu, the speech replay ring and the shortcuts cheat sheet (`Ctrl+/`, `hotkeys:shortcuts`, read live per open) |

**Turn logic is main-owned.** The renderer never orchestrates turns, builds
history, or persists messages — it renders the event stream from
`ai:turn-event` and sends intents. Keep it that way.

**Live conversation mode (plan 25)** follows the same rule: `useChatSession`
subscribes to `live:event`, routes VAD segment transcripts to
`live:phrase-committed` / `live:speech-detected` by session state, ducks
playback on a barge-in candidate, and speaks replies in live mode — but main
(`LiveSessionService`) owns the loop and decides transitions. The composer
renders the **Live** toggle, the live state indicator with a **Voice
interrupt** (half/full-duplex) toggle, the transient sent-transcript check,
and the opt-in ignored hint; the transcript box (`VoiceIndicator`) shows only
the current phrase. Escape stops the reply, then ends live mode (both
windows).

## The chat windows (launcher + desktop)

- **Launcher** — frameless, rounded, transparent (glass corners), always
  on top, `resizable: false`. It grows to fit content: a ResizeObserver
  measures the chrome and `launcherLayout.ts` owns the height budget. The
  composer caps itself (`max-h-40`) and scrolls internally. Auto-fit is
  measured, not animated natively: `launcherResize.ts` and
  `useLauncherResize.ts` coalesce observer output into one
  `window:resize` per meaningful height change. While a reply streams it
  may only grow; a shrink waits out the settle window. A new turn resets
  the panel budget to its chrome floor, so the previous reply's height is
  never inherited. Main applies one
  `setBounds` per request (`windowResize.ts`) — never a 60 fps easing
  loop, because every native resize on X11 is a configure/repaint
  round-trip and reads as flicker. An overflowing reply highlights the
  existing Expand icon in `ResponseFlow` rather than switching layout
  mid-read or adding a second CTA. Speak/desktop/expand live in a reserved
  header row above the scroll text; the panel height budget includes that
  row (`RESPONSE_ACTION_ROW_PX`), so actions never cover the reply.
  Entering expanded mode calls `scrollTranscriptToResponseStart`
  (`transcriptScroll.ts`) so the transcript starts at the latest reply
  (live row first, then the last assistant message), not at the top of
  the conversation.
- **Desktop** — full window with the session sidebar, transcript,
  inspector, and native OS resizing. Bounds and maximized state persist;
  it hides instead of closing.

### Drag vs resize

- `.chat-drag-root` is the drag region; only real controls opt out
  (buttons/inputs/textarea/`[data-no-drag]`). Never put `data-no-drag` on
  a padded container — it kills the grabbable margins.
- The launcher has no OS resize grips. Manual resize uses the in-app corner
  handles (`ResizeHandle.tsx`) streaming deltas over
  `window:resize-corner-*`; bounds math is `computeCornerResizeBounds`
  (`src/shared/constants/window.ts`). A manual drag suspends the
  auto-resize until the next send/dismiss.
- X11 trap under `resizable: false`: `setSize` is a no-op (use
  `setBounds`) and `getMaximumSize()` reports the current size — never
  clamp against it. Never resize the native window per animation frame:
  each `setBounds` is a configure/repaint round-trip. Measure first,
  coalesce, and apply one size per meaningful change.
- Popups can't escape the window. Render popover-ish surfaces (attach
  menu, launcher menu, notice banner, approval card) **in flow** so the
  measured window grows; fixed-position overlays clip.

## The speaking HUD (plan 58)

`speech-overlay.html` is the fifth entry and a **separate renderer
process** — the launcher hides instead of closing, but
`WindowManager.recreateMainWindow()` destroys and recreates it, which is
why bus audio can never live in the chat renderer. The window is created
lazily on first speak and kept alive afterwards; it is frameless, rounded,
`skipTaskbar`, `focusable: false` (keyboard control is the hotkeys and
tray by design), `resizable: false` and `backgroundThrottling: false`
(hidden-window timer throttling would corrupt the playback guards). The
options builder (`buildSpeechOverlayWindowOptions`) is pure and tested;
always-on-top is a post-creation `setAlwaysOnTop(true, 'floating')` call,
not a constructor flag.

- `SpeechOverlayApp.tsx` subscribes to `speech:play` / `speech:stop` /
  `speech:state` in the commit phase, pulls `speech:snapshot` once (a
  newer event wins), and on mount resyncs the current chunk through
  `speech:current-chunk` — that is the crash-recovery resume-at-chunk
  path.
- `playback.ts` owns the audio element: one per chunk, generation-guarded
  events, a 10 s start guard, AbortError-on-pause treated as **paused**
  (never a chunk end), and a 5 s progress watchdog for a vanished output
  device (the browser fires nothing when Bluetooth drops mid-chunk).
- `SpeechHud.tsx` is the card: current chunk text as the primary line,
  `n of total` in the `role="status"` live region, a CSS waveform, and
  pause/resume + stop (always visible; disabled controls dim while idle).
  Every label comes from `TEXT`. The
  HUD is mouse-only; its accessibility contract is the keyboard parity
  table in the user docs plus the axe scan.

## Dialog guard

Any flow that opens a native dialog (file picker, save dialog) must wrap in
`beginDialog()` / `endDialog()` from `chat-react/dialogGuard.ts`, or
hide-on-blur closes the window mid-dialog.

## Settings UI

- Every sub-navigation is the library `SegmentedTabs` — never hand-roll a
  `role="tablist"`.
- Panels are app-owned `role="tabpanel"` with `aria-label`; a panel
  holding a single section renders **flat** (no border box).
- Tabs: General, API Settings (providers/models/tasks), Voice, Tools
  (tools/folders/memories/usage/web search/translation/decisions), Apps
  (apps/settings + detail modal connection/tools/scope), Commands,
  Hotkeys, Automation, About.
- Dropdowns are the library `Combobox`, never a native `<select>`: native
  popups are OS-drawn and ignore the app theme. Use the shared
  `SelectField` (`settings-react/tabs/fields.tsx`) — label + combobox +
  hint — or `Combobox` directly for label-less/compact cases.
- Every new panel gets an axe scan in `tests/a11y-settings-app.test.tsx`.

Theme is applied through `theme.ts` re-mapping `--as-*` tokens from
assistant-ui. Keep the presentational boundary — see the family
family UI guidelines and the local assistant-ui notes before creating components.

## Strings

Every user-facing string routes through
`src/shared/constants/text.ts` (`TEXT` + `interpolate` / `pluralize`).
No display literals in components — this keeps i18n adoption mechanical.
The `scripts/translations/` tooling enforces completeness.

## Accessibility

The axe scans (`tests/a11y-*.test.tsx`) are the family bar: keep them
violation- and exclusion-free. New surfaces ship with a scan in the same
commit. Keyboard-map behavior (Escape ladder, `Ctrl+E`/`Ctrl+D`,
`Enter`/`Shift+Enter`) is regression-tested in the same files.

## Renderer event subscriptions

Every `window.electronAPI.on*` subscription registers in an effect whose
deps are **stable**. When the callback closes over render values, hold
them in a `useLatestRef` and register once (deps `[]` or the stable ref)
— a subscription that re-registers on every render tears the listener
down and races the gap between remove and re-add. The turn-event bridge
follows the same rule: `useChatSession` builds **one** stable transport
whose hooks read a ref, and `ipcTransport.subscribe` is idempotent (a
single Electron listener; a re-subscribe swaps the handler, and a stale
unsubscribe cannot detach a newer one). The lifecycle is pinned by
`tests/ipc-transport-subscription.test.ts`; the buffered-delta path is
pinned by the flush-on-finish test in `tests/chat-stream-repro.test.tsx`.

## The look

Frameless + rounded corners is a hard product trait. Transparency is
progressive enhancement — never regress rounded corners when touching
`window.ts`. A CSS `box-shadow` on a full-window root paints into the
rounded-corner notches; the window edge comes from the root `border`.
