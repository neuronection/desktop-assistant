# The hub (dock, quick actions and Studio)

Plan 65/66 built one hub surface for speech and nearby actions. The
speech state machine did not change: the hub reads the same
`SpeechSnapshot` / `LiveSnapshot` and runs actions through main.

## Pieces

| Piece | Where |
|---|---|
| Catalog (ids, defaults, presets, normalization) | `src/shared/hub.ts` |
| Config keys (flat under `voice`) | `src/shared/config/AppConfig.ts`, `VoiceSettings` in `src/shared/types.ts` |
| Action execution | `src/main/hub/HubService.ts` |
| IPC | `src/main/ipc/hub.ts` + `src/shared/ipc/registry.ts` (`hub` scope) |
| Dock geometry | `src/shared/speechHud.ts` (`SpeechHudDock`) |
| Dock UI | `src/renderer/speech-overlay-react/SpeechHud.tsx` (`SpeechHudEdge`) |
| Popover window | `src/main/window.ts` + `src/shared/constants/window.ts` |
| Popover UI | `src/renderer/hub-popover/` (`hub-popover.html` entry) |
| Settings | `src/renderer/settings-react/tabs/HubTab.tsx` |
| Studio CSS | `src/renderer/styles/speech-hud.css` (`data-preset`, `data-motion`) |

## Action model

The configurable catalog is closed:

`live-toggle`, `translate-selection`, `speak-selection`, `dictate`,
`open-assistant`, `hide-hub`.

`hubQuickActions` is the ordered popover list. The dock is
manifest-driven (`src/shared/hubControls.json`): each state shows exactly
its controls — idle keeps hub/open-assistant/dictate/live, speech shows
pause/stop,
dictation swaps to send/stop in the same rail, and live shows
interrupt/end-live. A `stop` resolver condition marks "cancel dictation
or stop speech", so one Stop control serves both modes. While the quick
turn is thinking/streaming, dictate and live are withheld so a dead start
cannot be clicked; selection actions (translate/speak) are
dock/popover/menu/dot when a selection or clipboard text exists (a
clipboard fallback applies when the primary selection is empty), and
hidden otherwise — speech, dictation and live keep only their own three
controls. Unknown and duplicate ids are
dropped by the schema, and a list that is too long is capped —
configuration can never inject a command.

The **dot** renders the same manifest on its `dot` surface: hovering the
orb reveals a strip of knob-style glass buttons ordered by
`voice.hubDotActions` (default Speak selection → Dictate → Live-toggle,
closed to those three ids). While dictating, the strip auto-expands with
Send/Stop and the orb ring tracks `--hud-mic-level`. Session states keep
the orb's click semantics (stop / interrupt / end) and empty the strip.
The dot window envelope always hosts the open strip (`HUD_DOT_STRIP`,
132 × 48 at the default pad), so hover never resizes the frameless
window; the strip opens toward screen center (`data-dir` from
`speechHudDotXRatio`).

`HubService` still serves the **fixed** `speech-toggle`, `speech-stop`,
`live-interrupt` and `live-end` actions through `hub:run` — a single
scope check covers every action — but the popover no longer renders
built-in playback buttons: playback belongs to the dock-state manifest.
The fixed actions and the dormant `transport-popover.html` surface (with
its `transport` IPC scope) remain reserved for future mini-app action
surfaces. The response text exposes a hover-only **Copy** chip; it
copies the displayed dock text and is not the desktop-selection action.

The HUD right-click menu is the native `buildSpeechHudMenuTemplate`:
assistant, **HUD settings** (Hub tab), **Speech settings** (Voice tab),
Look, Size (Compact/Comfort/Large plus Custom → HUD settings), quick
actions, hide and keep-on-screen. Size choices go through
`updateSpeechHudVoice`, which applies the same config write and one-time
overlay recreation as Settings.

Everything executes in `HubService`:

- **Selection actions** re-read the primary selection in main, trim it to
  `selectionMaxChars`, and call the audited translation service or the
  speech bus. The popover hides them until `getHubActions` reports a
  selection; the dock never offers them. The renderer only sends the
  action id.
- **Live** uses `HotkeyService.triggerStartLive/EndLive`, the same seam
  the tray and hotkeys use.
- **Dictate** stays in the HUD while the edge dock or the dot is up:
  `WindowManager.startDictation()` pushes `hud:start-dictation` for both
  styles; the
  overlay owns its `RecordingManager`, swaps the manifest controls to
  Quick actions/**Send**/**Stop** (Stop cancels the recording) — on the
  dot they appear in the hover strip —,
  transcribes on send, and starts a main-owned turn in the **Voice
  questions** conversation. The reply
  streams into the dock and is spoken through the speech bus. The
  launcher event (`launcher:start-dictation`) is only the fallback when
  no edge HUD is available.
- **Open assistant** shows the launcher; it is also a fixed idle dock
  segment (priority 97, between the chevron and the mic).
- **Hide hub** sets a transient `hubHidden` bit in `WindowManager`;
  **Show the HUD** in the tray clears it and force-shows the HUD.
- Results are pushed as `hub:result` to the overlay (dock preview) and
  the popover (full result). `HubService` keeps the last readable result;
  clicking the dock line or the result's Open button runs
  `hub:activate-result`, which shows the launcher and sends
  `launcher:open-with-text` so the composer receives the text selected.
- `hub:busy` (`{ id, active }`) surrounds translation and speech
  preparation; the overlay renders **Translating…** with a violet border
  pulse (text/buttons stay normal), and the panel shows a spinner. The
  live host sends normalized mic RMS through `live:level`; main forwards
  it as `live:mic-level` to the overlay. The outer border
  brightens/expands with the same value, so silence and sound stay
  visibly different.

## IPC

| Channel | Direction | Scope |
|---|---|---|
| `hub:open` / `hub:close` | send | overlay / hub |
| `hub:get-actions` | invoke | hub |
| `hub:run` | invoke | hub |
| `hub:run-quick` | send | overlay |
| `hub:copy` | send | hub |
| `hub:open-settings` | send | hub |
| `hub:activate-result` | send | overlay, hub |
| `hub:busy` | event | overlay, hub |
| `hub:check-selection` | send | overlay |
| `hub:selection` | event | overlay |
| `live:level` | send | live-host |
| `live:mic-level` | event | overlay |
| `hub:result` | event | overlay, hub |
| `launcher:start-dictation` | event | launcher |
| `launcher:open-with-text` | event | launcher |

`hub` is derived from the `hub-popover.html` URL in `scopeFromUrl`; the
popover has no provider SDK and never touches the clipboard — main copies.

## Window behavior

The popover is a 340×400 transparent, non-focusable, `skipTaskbar`
window created lazily and shown inactive beside the overlay's bounds
(dock side aware, clamped to the work area). It hides when another window
gains focus, when the HUD hides, and on close. Late results are owned by
main, so closing the popover never cancels a translation.

The dock uses `speechHudBox(style, side, dock)` for the transparent
window envelope and `speechKnobGeometryFor` for the visible face.
`HUD_SIZE_TOKENS` defines Compact (204 px face, 22 px controls, 11 px
text), Comfort (220/22/12, default) and Large (240/26/13); the envelope
and face heights are derived from the text/control metrics (Comfort is
240 × 97). `SpeechHudTextContent` remains `empty`, `single` and `multi`;
the three-line face is 77 px at Comfort. The face attaches to the docked
edge. This avoids X11 window recreation per text change while keeping an
empty dock small. The whole window stays interactive; do not toggle
`setIgnoreMouseEvents` from forwarded pointer moves — on X11 the pointer
can stop re-entering and the HUD becomes unclickable. Edge drag uses
absolute screen points and the current preset's common envelope; the
face previews a new side through
`hud:edge-preview` while the same window moves, so X11 never recreates it
mid-drag. The target edge is the central 80% (10% inset at both ends)
within 32 px; corners cannot qualify. A switch needs 150 ms dwell,
24 px of drag and a 300 ms cooldown; the side just left is blocked until
the pointer clears 48 px. `Escape` cancels via `speech:hud-drag-cancel`;
the drop persists side + ratio and broadcasts to Settings. The card uses
the same seam (corner snap on drop) and its body is a real button —
pause/resume in speech, interrupt in live — so the whole card never sits
in a native drag region. The controls
are one full-width segmented rail fused into the HUD border in every
state, with per-segment hit areas; the first/last segments reserve a
10 px icon inset so the rounded HUD caps do
not crop them. They move only when the face
switches between the empty/single/multi modes, never while text changes
within one mode. An empty dock collapses to the control strip (25 px at
Comfort), a single line is 48 px with breathing room above the rail, and
the three-line face is 77 px — all inside the fixed 240 × 97 envelope.
Because X11 ignores size changes on a
`resizable: false` frameless window, a size preset or Custom Apply goes
through `applySpeechHudStyle()` and recreates the overlay once at the new
envelope. Text/selection changes never resize the OS window.

## Studio

`hudPreset` is one of `pulse`, `aurora`, `minimal`, `snake`, `terminal`.
The preset is a `data-preset` attribute on `.hud-stage`; CSS supplies
tokens, ring animations and typography. It cannot change click behavior,
window bounds or IPC. `hudMotion` adds `data-motion="off"` (all decorative
animations stop); `prefers-reduced-motion` is honored independently.
`hudSizePreset` (`compact | comfort | large | custom`) and
`hudCustomSize` drive the card/dock text scale, face width, control size
and envelope. The previous `hudTextScale`/`hubDockWidth` values migrate
into Custom on first read. Custom is applied once from Settings; sliders
never resize the frameless window live. The launcher transcript action
row uses the same rail language at 22 px visual / 24 px hit in
`chat-app.css`.
The wide dock hides the waveform bars so the line owns the width; the
text area uses up to three lines and the controls stay centered in the
derived envelope (window width = face width + 20 px glow pad: 224/240/260
at Compact/Comfort/Large). A shipped JSON manifest (`src/shared/hubControls.json`)
declares each control's surface, conditions and priority; the resolver
feeds the dock. The popover paginates at four actions. The conditions are
a closed vocabulary (`audio`, `live`, `dictating`, `working`, `selection`,
`stop`), not user-authored expressions. Aurora/Snake rings are a
separate `.hud-ring` layer: the face no longer clips them, and a
side-aware mask fades the ring to transparent on the docked edge so it
never reads as a square cut line. The outer halo is directional for edge
docks for the same reason. The manifest adds and removes controls per
state, and the knob face never translates on hover; the hover state is a
border/glow only, so controls only move when the mode changes.

Shipped v1 intentionally exposes presets plus typed toggles rather than a
general rule editor. The data model for per-style typed rules is a
follow-up; no arbitrary CSS, scripts or window actions are ever accepted.

### Current deviations

- **Studio:** presets plus typed toggles; the full per-style typed rule
  editor is deferred. There is no arbitrary CSS or scripting surface.
- **App shortcuts / hover preview:** deferred. Quick actions are the
  closed catalog above; the dock's hover preview is not implemented.
- **Transport surface:** the `transport-popover` renderer and its window
  plumbing are retained as the reserved home for future mini-app transport
  actions; no current HUD state opens it.
- **Dot strip:** the dot window reserves a fixed transparent strip beside the orb for its hover actions (the X11 fixed-envelope trade-off); it is part of the window and is not click-through.
- **Control targets:** the wide dock uses 22 px controls and the compact
  dock 16 px. The dock shows at most six controls (hub, open assistant,
  dictate, live, translate, speak) when idle with text available; speech,
  dictation and live show their own small sets, and a HUD-initiated turn
  shows **Stop reply** (`cancelTurn`).
- **Chat-visible result fallback:** the dock trigger (and its native menu)
  is hidden while a chat surface is visible, so no OS notification path
  is currently wired. The popover remains the result surface when open.

## Tests

- `tests/hub-service.test.ts` — catalog order, availability, every
  action, errors, fixed controls, unknown ids.
- `tests/hub-popover.test.tsx` — action list, result surface, no
  built-in playback controls, settings/close.
- `tests/settings-hub.test.tsx` — appearance, popover and dot action
  ordering, Studio, results, a11y.
- `tests/speech-hud-styles.test.ts` — wide geometry; compact unchanged.
- `tests/speech-hud-variants.test.tsx` — manifest-driven dock controls,
  the dot action cluster, dictation Send/Stop, quick STT, text faces,
  mic level.
- `tests/e2e/hub.spec.ts` — real app: three-line dock, preset, manifest
  controls, popover open/close/action.
- `tests/speech-hud-visibility.test.ts` — one visibility decision; the
  card is session-only even when pinned.
