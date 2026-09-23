# Renderer and windows

Two renderer entries share one React 19 + Tailwind v4 +
`@neuronection/assistant-ui` stack:

- `src/renderer/index.html` + `chat-react/` — the launcher overlay and the
  desktop window (one bundle, two modes).
- `src/renderer/settings.html` + `settings-react/` — the settings window.

The canonical window model is in
[architecture.md](architecture.md#windows); this page is the working map.

## Renderer layout

```
src/renderer/
├── index.html + chat-react/     launcher + desktop (mode via ?mode=desktop)
├── settings.html + settings-react/  settings (SettingsShell, tabs/, apps/, tools/)
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
| `Composer.tsx`, `ApprovalCard.tsx`, `FlowCard.tsx`, `DownloadCard.tsx`, `TraceStrip.tsx`, `Inspector.tsx`, `CommandPalette.tsx` | UI surfaces |

**Turn logic is main-owned.** The renderer never orchestrates turns, builds
history, or persists messages — it renders the event stream from
`ai:turn-event` and sends intents. Keep it that way.

## The two windows

- **Launcher** — frameless, rounded, transparent (glass corners), always
  on top, `resizable: false`. It grows to fit content: a ResizeObserver
  measures the chrome and `launcherLayout.ts` owns the height budget. The
  composer caps itself (`max-h-40`) and scrolls internally.
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
  clamp against it.
- Popups can't escape the window. Render popover-ish surfaces (attach
  menu, launcher menu, notice banner, approval card) **in flow** so the
  measured window grows; fixed-position overlays clip.

### Dialog guard

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
- Every new panel gets an axe scan in `tests/a11y-settings-app.test.tsx`.

Theme is applied through `theme.ts` re-mapping `--as-*` tokens from
assistant-ui. Keep the presentational boundary — see the family
`family-ui` / `da-assistant-ui` skills before creating components.

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

## The look

Frameless + rounded corners is a hard product trait. Transparency is
progressive enhancement — never regress rounded corners when touching
`window.ts`. A CSS `box-shadow` on a full-window root paints into the
rounded-corner notches; the window edge comes from the root `border`.
