## [Unreleased]

### The HUD's three roles (plans 65/66 follow-up)
- **The card is clickable.** Clicking the card line pauses/resumes a reply
  and interrupts live, exactly like the knob; dragging the card still
  moves it (corner snap on drop). All styles now share the custom drag
  seam, so no HUD surface sits in a native drag region that swallows
  clicks.
- **One-click launcher from the knob.** The idle dock gains a fixed
  **Open assistant** segment (second from the left), so the launcher is
  one click away without opening the quick-actions panel.
- **The dot gains action buttons.** Hovering the 28 px orb opens a strip
  of the knob's glass buttons — Speak the selection, Dictate, Start/stop
  live — extending toward screen center. The buttons have their own
  ordered configuration (**Settings → Hub → Dot buttons**), separate from
  the popover list. While dictating, the strip stays open with
  **Send**/**Stop** and the orb's ring carries the listening tint; the
  click behavior for active sessions (stop a reply, interrupt or end
  live) stays on the orb. Dictation now runs inside the dot like it does
  in the dock — the launcher remains only the no-HUD fallback.
- **The card is a now-playing surface.** It appears while speech or a
  live session is active and fades when idle, even when **Keep on
  screen** pins the other shapes; idle presence belongs to the edge knob
  and the dot.
- **Removed the mini bar.** It duplicated the card at smaller scale with
  less information; existing `mini` selections migrate to the dot on
  first read.

### Fixed (speech and HUD, 2026-11-06)
- **A chunk that ends while paused no longer deadlocks the bus.** The end
  fact advances the playhead; resuming completes the utterance instead of
  replaying silence.
- **Concurrent speak requests serialize.** A second call made while the
  first target is still resolving is queued instead of starting a competing
  utterance and losing the user's gesture.
- **A silent overlay no longer strands the bus in `speaking`.** Main arms a
  20 s playback guard per chunk and fails the utterance with an
  `overlay_unavailable` notice when no playback fact arrives. A rejected
  resume now reports an error instead of being swallowed.
- **The no-TTS-assignment notification lands where it points.** Its source
  is the `api:tasks` target the Settings opener actually parses, not a JSON
  blob that opened a blank pane.
- **Content protection applies to an existing HUD.** Toggling it updates the
  overlay and the quick-actions panel immediately, not only at creation.
- **A pinned HUD stays on its monitor.** A Settings save re-shapes the HUD
  only when a shape-affecting setting changed, and the HUD repositions
  against its own display, not the cursor's.
- **Dictation and HUD-initiated turns keep the HUD up.** The overlay reports
  a busy flag (`speech:hud-busy`) so the auto-fade cannot hide an active
  recording or a working turn; the dock gains **Stop reply**
  (`cancelTurn`) while that turn runs.
- **HUD size controls appear only where they change the shape** (the edge
  dock); the card and dot no longer offer a no-op size menu.
- **Selection actions show disabled with the reason** instead of vanishing,
  and the popover resets to page 1 when the available set changes.
- **Cross-edge drag works without dock text** for same-orientation moves;
  the text-dock requirement remains only for orientation-changing moves.

### Changed (launcher reading flow, 2026-11-05)
- **Long replies no longer switch the launcher to the full conversation
  view while you are reading.** When a response overflows the compact
  panel, the existing **Expand** icon in the reply header gets a soft
  accent highlight — no second CTA and no layout change. The old
  auto-expand setting is gone; the icon is always there and is highlighted
  only when there is more to read.
- **Expanded mode opens at the start of the latest reply.** Entering the
  full conversation view scrolls to the current streaming response, or
  the last assistant message, instead of showing the top of the whole
  conversation. Instant scroll, so reduced-motion users get the same
  stable position.
- **Streaming status no longer adds or removes a chrome row.** The live
  phase, elapsed time, latest tool and step count now live in the
  persistent meta line above the composer; on completion the same row
  becomes the compact trace meta. Steps stay one line and expand on
  demand, so the window only changes with the reply content.
- **Reply actions no longer cover the text.** Speak reply, open desktop
  and expand moved from a translucent overlay into a reserved header row
  at the top of the response card. The panel chrome budget includes the
  row, so the reply keeps its full reading width and the actions are
  always visible.

### Fixed (stream formatting, 2026-11-05)
- **Streamed prose now wraps exactly like the finished reply.** The open
  markdown tail was rendered with `white-space: pre-wrap`, so single line
  breaks in a paragraph looked like hard breaks while streaming and then
  disappeared when the block settled or the turn finished. Prose tails now
  use normal markdown whitespace; open fenced-code and math tails keep
  pre-wrapped whitespace so streamed code does not reflow.

### Fixed (launcher turn height, 2026-11-05)
- **A new reply no longer inherits the previous reply's height.** The
  compact response panel kept its last measured height between turns;
  because streaming growth is monotonic, the next short answer could open
  in a tall, mostly empty panel until the turn finished. Starting a turn
  (`thinking`/`idle`/`failed`) now resets the panel budget to its chrome
  floor, so the window grows from the new reply's measured content.

### Fixed (launcher resize flicker, 2026-11-05)
- **The launcher no longer flickers while a reply streams in.** The
  renderer sent a native resize target for every measured panel change and
  main eased each one with a 16 ms `setBounds` loop; a long reply produced
  dozens of native resizes, including grow→shrink reversals as markdown
  settled. Auto-fit is now measured and coalesced
  (`chat-react/launcherResize.ts` + `useLauncherResize.ts`): one
  `window:resize` per meaningful change, growth-only while streaming, and
  a settle window before shrinking. Main applies a single `setBounds` per
  request (`windowResize.ts`) instead of a per-frame loop — X11 treats each
  native resize as a configure/repaint round-trip, so native animation was
  the flicker itself. Frameless rounded glass and reduced-motion behavior
  are unchanged. Pinned by unit tests and the
  `tests/e2e/launcher-resize.spec.ts` smoke.

### Added (hub dock, quick actions and Studio — plans 65/66)
- **The edge dock is now a hub.** A chevron/handle opens a separate,
  never-focusable quick-actions panel beside the dock: translate the
  selection, speak it, dictate, start/end live, open the assistant, hide
  the hub, and copy/open/retry the latest result. The same panel is on
  every HUD shape through **Quick actions…** in the right-click menu.
- **Text in the dock.** The edge tab can show the latest line (speech
  chunk, live caption, a preparing state or a hub result) in a 204/220/240
  px face; Auto uses 220. Up to three lines are used, and the
  controls stay centered in the fixed envelope so text changes never
  move them (X11 cannot resize the frameless overlay per text without
  recreating it). The compact 30 px tab is unchanged; results clear after
  a configurable timeout.
- **Conditional playback controls.** A shipped control manifest
  (`src/shared/hubControls.json`) declares each control's surface,
  conditions and priority. The dock shows exactly what applies: idle
  keeps the chevron, mic and live toggle; speech adds pause/stop; live
  swaps to interrupt/end. Normal dock buttons sit on one neutral glass
  rail with hairline separators; the outer border, not the text or icons,
  carries the state color. A primary **mic / Quick
  question** button records in the HUD without entering live mode or
  opening the launcher; the rail swaps to Quick actions/**Send**/**Stop**
  (Stop cancels the recording). Send transcribes into a
  main-owned turn in the **Voice questions** conversation and speaks the
  reply. The launcher is only a no-HUD fallback. Translate/speak appear on the dock only with a selection or
  clipboard text; otherwise they stay in the quick-actions panel. The popover pages four
  actions at a time. Clicking a translated dock line opens the launcher
  with the text selected in the composer.
- **HUD sizes and square glass controls.** Compact (204 px face, 22 px
  controls, 11 px text), Comfort (220/22/12, default) and Large
  (240/26/13) resize the dock, controls and text together; the window is
  derived (240 × 97 at Comfort). Custom exposes the three values behind
  an Apply action, and old width/text settings migrate into it. Every
  dock state is one full-width segmented rail fused into the HUD border;
  the end segments keep a safe icon inset for the rounded cap. The
  launcher transcript reply actions use the same rail language
  at 22 px visual / 24 px hit. Right-clicking the HUD now opens **HUD settings**, and the menu
  carries the same Compact/Comfort/Large size choices with Custom
  pointing at HUD settings.
- **State-based dock rail and response copy.** The manifest now encodes
  each mode: speech shows Quick actions/Pause/Stop, dictation shows
  Quick actions/Send/Stop in the same rail, and live shows Quick
  actions/Interrupt/End live. Selection Translate/Speak appear only when
  desktop text is available. Hovering the response reveals a Copy chip
  for the displayed text. The former transport popup controls are removed
  from the popover; the transport surface remains dormant for future
  mini-app actions.
- **Settings → Hub.** Appearance (moved from Voice), dock text, HUD size,
  popover actions with ordering, result timeout and the Studio live in
  one page. The dock itself is fixed; Voice links to it.
- **Studio presets.** Pulse, Aurora, Minimal, Snake and Terminal, plus
  motion controls. Presets are named tokens and CSS only:
  they cannot change clicks, window bounds or IPC. Aurora/Snake rings are
  a separate layer that fades to transparency on the docked edge; the
  outer halo is directional so the transparent HUD never shows a clipped
  square edge.
- **State feedback.** Translation/preparation shows **Translating…**
  with a violet border pulse; live listening tints the border and drives
  its volume ring from the mic level. Text and buttons keep their normal
  colors. The dock text is clickable for translation results, opening the
  launcher with the text selected, and hovering reveals a Copy chip for
  the displayed response.
- **Text modes.** The fixed text envelope renders a slim control bar
  when there is no text (25 px at Comfort), a 48 px single-line state
  bar with breathing room above the rail, or the 77 px three-line text
  face. The window envelope stays fixed (no X11 recreation) and its
  dock is fully clickable; the transparent envelope does not use a
  click-through toggle that could strand it on X11. The edge dock can be
  dragged along its edge or to another edge: 80% inner-edge zones, corner
  protection, 150 ms dwell, 24 px movement, 300 ms cooldown and 48 px exit
  hysteresis. The side and ratio are saved on release; Escape cancels.
- **Hide hub / Show the HUD.** Hiding the hub empties the screen until
  **Show the HUD** in the tray brings it back.
- **Safety:** all hub actions run in main through the audited services;
  the popover never receives provider endpoints, keys or clipboard access.
  The action catalog is closed (no scripts, arbitrary CSS, app shortcuts
  or window resizing). A full per-style rule editor, app shortcuts and a
  hover preview are deferred; the shipped Studio vocabulary is presets
  plus typed toggles. Wide dock controls are 22 px (compact 16 px), with
  the normal row as a continuous rail.

### Changed (speech HUD "Pulse" — plan 58 addendum)
- **The speaking HUD has a new visual language and four polished
  shapes.** Deep glass (`backdrop-filter: blur(14px)` over the desktop), a
  gradient hairline border, a state-tinted halo, a 0.96→1 spring on every
  state change and a ~2.4 s glow breath while speaking or listening. The
  card keeps its text/progress/controls with refreshed chrome; the mini bar
  is a 160×36 capsule with a smooth SVG wave, a 2 px gradient progress
  hairline and two 24 px ghost buttons; the dock tab is a 30×68 half-pill
  that now docks to **left, right, top or bottom**, with three gradient
  bars, a glowing fill along the flat edge, compact always-visible controls
  and a 6 px hover growth toward the desktop; the dot is now a 28 px orb
  (radial core, ring, breathing halo, pause bars when paused, an
  exclamation glyph on error). Every state also differs by motion/shape,
  so colour is never the only signal, and `prefers-reduced-motion` stops
  the animation while keeping the silhouettes. Windows carry a 10 px glow
  pad so the halo is never clipped; the textless styles are always
  transparent (solid fallback on Cinnamon) and card/mini follow the window
  transparency setting.
- **The orb no longer touches the screen border or the taskbar.** Its
  travel box is inset by a 12 px safe margin on all sides (clamps
  included), so the default bottom-right position and every dropped
  position stay clear of the edges; the dock tab's flat side remains flush
  by design, with a 2 px reveal on top/bottom docks for its glow.
- **New dock-side control**: Settings → Voice → Selection speech offers Top
  and Bottom edges next to Left and Right.
- **Live captions and approvals on the HUD.** The card now shows the live
  state (`Listening…` / `Working…` / `Speaking…`), the last user phrase and
  a short streamed reply caption (bounded, session-tagged, never persisted),
  with interrupt/end actions instead of speech progress. An approval pause
  turns the card amber with **Approval needed** and fires one deduped
  notification that opens the assistant (desktop conversation route); if the
  notification is rate-limited, the amber card line is the fallback. The
  mini/dock/orb stay presence-only.
- **Live starts in the HUD.** The tray and the global hotkey send
  `hotkey:start-live` to the already-running launcher renderer without
  showing it; once the hidden host reports `listening`, the launcher hides
  and the HUD appears. Opening the launcher during live hides the HUD and
  shows the transcript/approvals; closing or minimizing returns to the HUD
  with the session uninterrupted. A mic failure surfaces the launcher with
  its live error (Start remains retryable at `error`); a silent start
  timeout stops the session and opens it with a notice. `never` posture
  keeps the launcher instead of hiding it. No launcher flash on a tray
  start.
- **Live runs in a hidden audio host.** Microphone capture, VAD and live
  reply playback moved out of the launcher renderer into a never-shown
  `live-host.html` (`live-host` IPC scope, `backgroundThrottling: false`).
  Live now survives closing or minimizing the launcher; the launcher and
  desktop are projections that start/stop and render the transcript. Main
  keeps the state machine, forwards the finished turn text to the host, and
  replays a pending start once the host reports ready. A host crash ends the
  session with a notice instead of silently resurrecting audio; the next
  start recreates it. Speech-bus audio stays in the overlay.
- **The launcher and the HUD never share the screen.** One
  `decideSpeechHudVisibility` + `syncSpeechHudVisibility` replaces the
  scattered show/hide paths: a visible (non-minimized) launcher or desktop
  window hides the HUD, `never` hides it, active speech (unless dismissed)
  or a live session shows it, `pinned` keeps it while idle, and `auto` fades
  it. Opening the launcher therefore always hides the HUD and minimizing or
  closing it brings the HUD back, without interrupting audio — the hidden
  overlay remains the speech-bus endpoint. Minimized windows no longer count
  as visible, and boot/config/style/display changes re-evaluate the rule.
- **Top/bottom dock tabs are no longer clipped.** The dock tab rotates to
  68×30 on a top/bottom dock, but its window box stayed 50×80 (the vertical
  30×68 plus padding), cutting the right side and the stop control. The box
  now rotates with the tab: 88×42, so the full tab, both controls and the
  progress line render.
- **Live starts from the tray, and the HUD shows it.** The tray gains
  **Start live conversation** (opens the launcher and begins the loop); **End
  live conversation** is now enabled only while a session exists, instead of
  always looking available. Starting live also shows the HUD presence in the
  selected style before the first reply, and ending fades it like speech.
- **HUD position settings follow the selected style.** Settings → Voice →
  Selection speech shows a 2×2 screen-corner picker for the card, a
  2×2 dock-side picker plus an **Along the edge** slider for the dock tab
  (with a drag hint), and a free-position hint with **Reset to
  bottom-right** for the orb. The irrelevant corner/dock controls are gone,
  and the dropdowns became visual pickers.
- **The dark glass is opaque enough to read.** The HUD tint was mixed from
  the Dark theme's `--as-surface`, which is itself only 35% alpha — leaving
  the HUD ~20% opaque so console text bled through the card. The glass now
  uses a HUD-owned opaque base (82% dark, 92% light), keeping the chunk
  line, progress and buttons legible on any desktop.
- **The dock tab and orb are glass on Cinnamon too.** The textless styles
  no longer force the solid fallback there — the launcher's glass already
  works on Cinnamon, so the HUD now matches it; an explicit
  Transparent-window choice (or `DESKTOP_ASSISTANT_OPAQUE=1`) still yields
  the solid `?opaque=1` panel, and `DESKTOP_ASSISTANT_OPAQUE=0` forces
  glass anywhere.
- **Tray HUD style is a submenu.** The single “HUD style: Card” cycle item
  is now a radio submenu (Card / Mini bar / Edge knob / Dot), matching the
  HUD's right-click menu; picking one persists and re-shapes the overlay
  through the normal config path.
- **The HUD can hand control back.** Right-click the mini bar, dock tab or
  orb for a native menu — **Open assistant**, **Speech settings…**, **HUD
  style** (radio over the four) and **Keep on screen** — and the card gains a
  visible **Open assistant** button next to pause/stop. Two new
  overlay-only channels (`speech:hud-menu`, `speech:hud-open`); no other
  renderer gains them, the menu is built in main so it can extend past a
  28 px orb, and the tray keeps the same commands for keyboard users.
- **Controls never overlap a visualization.** The dock tab reserves its
  pause/stop strip, so the three bars centre in the remaining area (and
  shrink to the tab's real inner size); the capture loop and the HUD style
  e2e assert disjoint rectangles between every ghost button and the wave,
  bars, progress fill or track for every style, state and dock side.
- `scripts/hud-capture/capture-hud.mjs` captures the real overlay renderer
  for every style × state × dock side × theme at 2× on a transparent
  background and composes labeled contact sheets (dev-only capture
  harness; inert in production).

### Changed (calendar bind surface is honest about setup — ADR-0052 §11)
- The OAuth bind modal no longer renders the catalog's `calendar_id` field:
  v1 connects the primary calendar, and a field whose value cannot be applied
  was removed rather than shown. `setupFields` stays in the catalog contract
  for future non-OAuth kinds. When no public client id is configured, the
  Settings tab now names the exact variable, offers a copy action, links the
  setup guide and disables **Connect** with the reason instead of hiding it.

### Fixed (calendar, 2026-11-06)
- **Bind outcomes are visible.** `calendar:bind-status` now returns
  `completed` or `failed` with the typed code after the flow settles; the
  Settings tab shows the failure instead of silently returning to idle, and
  the browser's success page is written only after the token exchange.
  Reconnecting reuses the existing account (new optional `accountId`) and
  restores its previous status if the flow fails, so no duplicate rows or
  deleted credentials. Disconnect revokes with the refresh token (the
  durable handle) under a timeout.
- **Recurring-series moves are refused** on Google and Microsoft before any
  PATCH, matching the tool text and the user guide.
- **Microsoft all-day dates use the wall-clock date** before the UTC
  conversion, so an event west of UTC no longer moves a day. A Graph event
  carrying a Windows time-zone name falls back to UTC for that event instead
  of failing the whole listing.
- **Token requests time out (30 s)** and a rejected data call invalidates
  the cached access token, refreshes once and records `needs-auth` /
  `needs-secret` on the account. Invalid create/move ranges are rejected
  before any provider call and still write their audit row. Provider error
  bodies are sanitized and appended to the failure instead of a bare status.
- **The default account is stable.** Accounts are ordered by `id` (creation
  order), never by `updatedAt`, so an omitted `accountId` cannot flip to a
  different calendar after a refresh.
- **Transient refresh failures degrade instead of dying.** The account is
  marked `degraded` and a backoff timer is armed; only `needs-auth` /
  `needs-config` stop the schedule. Refresh-token rotation writes the new
  refresh token first, and an expired cached token is never returned.

### Added
- **Calendar accounts — bind Google or Microsoft 365 and let the
  assistant work with your schedule (plan 52, family cloud
  connectors).** **Settings → Calendar** connects an account through a
  real OAuth bind: your system browser opens at the provider with a
  verbatim consent screen (every scope string exactly as the provider
  spells it, every destination domain named), a one-shot loopback
  handoff and a five-minute timeout — the app window only ever learns
  whether you finished, never a code or token. Tokens live in the OS
  keyring and nowhere else; accounts are credential bindings, not
  profiles, so binding personal and work calendars is two instances of
  one connector, never two users. This release is **bring your own
  registration**: Settings → Calendar names the public client variable
  (`DESKTOP_GOOGLE_CLIENT_ID`, `DESKTOP_MICROSOFT_CLIENT_ID`), copies it
  and links the setup guide; without it Connect is disabled with the
  reason, and Google's public client value is documented alongside the
  id. In chat, **`calendar_list` and
  `calendar_search`** read a bounded window (read-only) and
  **`calendar_create` and `calendar_move`** write with the normal
  approval card (state-changing, no delete in v1); every result names
  the account it acted as, so "what's on Thursday" stays unambiguous
  with two accounts bound. Search matches case-insensitive words in
  titles, locations and bodies (Google searches server-side, Microsoft
  filters the same bounded window). All-day events use exclusive ends
  matching the providers, recurring (series) writes are refused with a
  clear message, and a failing account degrades visibly — `invalid
  grant` stops and asks for a reconnect, transient failures back off a
  bounded number of times and then stop. A re-connect shows scope
  growth **and** removal; disconnecting a provider without a revoke
  endpoint (Microsoft) says the grant is forgotten locally, not
  revoked. Every create/move writes an audit row (typed codes only —
  never event text). The whole provider surface — catalog, consent,
  tools — renders from the bundled family catalog
  (`contracts/cloud-providers.json`): adding a provider that speaks an
  existing protocol needs no code and no UI change. Same-commit docs:
  [user guide](docs/user/calendar.md),
  [dev guide](docs/dev/cloud-connectors.md).
- **Choose the speaking voice — presets or your own name (plan 60).**
  Settings → Voice → Replies now has a **Speaking voice** control. It
  offers the assigned speech model's own presets (OpenAI-compatible,
  Gemini's prebuilt voices, Piper's female/male, Kokoro when the model or
  base URL names it) plus a free-text **Use "…"** row for anything else
  (`af_sky+af_bella`, `female-en`, a self-hosted gateway's own names).
  Custom names are sent to the provider unchanged — there is no silent
  OpenAI→Gemini mapping — and switching to a provider that does not list
  the saved voice shows a warning with **Reset to provider default**.
  **Preview** auditions the draft voice and speed through the same speech
  bus (cached, settings-only, excluded from recent speech) before you
  save. Keyless local speech servers on `localhost`/private networks
  (Kokoro-FastAPI, LocalAI, Piper) now work without a dummy API key, and
  speed is disabled with an explanation when the assigned model ignores
  it. The old "voice comes from the model" hint now says the model
  supplies the engine while the voice is yours.
- **A shortcuts cheat sheet in the launcher (plan 59).** `Ctrl+/` (or
  ⋯ → **Shortcuts**) opens an in-flow sheet listing every shortcut:
  General, Voice (including the selection, pause and stop speech chords),
  the static **In-window** chords (`Ctrl+E/D/K` and `Ctrl+/` itself) and
  your command hotkeys. All ten built-in actions always render — an
  unbound one shows a **Not Set** chip instead of disappearing — and the
  rows are read live from your current settings, so an edit in Settings
  shows up the next time the sheet opens. Groups sit in **two columns**
  (General + Voice, then the In-window strip and Commands), so a fresh
  install fits without a scrollbar — the internal scroll stays as the
  safety net for long command lists. One **Customize in Settings** button
  deep-links to Settings → Hotkeys. `Escape` closes the sheet first (the
  launcher stays) and the window grows and shrinks with it. Deleting a custom command or removing an
  integration now also drops its hotkey, so a dead global shortcut can no
  longer linger unseen. The old one-line "select text and press …" hint
  is gone: the chords now live in the sheet, and the first-run card keeps
  only the **Set up voice** call to action.
- **Selection speech — read anything, anywhere (plan 58).** Select text in
  any application and press **Speak Selected Text** (default
  `Ctrl+Shift+S`, editable in Settings → Hotkeys): the assistant reads it
  through your assigned speech model without opening the launcher. A
  dedicated **speaking HUD** shows the current chunk with `3 of 12`,
  pause/resume and stop; the launcher wave bar, tray and hotkeys drive the
  same one state. Unconfigured users now see a **Set up voice** card in
  the launcher instead of a feature only the initiated could find.
  - **One speech bus.** All non-live speech (selections, replies,
    replays, clipboard) is sequenced in main by `SpeechService`; a live
    conversation still owns the speaker — live refuses the bus and
    starting live stops it. A selection preempts a speaking reply; a
    reply never preempts a selection. Pausing during preparation is
    remembered; stop cancels the provider request in main.
  - **Content-addressed audio cache.** Synthesized chunks are stored
    locally and served by a privileged protocol, so repeated selections
    and replays are instant and cost no model calls. Bounded at 50
    utterances / 512 MiB (whole-utterance eviction), with usage and
    **Clear cache** in Settings → Voice → Selection speech. The cache can
    never mute speech: cache off, a full disk or a read-only profile fall
    back to in-memory audio.
  - **Honest selection reads.** X11 PRIMARY first, a constrained
    `wl-paste` fallback where available; "nothing selected" and "this
    desktop cannot read the selection" are separate notices, and **Speak
    clipboard** (tray) is the escape hatch. **Maximum selection length**
    (default 8,000 characters) refuses a mis-aimed select-all. No
    synthetic keystrokes, ever.
  - **Recent speech + replay.** The launcher's ⋯ menu lists the last 20
    utterances with source, time, cached ratio and synthesis-call count;
    replay any of them from cache. **Replay last speech** is in the tray.
  - **Voice settings.** HUD posture (fade / pinned / never) and corner,
    HUD content protection, speaking speed (disabled with the reason for
    Gemini-flavoured speech models, which ignore speed), cache controls
    and the selection limit live under Voice → Selection speech.
  - **Suspend and screen-lock** land speech in `idle` — waking the machine
    never starts a chunk on its own. A hotkey collision now surfaces a
    **shortcut unavailable** notice instead of silently registering
    nothing.
- **Long replies are spoken in full.** Replies longer than the 4,000
  character synthesis cap used to stop at the cap; they now continue in
  sentence-aligned chunks (typical replies remain a single synthesis
  call, preserving prosody).

- **Hide to tray joins the expanded launcher header.** The header (the
  drag-handle top bar) carries a **Hide to tray** icon next to
  Settings — the composer's separate hide icon is gone, so each window
  has exactly one home for its dismissal control. The launcher offers
  a single dismissal verb: **minimize is not offered** — a minimize
  request from the window manager (taskbar menu included) is
  intercepted and turned into hide-to-tray, and `hideMainWindow()`
  restores before hiding so no hide path can strand a minimized window
  on Cinnamon/Mutter.
- **The launcher context line expands on click.** The slim line above the
  composer (message count, or "New chat" when empty) is now a button:
  clicking it opens the full expanded window — same as the ⋯ menu's
  **Expand** action and `Ctrl+E`, discoverable via tooltip and hover
  tint. The inline trace toggle and the **+** new-chat button keep their
  own actions.
- **Cancellation for the audio processing states (TTS + STT).** Every
  in-flight audio operation can now be cancelled while it runs, and the
  abort reaches the provider request — a cancelled synthesis stops
  paying for the roundtrip instead of spinning to completion:
  - Speech: the "Preparing audio…" bar now carries the same stop
    control as playback, the global **Stop Speaking / Interrupt**
    hotkey cancels an in-flight preparation too, and a late-resolving
    synthesis after a stop is discarded (generation guard) instead of
    speaking anyway. In live mode the chunk queue's pending
    syntheses cancel with it and playback boundaries stay correct.
  - Dictation: the "Transcribing…" indicator offers cancel; a cancelled
    transcription aborts server-side, discards the late transcript, and
    resets the recorder cleanly (cancel during processing previously
    kept the fetch running and still emitted the transcript).
  - Seam: `requestId`-named ops over the new `ai:audio-cancel` IPC
    channel (`src/main/ai/audioOps.ts`, the `tools:cancel-download`
    shape) with an `AbortSignal` through both OpenAI SDK calls and the
    Gemini fetch; cancelled ops resolve `null` — silent, never an
    error notice. Channels documented in the regenerated
    `docs/dev/ipc.md`; tests pin the wire (`audio-ops`, `tts`, `stt`),
    the bars (`speech-bar`, `voice-indicator`) and the end-to-end
    cancel flows (`speak-feedback`, `recording-manager`).
- **Update checks + wizard-hand-off apply** (family plan 48 W4/W5a):
  Settings → About gains a stable/beta channel switch and manual checks
  against the family version API on neuronection.com. Applying is
  explicit everywhere: AppImage updates in place (download → restart);
  Windows/macOS/deb download the checksum-verified official installer and
  open the native wizard. Metadata only, no telemetry, no certificates
  required for the wizard path.
- **Translation settings follow the AI-providers pattern** (new family
  `translation-providers` module, adopted in the same wave): configured
  engines render as provider cards (engine/priority badges, disabled and
  no-key markers, base-URL subtitle, test result with the translated
  sample on the ok line) with every management action — enable/disable,
  reorder, test, edit, delete — in the `⋯` overflow menu. **Add service**
  opens an engine-tiles → settings-form wizard in a modal (the main page
  keeps only the key, or the base URL for LibreTranslate; the connection
  name auto-seeded with numbering, the endpoint override and the timeout
  live under Advanced), and editing opens a detail page like the AI
  provider editor. The engine catalog (labels, key and base-URL rules,
  DeepL free-tier `:fx` note, hosting tags) is projected through
  `src/renderer/settings-react/translation-catalog.ts`.
- **Language flags surface in the pickers.** The vendored family
  language catalog already carried per-language flag emoji (39 of 43 —
  ar/ca/sw/ta omit them where no uncontroversial primary country
  exists); the default-target picker in Settings → Translation and the
  transcription-language picker in Voice now render them. Custom
  languages (user-defined codes) stay unflagged.

### Changed
- **Streamed replies reveal in paced words, not raw tokens** (plan 56 —
  the V2 paced-fade display): provider-token deltas buffer into word →
  phrase units released at a bounded cadence (~1 commit/100 ms) with a
  short one-shot faint→target fade per unit, sized by the observed model
  rate and a ~300 ms lag budget so fast models read smoothly instead of
  jittering sub-token fragments. Completed markdown blocks settle into
  memoized per-block renders (one parse per block, not one per 33 ms
  flush) and the display is lossless end-to-end (Unicode-safe units —
  Greek included; `prefers-reduced-motion` drops the fade, keeps the
  pacing). Same display in all three windows (launcher compact/expanded,
  desktop). Alongside: TTS sentence chunking now splits Greek sentences
  (Greek capitals + `;` U+037E), and the turn trace store coalesces
  per-delta notifications so a token firehose no longer re-renders per
  token. `docs/dev/stream-display.md` documents the contract.
- **Web search settings follow the AI-providers pattern** (family
  `web-search-providers` module redesign): configured instances render
  as provider cards (type/priority badges, disabled and no-key markers,
  base-URL subtitle, probe status line) with every management action —
  enable/disable, reorder, test, edit, delete — in the `⋯` overflow
  menu. **Add provider** opens a tiles → settings-form wizard in a
  modal (choose a provider card, then configure; timeout and result
  count live under the form's Advanced disclosure), and editing an
  instance opens a detail page like the AI provider editor. Tiles carry
  a hosting chip (cloud vs self-hosted, from the family contract's new
  `hosting` field) and brand marks for the types simple-icons covers
  (searxng, brave, google-pse); labels wrap to two lines instead of
  cropping. The wizard's main page keeps only the core configuration —
  the API key, or the base URL for base-URL-required instances like
  SearXNG — while the connection name (auto-seeded from the provider
  label, numbered when already taken: `Tavily`, `Tavily 2`, …), the
  optional endpoint override and tuning fields live under Advanced.
  The Brave and Tavily get-key links now target their setup docs. The
  provider catalog now comes from the vendored family contract
  (`contracts/search-providers.json`, projected through
  `src/renderer/settings-react/search-catalog.ts`) instead of
  hand-coded labels, so key requirements, base-URL rules, hints and
  field definitions follow the family contract. Consumes the
  redesigned `@neuronection/assistant-ui` `web-search-providers`
  module (cards list, wizard, settings form) — pinned on the next
  library release. Tests: vitest now excludes the library from the
  dep-optimizer (its pre-bundled chunks broke the settings suites).

### Fixed
- **The speaking HUD's pause and stop buttons are always visible.** They
  were hover-revealed, so the controls had to be discovered; they now
  show for as long as the card is on screen, and still dim while idle
  (nothing is pausable or stoppable then). The card geometry is
  unchanged — the buttons already reserved their width.
- **Packaged builds expose the preload bridge again (v0.10.0 regression).**
  Every window in a packaged build (AppImage/deb, NSIS, DMG) opened on
  *"Something went wrong — Cannot read properties of undefined (reading
  'onMiniAppRunEvent')"*: the registry-derived preload (plan 44 S3)
  imported `createPreloadApi` and the shared registry, but production
  windows run `sandbox: true` and a sandboxed preload may only
  `require('electron')` — the relative require failed, `contextBridge`
  never ran and `window.electronAPI` stayed undefined. Dev hid it
  (`sandbox: false`). The bridge is now GENERATED as one self-contained
  module (`src/preload/preload.generated.ts`: inlined
  channel/method/direction table, validation still main-side) with three
  new walls: `npm run verify:ipc-codegen` (regen-and-diff, like the IPC
  docs), `npm run verify:preload-sandbox` (the compiled preload requires
  nothing but `electron`) and a packaged `--smoke` probe that asserts
  `window.electronAPI` in the real renderer (`SMOKE_BRIDGE_OK`; the
  release workflow now greps for it).
- **Cold Settings deep links land on the requested tab.** Opening Settings
  with a deep link while the window was closed could still show the
  default tab: the one-shot `settings:navigate` push was delivered when
  the window became ready, which can precede the renderer's subscription.
  The settings app now pulls the pending target on mount (one new
  `settings:take-pending-nav` invoke), so the Shortcuts sheet's
  **Customize in Settings** and every other cold deep link open where
  they point.
- **The speaking HUD no longer crops its right side.** A long chunk line
  widened the card past the 320 px window (a flexbox `min-width: auto`
  content minimum on the card), so the window clipped the text mid-word
  and hid the `n of total` label; the card now stays window-bound and the
  chunk line ellipsizes. Pinned by a real-layout e2e assertion plus a CSS
  source guard (jsdom cannot see layout).
- **The trace strip showed the previous turn's steps when a new message
  was sent.** The renderer's trace store only reseeds when main
  broadcasts the new turn's `queued` event, and it is otherwise cleared
  only on an explicit dismiss — so between pressing Enter and the
  `queued` roundtrip, the compact strip rendered the stale steps of the
  last turn, which after switching conversations belonged to the old
  session. Every turn-start path (composer send, voice auto-send,
  slash/custom command turns, named flows, palette direct turns) now
  resets the trace snapshot at submit time; the repaired-turn re-seed
  carried by `queued` is unaffected. Regression tests in
  `streaming-live` (composer path) and `voice-indicator` (auto-send
  stop-recording window) fire the real event sequences and assert the
  strip carries no old steps while the new turn waits for `queued`.
- **Typing a draft and clicking any composer toolbar button sent the
  message.** The composer renders a `<form>` (the library
  `ChatComposer`), and every button slotted into its toolbars — attach,
  share screen, mic/live, selection/clipboard tools, the ♥ support
  button and the ⋯ menu — defaulted to the HTML `type="submit"`
  because the family library's `Button` renders no explicit type. Any
  click performed an implicit form submission and fired send (empty
  drafts early-return, which is why it only struck with text in the
  input). All slotted buttons now declare `type="button"`; only the
  send control submits. Regression tests pin the composer-level law
  (exactly one submit button; toolbar clicks run their own action and
  never submit) and the launcher scenario end-to-end.
- **Speech (tts) capability no longer lost when adding a model from the
  live catalog** (Settings → API → Models). The add-model wizard's kind
  step (Speech / Transcription / Embeddings / Decision) was silently
  re-classified by id-pattern inference the moment a model was picked
  from the provider catalog: audio models whose ids carry no
  `tts`/`speech`/`voice`/`whisper` token (e.g. ollama `lfm3-audio`,
  openai-wire gateways) saved as plain `text` (+`tools`) rows and the
  `tts` capability never reached `config.json`, leaving the Speech task
  unassignable. Upstream fix in the `@neuronection/assistant-ui`
  `ModelRegistry` (overlay tarball; changeset pending release): a
  catalog pick keeps an explicitly declared kind and fills only the
  id/label; undeclared and text-kind drafts keep the catalog cap
  correction (`llava` → vision, `whisper` → stt). Existing wrong rows
  heal via Edit → Change type → Speech → Save. Regression test rides
  `tests/ai-settings-ui.test.tsx`.
- **Ollama TTS synthesis 400s fixed — the OpenAI speech flavor now
  requests WAV and a provider-fitting default voice.** `/audio/speech`
  hardcoded `response_format: 'mp3'` (rejected by ollama and
  kokoro-class gateways: "use wav or pcm") and defaulted the voice to
  OpenAI's `alloy` (rejected by ollama's Piper-style voices: "use
  female or male, optionally -<language>"). The flavor now requests
  `wav` everywhere (OpenAI cloud accepts it; renderer playback proven
  by the Gemini flavor) and defaults the voice per provider — `female`
  for ollama, `alloy` otherwise, explicit overrides pass through.
  `compactTtsError` surfaces the server's 400 text (it names the
  rejected param) instead of a bare "HTTP 400". Pins: `tests/tts.test.ts`.
- **Audio ops honor the provider timeout budget.** The speech/transcribe
  clients ignored the provider row's `timeout`, so a slow local server
  (e.g. ollama loading a cold TTS model) hung until undici's internal
  headers timeout and surfaced a raw `UND_ERR_HEADERS_TIMEOUT` stack;
  the OpenAI clients now carry the configured budget and the Gemini
  fetch composes it into its abort signal, and timeout failures render
  as "no response from the server (timed out)" instead of the SDK's
  dispatcher-diagnostic dump.

### Added
- **Plan 55 — Deletion review decision presets + settings descriptions.**
  Every pack-settings input now carries a plain-language description
  under it (schema fields project `config.<name>.description` from the
  pack i18n through the registry into the shared config form), and the
  rules editor states each list's purpose in one line. Deletion review
  ships decision presets: default keep rules (`docs/**`, `**/*.md`,
  `**/*.rst`, `**/LICENSE*`), a shipped decision policy (guidance the
  model reads on every file — user-created content stays, generated
  output is disposable, never guess) and substantially richer decision
  prompts (concrete disposable-vs-keep-worthy guidance and a
  content-based recoverability scale). Pack version 1.4.0 — the bump
  invalidates cached verdicts so the next run re-decides with the new
  guidance. Mini-translate's settings carry descriptions too. The pack
  settings page gained **Restore defaults** — one click back to the
  shipped preset (rules, policy, thresholds) before saving. The shipped
  policy text is written in the Policy editor's own labeled format, so
  Restore populates the three sections and scoring hints instead of
  leaving them empty; fractional thresholds (the confidence gates) no
  longer fail native number-step validation — they clamp main-side, and
  a typed error names an out-of-range value on save.

### Fixed
- **The endpoint decision again owns the OpenAI wire (ADR-0039).** The
  `@langchain/openai` 1.7.x line auto-routes model ids matching
  `gpt-5.x`/`codex` onto the Responses API regardless of endpoint, which
  sent `/responses` requests to OpenAI-compatible gateways that only
  serve `/chat/completions`. The factory now builds the SDK's completions
  client directly for the `completions` transport (and keeps the
  store-less responses client for OpenAI's own API), so
  `resolveChatTransport` is authoritative and `reasoning_effort` stays on
  the completions wire for gateways. Pinned by the wire suites; the
  Gemini tool-image wire test keeps the `@langchain/google` converter
  deep import matched to the lockfile-pinned package layout.
- **Plan 54 — saved run telemetry and one uniform run action row.** Each
  run now persists the execution facts resolved at start in a new
  `MiniAppRun.execution` JSON column (zod envelope `miniAppRunExecution`,
  schema v2 migration): the decision engine id plus the decision
  provider/model and — for `llm`-capable packs — the LLM provider/model,
  with provider names denormalized so history stays truthful after
  config edits. The chat run card and the report header (pack window +
  report modal) share one `RunSummary` line (decision engine · decision
  provider/model · LLM provider/model · elapsed · finished clock ·
  calls · tokens — each fact only when present) and one `RunActions`
  row: **Stop** while the run is live, **Restart** on a settled run
  (same folder, same store), **View report** everywhere, and
  export/open-window where the host offers them. Stop and restart work
  from both surfaces through the existing `miniapps:run-cancel` /
  `miniapps:run-start` bridges; a settled card reports
  started/finished times, and restart confirms with the started
  notice. Run cards also carry the reviewed folder (metadata
  `rootPath` was previously emitted empty).

### Fixed
- **The launcher keeps run reports in place — expand, never bounce to
  another window.** A run-finished notice's **View report** in launcher
  mode now expands the launcher and opens the report inside it (the
  same `RunReportModal` the desktop host uses) instead of switching to
  the settings window; the run card's View report follows the same
  rule (pack window when the pack declares `ui:window`, otherwise the
  in-launcher report). Escape closes the report and the launcher stays
  where it was; "Open in window" inside the report remains the explicit
  way out to the pack window. Desktop mode is unchanged (in-window
  report modal).

### Fixed
- **Run reports open where they belong, the launch menu's Configure goes
  to the pack's settings page, and run cards show the reviewed folder
  (plan 53 follow-up).** `View report` now opens the host-owned pack
  window when the pack declares `ui:window` (Deletion review gained the
  capability — version 1.3.0 so installs upgrade), falling back to the
  in-app report (desktop modal / settings deep-link) on refusal; the
  choice is read at click time from the live registry view. The launch
  menu's **Configure** deep-links to that pack's settings page
  (`miniAppsConfigurePackId`, a new additive settings target field)
  instead of dropping into the apps hub — it stays enabled with no
  folder chosen because it edits pack settings (rules, thresholds,
  engines), not the pending run; the folder-independent scope is now
  obvious from where it lands. The run card and the report Overview
  display the selected folder path (truncated, full path in the
  tooltip).

### Fixed
- **Files-tab row actions now apply, and the files list scrolls in the
  pack window.** Two plan-53 layout regressions in the pack-window
  host: the results column was missing `min-h-0`, so the list grew past
  the window and was clipped by `overflow-hidden` (no scrollbar, rows
  running off the bottom edge); and row quick actions (Keep/Candidate)
  wrote the override but nothing refreshed the directory listing the
  rows render from — the verdict never changed on screen. Overrides now
  refresh the listing, the directory tree and the run report (scoped
  folder actions already did), and the results column is height-
  constrained at every breakpoint.
- **Pack window spacing opened up.** The report window now gives its
  content real margins (16px sides, 14px top, taller title bar, 16px
  section rhythm) instead of 12px everything — tabs, rows and the
  header no longer run edge-to-edge, and the results scroll area got a
  hair of right inset so text never touches the pane edge.
- **Schema head 2 lifts older profiles instead of refusing them.** The
  plan-54 `MiniAppRun.execution` column and the plan-52 `ConnectorAudit`
  table are applied by the migration ladder: a v0.9.0 profile (no head)
  runs the additive v0.9→v0.10 lift and then the v1→v2 step, and a
  v0.10.0 profile (head 1) runs only the last step. Conversations,
  messages and settings are preserved; a newer database is still
  refused. Pinned by lift tests for the v0.9.0 shape, the head-1 shape
  and a partially-modernised pre-flatten profile.
- **Packaged builds ship the vendored cloud-provider catalog.** The
  Calendar tab and its chat tools read `contracts/cloud-providers.json`
  from `process.resourcesPath`; the file is now an `extraResources`
  entry on every platform, and the packaged smoke loads the catalog and
  asserts `SMOKE_CATALOG_OK` (so a missing bundle fails the release, not
  the Calendar tab).
- **Update installs fail closed and only install when asked.** The wizard
  now reads `SHA256SUMS.txt` from the release's download base (the tag-page
  URL returned HTML, so verification was silently skipped), aborts when the
  sums file or the artifact's entry is missing, rejects percent-encoded
  path traversal in asset names, and downloads into a private per-run
  directory. `autoInstallOnAppQuit` is disabled, so a downloaded AppImage
  installs only from the explicit restart action; dev/unpackaged builds are
  refused. A failed apply surfaces its error and turns the Settings action
  into **Try again** instead of disabling the section until restart. Status
  copy is human: `idle` is **Not checked yet**, 404/network/schema failures
  map to bounded messages, and a verification failure says nothing was
  installed instead of exposing the raw reason.
- **Launch-menu toggles use the family `SwitchRow` — the OFF state is
  visible in every theme.** The hand-rolled switch drew its track from
  `--as-muted` and its knob from `--as-surface-raised`, which map to the
  same palette entry as the surrounding card in the settings themes —
  the control dissolved into the panel when off. Switch options now
  render the library's `SwitchRow` (border-tone track + shadowed knob,
  the family's sanctioned standalone toggle), which reads correctly
  off and on, and keeps the row's label as the accessible name.

### Fixed
- **Launch menus were empty on upgraded installs — bundled pack versions
  now carry the declarations, and stale manifests degrade to the old
  picker.** The plan-53 manifest changes shipped without a pack version
  bump, and bundled upgrades are version-gated (`ensureBundled` skips
  same-version manifests) — an existing install kept its old pack
  manifest, so the Run… menu rendered no options and Run had no folder
  to start with. `mini-translate` is now 1.3.0 and
  `file-deletion-review` 1.2.0 (boot upgrades the installed copies,
  preserving config + enabled state). Independently, both launch hosts
  now degrade honestly when a pack view cannot supply a run root (no
  `path` option): the runs page falls back to the native folder picker
  and the palette command falls through to the legacy picker flow
  instead of showing a dead Run.

### Added
- **Plan 53 S3 — launch menus wired through the palette, the runs page
  and the live pad.** Picking a mini-app in the command palette now
  opens its launch menu as an in-flow pane instead of jumping straight
  in (packs with declared options, or hub-only packs with `run` /
  `ui:window`): Escape steps back with the palette query preserved and
  focus returned, no-option packs keep their exact direct behavior.
  Run persists the config-bound values through the one config store
  (`saveMiniAppConfig`) and dispatches — assessment packs start with
  the chosen folder and jump to the run's conversation; surface packs
  open with the chosen options; a failed config write still launches
  with a non-blocking notice, and a refused root renders inline under
  the folder field with the pane open. Hub actions deep-link: Runs
  history now lands on the pack's Runs page with a **pack-id-only**
  navigation (run-id stays optional for the report deep-link),
  Configure opens the apps tab. The settings runs page's **Run…**
  mounts the same menu in a modal (one component, two hosts) and keeps
  the picker flow as a fallback when no pack view is available. The
  live pad shows an active-options chip (its title) that reopens the
  menu pre-filled; **Apply** updates the running surface through the
  new optional `applyLiveOptions` binding hook — no remount, typed
  text survives, and the values persist like any launch (translate:
  source + target now drive the translate call and the title route).
  Docs: SDK authoring section for `launch.options`, both pack doc sets
  updated.
- **Plan 53 S2 — the shared `PackLaunchMenu` component.** One host-generic launch menu for every mini-app that declares launch options (or has hub content): it renders the pack's declared options as modern controls — segmented pill choices for short lists, a select for long ones (choices fall back to the `configSchema` enum when undeclared), a switch for booleans, a path input with Browse… wired to the host's picker, and a text-input degrade for unknown declarations — pre-filled from the pack config, with required-empty blocking the primary action and inline "Required" hints. Hub actions are capability-gated: the primary is **Run** for packs with the run capability and **Open** for surfaces (overridable, e.g. Apply), Runs history appears only for run packs, Configure always, Open in window only with the `ui:window` capability and a host handler. Launch errors render under their field (`role=alert`), persist notices as `role=status`, and `launching` disables the primary with `aria-busy`. The registry now projects declared options into `MiniAppView.launchOptions` with i18n labels resolved (id fallback) — the plan-51 rule-binding precedent, zero pack ids in host code.
- **Plan 53 S1 — launch-option declarations in the mini-app pack
  contract (additive).** A pack may declare its pre-launch menu options
  in a new base-schema `launch: { options }` slot: per option an id,
  label key, control type (`select | switch | text | path`), choices,
  an optional `configKey` binding to a `configSchema` property
  (persisted on launch — one home per knob), `required` and `default`.
  The vocabulary is contract-generated (`launch.optionTypes` in
  `the family contract canonical/mini-app-packs.json`, re-vendored byte-identically with
  the sync master and the generated manifest schema); the normative
  validator gained matching walls (id/choice uniqueness, type and
  default shapes, configKey cross-reference, limits, i18n labels for
  declared labelKeys — the rule-label discipline). The slot lives in
  the BASE schema on purpose: `contributions` stays a bundled/sandboxed
  Tier-1/2 privilege (unchanged trust model), so imported packs keep
  their launch menus. Declared for the bundled packs: Translate
  (source/target selects, config-bound and persistent) and Deletion
  review (folder path, read-context switch).

### Fixed
- **Report Files tab: no horizontal scroll, and the item popup matches
  the project popup theme.** The results table's File column declared
  `w-full` beside an auto Actions column, so the fixed table layout
  summed past its container — the actions left the viewport behind a
  horizontal scrollbar at the standard window size. The File column now
  takes the remaining width (no percentage), the Actions column is a
  fixed 6rem whose buttons wrap to a second line when needed, the
  evidence chip shrinks with its cell, and the results scroll region
  hard-caps horizontal overflow (`overflow-x-hidden`) so the
  fit-by-design law cannot regress silently. The item popup followed
  `--as-surface`, which is 35%-alpha translucent in every theme —
  scrolling rows showed straight through it; it now uses the same solid
  popup treatment as every modal in the project
  (`--as-surface-raised`, `--as-radius-lg`, `--as-shadow-3`).

### Changed
- **Plan 52 S3 — report Files tab density: results own the scroll.**
  The report body is now a flex column whose ONLY scroll region is the
  results area — header, tabs, toolbars and the context line are
  pinned, the table header is sticky inside the scroll, and the first
  result row is visible without scrolling at standard size (pager and
  notices stay pinned below the results). Rows became name blocks: the
  filename clamps at 3 lines (`overflow-wrap: anywhere` for unbroken
  multilingual tokens, full name in the tooltip and the popup) over ONE
  meta line — colored verdict chip, confidence mini-bar, tiny size and
  the truncated evidence chip — plus one compact actions cell with the
  primary quick action (Keep on ask/candidate rows, Candidate on keep
  rows; row click opens the popup, Escape returns focus). The secondary
  columns are retired from the table: size, age, category, confidence
  detail and decided-by now live as labeled rows in the item popup —
  which gained the full directory (directory segment emphasized) and
  prominent Show-in-folder / Open actions in its pinned footer, with
  decided-by as a human chip (rules / model / cache), never the raw
  engine string. Zero-count filter chips render subdued instead of
  disappearing (a host-provided optional `count` on the surface filter
  option — the one shared-type delta), the search placeholder names
  the scope ("Search this folder"), and the paging row no longer
  duplicates the page-status paragraph. The filename itself is the
  row's keyboard path (tab to it, Enter opens the popup, focus returns
  on Escape). Both report hosts (settings modal + pack window) scroll
  results internally now. Presentation only — plan-51 interactions
  (sort/group/filter/select/tree/scoped actions/drawer/paging) keep
  their behavior and testids.

### Changed
- **Plan 52 S1+S2 — report Files tab chrome consolidation.** The run
  report header is now the ONE home for run-level actions —
  `[status · Arm · Export · Open in window]`: the Arm CTA moved out of
  the report modal's floating footer into the header with its honest
  gated candidate count in the label (`Quarantine N candidate(s)…`,
  disabled + subdued at 0, count from the run-tree totals so overrides
  update it live), the status badge became a quiet status dot + word
  (it labels the run, not an action), and the manifest
  `actions: [run:export]` surface node is stripped from the Files tab
  host-side so Export renders exactly once. The Files tab now respects
  a hard chrome budget: toolbar row 1 (search + sort + group + select)
  and toolbar row 2 (verdict facet chips + decided-by facet), then at
  most ONE context line — navigable runs (≥ 2 directory levels or a
  non-root selection) keep the tree rail + breadcrumbs with Keep all /
  Exclude all / +rule demoted onto the breadcrumb row; single-level
  runs get one compact facts line
  (`Root folder · N file(s) · size · N ask`) with the same actions
  inline, and no tree/breadcrumbs at all. `ModalFooter` is gone from
  the report modal and the `pack — report` title is a TEXT constant.
  The Files facet row lays the verdict chips and the decided-by facet
  on ONE row (host layout hook on the shared surface renderer), and
  the manifest `actions` de-dup strips only the header-rendered
  run-level action per id — a mixed actions node keeps its remaining
  actions. Presentation only — every control, testid and interaction
  from plan 51 keeps working unchanged.

### Fixed
- **Mini-app run start no longer fails turn-metadata validation.**
  Starting a run threw `Invalid turn metadata at outcome: expected
  "ok"|"failed"|"cancelled"`: the run card message (an assistant-table
  row that is not a turn) never carries the top-level turn `outcome`,
  but the plan-36 metadata envelope required it — a mismatch invisible
  to the suite because every runner test mocks `createRunMessage`.
  `TurnMetadata.outcome` is now optional in the schema and type (the
  one consumer already read it null-tolerantly; run-card state lives in
  `miniAppRun.status`), and the envelope test now pins that an *invalid*
  outcome is rejected while an absent one validates. A regression test
  runs the actual start/finish card metadata through the real
  `validateTurnMetadata`.

### Added
- **Plan 51 S6 — optional LLM conveniences (proposals and prose only).**
  Three toggle-gated conveniences over one bounded plumbing-task call
  each, under the untrusted-output law — the model never authors a
  verdict, never arms, and never writes config unaccepted. **Run
  digest** (`runDigest`, default on): one call after a done run —
  aggregates + ≤ 50 sample paths, never content — zod-validated,
  fail-soft, rendered on the report Overview labeled AI-generated
  beside the exact numbers (and it rides the conversation result card's
  metadata; new `miniapps:run-digest` IPC). **Natural-language rule
  drafting** (`ruleDrafting`, default off): describe the files, the
  model drafts globs that land as draft chips in the rules editor —
  verified through the simulator/impact preview and persisted only
  through the normal save path when the user adds them
  (`miniapps:draft-rules`). **Rule learning** (`learnRules`, default
  off): a user-initiated button in the overrides manager — deterministic
  pattern inference first (common name suffixes / shared directories),
  one model call only when that is ambiguous — as an accept/reject card
  whose acceptance writes keep rules through save-config
  (`miniapps:learn-rules`). Toggle-off makes zero calls.
- **Plan 51 S5 — decision-input robustness.** The decision model's
  input got the structural upgrades: a **structured Policy builder**
  on the pack settings page composes the single `guidelines` string
  from grouped always-keep / always-review / never-delete lines and
  per-question scoring hints in a deterministic labeled format, with a
  what-the-model-sees preview (the runner-side cap rose 500 → 2000
  chars); **few-shot feedback injection** (default on) rides up to 20
  of the user's most recent same-root overrides into each ask as
  "the user previously decided" — host-sensitive paths excluded, the
  count recorded in item evidence, the cap and toggle configurable
  (config keys `learnFromFeedback`, `feedbackExamples`; toggling
  re-keys the verdict cache); **`keepConfidence`** (0.5–0.99, default
  0.9) makes the keep-compose gate config-tunable, symmetric to the
  candidacy knob; and a **binary excerpt guard** sniffs the first 512
  bytes before including content — binary-looking files send no
  excerpt at all, recorded honestly as `excerptSkipped: 'binary'` in
  the evidence.
- **Plan 51 S4 — setup & configuration upgrades.** The pack config
  gains a tunable candidacy threshold (`candidateConfidence`, 0.5–0.99,
  default 0.8 — compose now reads it as a config signal; the manifest's
  arming floor stays fixed so config can raise the bar but never lower
  it), a **quarantine destination** (`app-store` | `system-trash`,
  default app-store), a **Scan without the model** rules-only start
  (model budget 0 — the run lands paused with the residual pending and
  resume runs the model on exactly those files), per-pack config
  **Export/Import** (JSON through the standard dialogs, validated
  main-side through the existing save-config path — generic for every
  pack, enabling rule-set sharing between machines), and a
  **reclaimable-space line** on the report Overview (candidate bytes
  from stored item facts — tree totals when available — plus the
  pack's quarantined bytes).
- **Plan 51 S4.7 — system-trash quarantine destination.** With
  `quarantineDestination: system-trash` the executor dispatches to the
  OS trash (`shell.trashItem`) after the same per-item-atomic
  fingerprint re-validation: item state stays contract-`quarantined`,
  the record carries `destination: 'system-trash'` and a **receipt**
  (origin path, size, timestamp) under the pack's trash audit trail
  replaces the store manifest. Fail-soft semantics hold — a rejection
  (typed `io` error carrying `trash-unavailable`, e.g. a mount without
  `.Trash`, Recycle Bin quota, refusing network shares) stops the
  batch, already-trashed files stay trashed and restorable only from
  the file manager, and the remaining items drop back to `ask`. The
  arm dialog states the destination before approval and the confirm
  button names it; the quarantine manager shows trashed receipts with
  no Restore button and the file-manager hint; retention prune and
  Empty-quarantine apply to app-store copies only — with system-trash
  the app never deletes anything, ever.
- **Plan 51 S4.5 — pack docs.** New `rules-and-config.md` page (rule
  lists, glob syntax + the `:days` idiom, precedence, the rules editor
  and impact preview, the model's policy input, confidence knobs,
  rules-only scans, the tabbed report, bulk + directory-scoped
  decisions, quarantine destinations and platform honesty), wired into
  the pack's docs tree.
- **Plan 51 S3 (part 2) — directory explorer, multi-select, scale robustness.**
  The Files tab navigates runs as a directory tree backed by a
  main-side index: one bounded reduce over a run's FULL item set (not
  the capped report view), cached per run in RunService and
  delta-adjusted on overrides — per directory, direct + total counts by
  verdict and size sums aggregated bottom-up, with honest `—` size
  buckets where any contributing item predates stored metadata. New
  IPC (registry + preload + `docs/dev/ipc.md` regenerated):
  `miniapps:run-tree` (the index), `miniapps:run-directory` (items
  under a prefix, paged 200/page, stable order, optional verdict
  filter, honest totals), `miniapps:override-items` (batch ≤ 500,
  fail-soft per-item status) and `miniapps:override-prefix`
  (directory-scoped decisions, bounded ≤ 2000 per call with
  `{ applied, remaining }` continuation; items already in exactly the
  requested state are skipped so repeated calls advance). The single
  override/exclude channels share the same seam now, so every write
  updates the cached index. The tree rail shows collapsible directories
  with aggregate badges that follow the verdict filter; breadcrumbs,
  Keep all / Exclude all under this folder (confirmation card above 50
  items per the popup chrome law) and Add `<dir>/**` to keep rules
  (composed through the rule-bindings introspection + save-config) act
  scoped to a folder. A Select toggle adds multi-select — checkboxes,
  row-click toggling, shift-range, page select-all, an in-flow bulk bar
  (Keep / Candidate / Exclude + select-all-in-folder capped at the
  batch bound + Done, Escape exits). Scale pinned by tests: a
  6000-file run completes with tree totals matching run totals exactly,
  page walks never duplicate or drop, prefix overrides report
  `applied/remaining` honestly, and the renderer never mounts more than
  a page of rows.
- **Plan 51 S3 (part 1) — tabbed report shell, verdict rings, fit-by-design table, item drawer.**
  The run report re-shells into three tabs (Overview / Files / Review)
  around the unchanged declarative surface: Overview carries
  host-derived verdict-distribution and decision-source ring charts
  (inline SVG, accessible legends, no new dependency), the totals line
  and the stat/badge/progress nodes; Files carries the working table —
  structured columns (size, age, category from the items' stored
  `evidence.meta`), confidence rendered as a mini-bar merged into the
  verdict cell, sort (path/size/age/confidence/verdict) and group-by
  (verdict/category/decidedBy), per-facet counts on the filter chips, a
  decided-by select, and per-row overrides on every verdict (candidates
  gain Keep); Review is the ask queue. The table fits its container by
  design — `table-fixed`, no horizontal scrolling anywhere, secondary
  columns render only when the pane is wide enough (hiding beats
  scrolling). The ⓘ detail drawer anchors inside the report pane with
  the popup chrome law (persistent title + labelled close, scrollable
  body, pinned action footer), structured evidence cards (rule chip,
  per-question rows with confidence bars, usage tokens, raw-JSON
  fallback), focus trap + focus return, Escape to close, and a
  bottom-sheet variant on narrow panes. The run status badge and the
  export / open-window actions stay above the tabs on every tab.
  Exports (markdown/CSV) gain the size/age/category columns. Pack
  manifest: the report table declares the structured columns and a
  decided-by select; i18n gains the question/level/category labels.
- **Plan 51 S2 — rules editor with explain-a-path simulator and rule-impact preview.**
  The classify/glob semantics moved into one shared policy core
  (`src/shared/app-pack/policy.ts`) consumed by the runner and the
  renderer alike, so the code that decides and the UI that explain can
  never drift. The registry introspects each pack's config-bound
  classify rules (`ruleBindings` on the pack view — `matches-any`
  leaves reading an array-of-string config key) and exposes the
  classify step for tracing. The pack settings page gains a host-generic
  **Rules** editor: pattern chips (add/remove/reorder, live glob
  validation with a bare-`**` warning), common-pattern snippets, an
  **Explain a path** simulator printing the full decision trace
  (including `:days` age reasoning and the basename-match rule), and a
  **What would this change?** preview — new `miniapps:rule-impact`
  IPC replays draft rule lists over the latest run's stored items
  (per-list flip counts + sample paths; overridden and host-sensitive
  items never flip; items without stored age metadata count as
  unverifiable for `:days` entries). Rule edits persist through the
  existing schema-validated `miniapps:save-config` path.
- **Plan 51 S1 — user rule sets for the deletion review pack.** The
  pack's config gains three rule lists — `keepRules`, `reviewRules`,
  `junkRules` (up to 64 globs each) — wired into the classify pipeline
  as first-class rules: keep-rule matches finalize as *keep* with
  `user-keep` evidence (placed first in the keep list), review-rule
  matches finalize as *ask*, junk-rule matches join the candidate
  queue. Entries accept an optional minimum-age suffix (`*.log:30`
  fires only for files ≥ 30 days). The decision model's ask input now
  carries a bounded "user keep policy" section (≤ 40 globs per list,
  ≤ 200 chars each, ≤ 2000 chars total) so its judgment on residual
  files respects the user's keep semantics. Rule- and model-decided
  items record `meta` (size, ageDays, ext) in their evidence — the
  basis for the report's size/age columns with no schema change. Pack
  version 1.0.0 → 1.1.0.

### Fixed
- **"Add all" label no longer leaks its count placeholder.** The
  Add-model modal passed `Add all ({count})` verbatim to the model
  registry, which renders the label and appends the real count itself —
  the button read "Add all ({count}) (43)". The label is now the plain
  "Add all".

### Changed
- **Dependencies:** `@neuronection/assistant-ui` ^0.71.0 — the model
  add/edit modal (API Settings → Models) is compact: provider + kind
  render as one context line; the optional Label (copy now
  "Label (optional, auto-filled)") and the tuning fields (reasoning
  effort, temperature, max tokens) sit under a collapsed Advanced
  disclosure. The main form is the model picker plus capabilities.

### Added
- **Close button and icon-only header actions on the expanded-mode
  history panel and chat header.** The conversation sidebar in the
  expanded launcher now carries its own header row — "History" plus a
  close (×) action — so it can be dismissed without reaching the panel
  header's toggle in the main chat area. The expanded header actions
  restyled: the history toggle is the recognizable History glyph
  (state stays on `aria-pressed`), New is an icon-only primary-filled
  round plus button, and Clear is a ghost eraser icon (labels:
  "New conversation" / "Clear conversation" via title + aria-label).
  The list scrolls under the sidebar header (same wrapper pattern as
  the desktop window's sidebar); the scroll wrapper pads itself
  (`p-1 -m-1`) so the search field's focus outline (2px outline + 1px
  offset) isn't cropped by the overflow clip — applied to the desktop
  window's identical wrapper too. Removed the now-unused
  `LAUNCHER_NEW_BUTTON` / `LAUNCHER_TOGGLE_HISTORY*` strings.

### Fixed (plan 49 parked follow-ups)
- **Report windows retitle on retarget.** The window seam gained
  `setTitle`; re-targeting a live window to another run now updates the
  window title instead of leaving the first run's id in the taskbar.
- **Audit writes can no longer fail an open.** All `MiniAppWindow` audit
  writes (create/markClosed, fresh and retarget paths) go through one
  non-fatal helper — a store failure logs a warning instead of rejecting
  the IPC or skipping the window.
- Removed the write-only `MiniAppRunReportView.windowSupported` field
  (its last consumer, the report modal's capability gate, was dropped in
  plan 49 phase 3).

### Changed (settings IA — plan 50: detail pages rollout)
- **Tool details and the provider editor are pages now.** Tools → Native
  tools: a tool row opens a **Tool settings** page (parameters, verification
  editor, enable/grant) replacing the section. API → providers: **Edit/**
  **Add New Provider** opens a **Provider settings** page (type, connection,
  advanced base-URL, clear-models) with Cancel/Save actions; the setup
  wizard's manual-form jump lands there. Short flows (wizards, add-app,
  preset review, confirmations) intentionally stay modals. Both pages
  replace their view (hub-absence pinned), carry axe scans, and restore
  the tools/API sections on Back.

### Changed (settings IA — plan 49 phase 2)
- **MCP app configuration is a page, and sources live on their own page.**
  Integrations → MCP apps: **Edit** now opens the app's detail *page*
  (connection/tools/resources/prompts/scope tabs, digest readout and the
  combined Save action) instead of a modal — back navigation returns to
  the list. The packs hub gained an **Extension sources** button; the
  sources registry (subscribed sources, candidates, consent, drift
  recovery) renders there instead of inline above the pack cards. The
  tool-usage dashboard stays on the MCP apps list. Docs:
  `docs/user/mini-apps-sources.md`, `docs/dev/architecture.md`.

### Fixed (plan 49 manual smoke, 2026-10-24)- **The pack window never loaded its bridge in dev.** The report window's
  preload resolved `dist/main/preload/preload.js` (one level short — the
  factory compiles into `dist/main/apps/`), so every open failed with
  "Unable to load preload script" and a bridgeless renderer. Now resolves
  `dist/preload/preload.js` like every other window; the factory test
  pins the resolved location. Found by the plan-49 `npm run dev` smoke.
- **The report modal is readable now.** Widened to `max-w-4xl`; the file
  table keeps long paths on one truncating column (tooltip on hover)
  while verdict/confidence/decided-by stay single-line, row actions no
  longer wrap, an aligned `Actions` header (axe-clean), and the table
  only scrolls horizontally as a last resort.

### Added (run report window — plan 49 phase 3)
- **Run reports open in their own window.** Every run row (and the
  in-settings report view) gained an **Open in window** action: the
  constrained, host-owned report window (audited `MiniAppWindow`
  lifetime, closes on pack disable/removal/kill-switch/app shutdown).
  User-initiated opens no longer require the pack to declare
  `ui:window` — viewing stored run data is host behavior; pack-initiated
  opens keep the capability gate. The per-pack window cap now
  **re-targets** the live window to the requested run (audit row swapped
  with a `retarget` close reason) instead of showing a stale report, and
  a failed window open falls back to the in-settings report view.

### Changed (settings IA — plan 49 phase 1)
- **Mini-app pack cards are summaries now; detail lives on pages.**
  Settings → Integrations → Packs: each card shows status/badges/enable
  plus **Configure** and **Runs** actions. Pack settings + docs moved to
  a dedicated Configure page (the future host slot for pack-declared
  `ui:settings`, ADR-0030); run history, diff, quarantine and
  stored-overrides managers moved to a Runs page. Back navigation
  restores focus to the originating card; a routed pack that disappears
  returns to the hub with a notice. The `settings:open`
  `miniAppsReport*` deep-link now lands on the Runs page (payload
  unchanged — `docs/dev/ipc.md` reworded).

### Changed (contracts)
- **Synced `contracts/settings-map.json` from the dev canonical**
  (`3975eb6` — career connector-row + health notes refresh; desktop's
  row unchanged). Byte-identical vendor per ADR-0033; clears the
  wiring gate's `sm` drift.

### Added (crash & permission posture, 2026-10-24)
- **Plan 46 S1 (renderer) — a renderer exception can no longer blank a
  window.** Every window root (launcher/desktop, settings, pack window,
  result viewer) mounts a TEXT-keyed `ErrorBoundary` failure card with a
  reload action (axe-scanned, exclusion-free), and `window.onerror` +
  `unhandledrejection` route through the new validated
  `system:renderer-error` IPC seam into the main-side logger. The install
  is idempotent per window (one stable subscription, disposer returned).
- **Plan 46 S1 (main) — the tray app never dies silently.**
  `uncaughtException`/`unhandledRejection` are logged and swallowed
  (`src/main/crash.ts`); an app-level `child-process-gone` logger covers
  every child, with the sandbox branch pointing at the run record whose
  settlement stays authoritative in `SandboxService`. Persistent windows
  recover from `render-process-gone` (destroy → recreate → one deduped
  notification); transient windows log only. Permission requests pass a
  test-pinned matrix (`src/main/security/permissions.ts`): microphone
  (audio-only `media`) on the app origin only — `file://` plus the dev
  server in dev; camera-carrying media and every other permission are
  denied by default. `secrets.json` is now written owner-only (`0600`)
  on every persist, with a tightening re-write test.

### Added (core-service suites, 2026-10-24)
- **Plan 46 S2 — the services beneath the gates get direct suites.**
  New named suites with `vi.mock('electron')` and a temp-workspace real
  SQLite boot: `MessageService` (CRUD, metadata-envelope round-trip,
  edit/regenerate branch pointers, tree read, active-path switch),
  `ConversationService` (lifecycle, pagination, archive, duplicate,
  export/import, stats), `AttachmentService` (real minimal-PDF text
  extraction, bad-URL rejection, unknown strategy, singleton),
  `HotkeyService` (registerAll, action dispatch, command-binding
  collision skip, config-save re-register, non-editable guard, live
  handlers), `DatabaseService` (wrapper open/cleanup/readiness riding
  the plan-36 migration suite), and a `DesktopAssistant` boot smoke
  (mocked window/tray/IPC: single boot, failed-boot logging, quit path).

### Added (docs + test-foundation consolidation, 2026-10-24)
- **Plan 46 S4 — the testing doc carries the pyramid.**
  `docs/dev/testing.md` gains the four-layer pyramid (unit →
  component/axe → IPC payload/contract gates → Playwright smoke) with
  what each layer owns, the coverage section (per-directory floors, why
  coverage is a separate script), and the E2E smoke section (paths,
  determinism, demo posture). The command table in
  `docs/dev/development.md` lists `coverage` and `smoke:e2e`. STATUS's
  pending-manual list gains the plan-45 renderer-split manual pass; the
  audit's "remove what S1–S3 now cover automatically" review removed
  nothing — every pending item verifies real-on-target behavior (real
  OS focus, real compositor, real providers/external systems) that a
  mocked smoke cannot replace.
- Plan rows: 45 → done (S1–S5, phases 12), 46 → done (S1–S4, phase 13).

### Added (Playwright smoke, 2026-10-24)
- **Plan 46 S3 — the demo harness became a real E2E gate.**
  `npm run smoke:e2e` boots the same reproducible recipe as the tour
  capture (build → vite → mock-assistant/mock-search → Playwright
  driving the real Electron over CDP with a fresh `--demo-fresh`
  workspace) and runs two deterministic paths: **launcher turn** (boot →
  send → state-changing tool → approval card → Allow once → completion →
  the persisted transcript verified in the desktop window) and
  **settings** (API tab → provider card menu → Edit → empty name → the
  exact validation-error copy). Two consecutive green runs observed
  headless; `.github/workflows/ci.yml` gains an `e2e-smoke` job under
  `xvfb-run`. Determinism comes from the scripted mocks.
  Supporting demo changes: `mock-assistant.mjs` gained a scripted
  `memory_save` branch (new prompt, existing scenes untouched);
  `applyDemoConfig` now opts the demo into `stateChanging: 'always_ask'`
  so the approval flow is demonstrable; and demo workspaces keep the
  documented fake credential (`demo-local`) in their isolated config
  instead of scrubbing it into the keyring — demo turns no longer
  require a keyring backend (test-pinned; real providers still scrub).

### Added (coverage gate, 2026-10-24)
- **Plan 46 S2 — a coverage report with per-directory floors.**
  `@vitest/coverage-v8` is wired with glob thresholds set at the
  measured 2026-10-24 levels (rounded down to stable floors, recorded in
  the `vitest.config.ts` comment): main `ai` 82/74, `apps` 65/58, `db`
  88/85, `services` 75/70, `turns` 88/79, `renderer` 70/67, `shared`
  65/72, `packs` 90/86, `preload` 85/95 (lines/branches). Floors rise as
  suites grow and are never lowered without a recorded reason.
  Electron-lifecycle shells (`ipc/` registrars, `window.ts`, `tray.ts`,
  `main.ts`, `ipc-handlers.ts`) are deliberately not gated — they execute
  only under the live app; their parity is proven by the source-level
  IPC/conformance tests and the packaged `--smoke` boot. Coverage runs
  as `npm run coverage`, NOT inside `npm run verify`: v8 instrumentation
  roughly doubles the suite wall time and the commit gate must stay
  fast; the thresholds failed-red check is proven.

### Changed (module boundaries, 2026-10-24)
- **Plan 45 S3 — `CommandService` split into move-only modules.** The
  service becomes a thin public facade with the exact same call surface
  (`src/main/services/CommandService.ts`); catalog assembly (palette
  entry construction + the alias/icon/category tables) lives in
  `services/commands/catalog.ts`, command-definition intake
  (custom commands + integration packs: validate, save, import, remove,
  boot revalidation) in `services/commands/parser.ts`, and invocation +
  history + the agent bridge in `services/commands/execution.ts` —
  mirroring the `src/main/ipc/` registrar precedent. Behavior and all
  public signatures are unchanged; command suites and palette ranking
  goldens pass byte-identical (no test file touched).
- **Plan 45 S4 — `AppsTab` split into sections.** The settings tab keeps
  all state and effects (modal-gated state must persist across
  open/close) and renders four presentational sections under
  `settings-react/apps/sections/`: `AppsListSection` (search, filters,
  instances, budget, master switch), `AppDetailModal` (connection/tools/
  resources/prompts + save footer), `AppPermissionsSection` (entity-scope
  rules + preview), and `AppPresetModal` (catalog, preset connect, custom
  form), with the shared editors/helpers in `sections/shared.tsx`. The
  rendered DOM is identical; apps/axe suites pass byte-identical (no
  test file touched).
- **Plan 45 S4 — `ApiTab` split into groups.** The tab keeps state,
  handlers, memos and the setup/provider modals; the three panels move
  to presentational groups under `settings-react/api/`:
  `ApiProvidersGroup` (cards + first-run card), `ApiModelsGroup`
  (ModelRegistry), `ApiTasksGroup` (assignment pickers) rendering
  `ApiDecisionGroup` (kinds rows + pin meta), with the module constants
  and `DecisionKindRow` in `api/shared.tsx`. Rendered DOM is identical;
  api/decision/axe suites pass byte-identical (no test file touched).
- **Plan 45 S4 — `ChatApp` split into transcript/composer/flow areas.**
  Every hook, ref, subscription and ResizeObserver stays in `ChatApp`
  in the original order (the event-subscription law surface is
  untouched); the JSX moves to presentational areas under
  `chat-react/areas/`: `TranscriptArea` (expanded transcript),
  `ComposerStack` (expanded composer slot: notice/approval/download/
  palette/surface/composer), `ResponseFlow` (compact streaming panel,
  refs passed through unchanged) and `CompactFlow` (compact chrome
  stack). Rendered DOM is identical; launcher/chat/axe suites pass
  byte-identical (no test file touched).
- **Plan 45 S5 — internal noun convergence: `ToolAppService`.**
  `AppService` → `ToolAppService` (file, class and `ToolAppServiceDeps`,
  no re-export shims; imports updated in the same commit) and
  `ai/tools/apps.ts` → `ai/tools/toolapp-selection.ts` (the plan-15
  selection bridge; the `apps/` digest directory and `src/main/apps/`
  keep their names per the family name-map — the collision is fixed on
  the tool-app side only). Dev-facing prose (registry descriptor
  summaries regenerated into `docs/dev/ipc.md`, architecture/STATUS)
  follows the new noun. User-facing copy was already converged (phase 8
  Integrations umbrella); no TEXT keys carried the old noun. Grep gate:
  zero `AppService` occurrences remain.

### Added (MCP resources and prompts, 2026-10-22)
- **Plan 43 S1–S4 — the protocol's content types reach the app.** `McpManager`
  gains `listResources` / `readResource` / `listPrompts` / `getPrompt` over
  stdio and HTTP, riding the same per-server runtime and health/backoff
  discipline as tools, with typed `McpContentError`s over the MCP JSON-RPC
  taxonomy; malformed payloads are dropped or rejected, oversized fields
  capped, and a resource read bounded by `behavior.mcpResourceMaxBytes`
  (default 8 KB). The fixture servers now serve resources + prompts, and a
  hostile fixture set (blank identifiers, oversized fields, injection
  strings, schema-malformed payloads) drives the rejection tests. The
  Apps-tab detail gains **Resources** and **Prompts** sections (read-only
  listing, counts on `apps:get-state`, per-app **Expose resources** toggle
  defaulting OFF, TEXT-keyed trust copy). Prompt templates become palette
  rows under **Integrations** (`source: prompt`) that expand main-side into
  a normal turn and record a `CommandInvocation`-shaped row with
  `source: 'prompt'`. The `mcp_resource` native tool is read-only, category
  `integrations`, kill-switchable, budget-counted like any non-app tool, and
  labels its output as untrusted content. Axe scans extended, exclusion-free.

### Fixed (turn-event subscription lifecycle, 2026-10-22)
- **The launcher's live reply can no longer miss a streaming delta under
  load.** The turn-event bridge is now a **stable singleton**: the
  `useChatSession` transport is memoized once and its hooks read a
  `useLatestRef`, and `ipcTransport.subscribe` registers **one** Electron
  listener — a re-subscribe swaps the handler instead of tearing the
  listener down and racing the gap, and a stale unsubscribe can no longer
  detach a newer subscriber. The `ChatApp`/`DesktopApp`
  `onLauncherNewConversation` / `onSessionSync` / `onLauncherOpenPalette`
  subscriptions now register once with refs too (the `16e4b5d` class
  swept). Root cause of the red gate was **harness-side**: the repro test
  asserted on the library's 33 ms coalescing flush with a fixed 60 ms
  sleep, so a starved worker saw the buffered delta before its flush. The
  test now waits for the render (`waitFor`) and fails loudly if the
  listener is missing; a flush-on-finish invariant pin proves the final
  text is never lost (the `finished` handler flushes synchronously), and
  `tests/ipc-transport-subscription.test.ts` fails on the old
  double-registration bridge.

### Added (notification surfaces, 2026-10-22)
- **Plan 42 S2–S3 — the inbox, the notice parity, the badge and the
  tool mapping.** Settings gains a **Notifications** tab (All/Unread
  filter, mark read, mark all read, clear-with-confirm) over the
  persisted records, read through new `notifications:*` IPC channels
  (registry descriptors + regenerated `docs/dev/ipc.md`). Every record's
  closed `clickAction` routes through one main-side router
  (`notifications:click`) shared by the inbox, the tray and the toast —
  `open-conversation` / `open-settings` / `open-pack-report` /
  `open-path` (the validated artifact rails) / `none`. The launcher's
  notice surface now renders all four severities (`warn` added) and
  shows a notice for each new record. The tray badge counts unread
  `warn`/`error` (numeric title on macOS; tooltip-only on Windows/Linux,
  stated honestly). The native `notify` tool is informational
  (`read-only` → no approval, still kill-switchable) and its output
  reports the record id; `tool_calls` attribution already surfaces it on
  the Usage dashboard. Settings + launcher axe scans extended,
  exclusion-free.

### Changed (unified integrations surface, 2026-10-22)
- **Plan 38 S2–S4 — tool apps render through the family kit.** Added a
  single `ToolAppView → IntegrationExtensionView + instances` adapter
  next to the pack adapter; MCP apps now render through
  `IntegrationInstancesList` and the bundled preset catalog through
  `IntegrationCatalogGrid`, with `IntegrationCard` in the detail view.
  The old library-`Card` tool-app path is deleted. Settings vocabulary
  converges on **Integrations → MCP apps / Packs / Commands** (TEXT
  keys), and the vendored `contracts/settings-map.json` carries the
  dev-canonical desktop row. Kit surfaces now take the G6
  loading/error/empty triad; capability chips carry risk-class marks.
  Apps-tab suites and both settings axe scans were rewritten against the
  kit, exclusion-free.

### Added (Tier-3 presets + semantic ranking, 2026-10-22)
- **Plan 39 W3 — Slack, Discord, GitLab, PostgreSQL insights, Prometheus,
  Todoist — plus Browser pilot.** Six Tier-3 presets and the gated
  browser-pilot preset (its risk pass — navigate/click/fill/type/press =
  state-changing per-call approval; snapshot/get_text/get_url/screenshot
  = read-only — is recorded in the plan and shipped). Fixtures, icons,
  per-preset schema/apply tests and user docs land together.
- **Plan 41 S1–S4 — semantic ranking.** `AiGateway.embed()` audits the
  `embed` task over the sanctioned transport; `EmbeddingService` adds
  content-hash dedupe, packed-float vectors, model-switch prune and the
  pure `profileTextOf`/`cosine`/`rrfFuse` helpers. `selectApps` accepts
  an optional `semanticRank` and fuses 0.6 lexical / 0.4 semantic (RRF
  k=60) only when an embedder is assigned; without it the plan-15
  zero-drift golden order is byte-identical. The assistant graph seam
  degrades to lexical order on any embed failure, and the ApiTab embed
  task help states the off-reason.

### Added (Tier-2 homelab presets, 2026-10-22)
- **Plan 39 W2 — Nextcloud, Jellyfin, qBittorrent, Pi-hole and Frigate.**
  Five reviewed `APP_PRESETS` entries with read-mostly posture, keyring
  `${secret:…}` auth, authored risk maps, entity scoping where stable ids
  exist, no destructive tools, help copy ≤8 lines and prompt notes ≤500.
  Added icon marks, five fixture MCP servers and per-preset schema/apply
  tests; Frigate's `get_snapshot` returns image content (vision-task
  acceptance pin) and Pi-hole's enable/disable is the per-call HITL
  showcase. The five render in the new `IntegrationCatalogGrid`.

### Added (family plan 40 W4 — size ledger, 2026-10-25)
- **Main-process SIZES ledger.** `src/main/SIZES.md` records the family
  service-cohesion law's over-band inventory for the main-process TS
  surface (`src/main/**/*.ts`; band edge ~780 / trigger ~800): seven
  dated rows — accepts for `window.ts` and `services/ToolAppService.ts`
  (single concern), dated declines with re-proposal triggers for
  `turns/TurnManager.ts` (the chat orchestrator; next chat-heavy round),
  `apps/sources/lifecycle.ts`, `apps/composition.ts`, and the
  out-of-layer `ipc-handlers.ts` / `ai/graphs/assistant.ts`
  (informational rows, marked by layer). Record-only round: no code
  moves.

## [0.10.0] - 2026-10-22

### Fixed (voice auto-send frame starvation, 2026-10-22)
- **A short dictation can no longer be discarded as noise when the
  renderer is CPU-starved.** The speech gate was frame-count only
  (`MIN_SPEECH_FRAMES = 20`), so a 400 ms phrase sampled in 2–19 rAF
  ticks was dropped before STT: no `evaluateUtterance`, no send. The
  gate now also accepts 300 ms of elapsed speech, preserving the 60 Hz
  frame floor while making short phrases robust on loaded machines.
  Added a deterministic sparse-frame regression pin and replaced the
  real `setTimeout` level choreography in `voice-indicator` /
  `recording-manager` with scripted audio-level ticks and manually
  pumped `requestAnimationFrame` frames. No timeout inflation, skips or
  assertion weakening.

### Changed (IPC schema registry, 2026-10-21)
- **Plan 44 S1–S4 — every IPC channel is a registry descriptor.**
  `src/shared/ipc/registry.ts` now declares all 204 channels (179
  `invoke`, 10 `send`, 15 main→renderer `event`) with direction, window
  scope, zod request tuple, response type, preload bridge and generated
  summary. `src/main/ipc/register.ts` is the one registration wrapper:
  it parses args, enforces sender-window scope at invoke time
  (`ipc:scope_denied` for a launcher call to a settings-only channel)
  and shapes failures with the `ipc:<code>: message` vocabulary. Every
  registrar migrated and its hand-rolled `typeof`/array validation
  deleted; `live:*` send events are typed `send` and main→renderer
  pushes are typed `event`. `preload.ts` is now the generated
  `createPreloadApi` bridge over the registry; teardown derives from the
  registry; `docs/dev/ipc.md` is generated by
  `node scripts/generate-ipc.mjs` and gated by a regen-and-diff test.
  Added wrapper, registry-structure, preload-bridge and one-pattern
  suites.

### Changed (conversation branching complete, 2026-10-21)
- **Plan 40 S2–S4 — branching is end-to-end.** Added the
  `messages:edit` / `messages:regenerate` / `messages:select` /
  `conversations:tree` IPC intents through the preload bridge.
  `MessageService` now writes edit/regenerate siblings, flips exactly one
  pointer on select, decorates the re-walked active path, and keeps
  `branchedFrom` provenance. `ConversationService` reads only the active
  path, so hidden subtrees never reach the renderer. `TurnManager` derives
  health-H2 per-branch checkpoint threads (`{conversationId}` on the
  spine, `{conversationId}:{branchTipId}` on a branch), deletes an
  abandoned pause on a fresh turn, and queues a second same-conversation
  send behind the active turn. The desktop inspector composes the library
  `ChatBranchTree`; both windows compose `ChatMessage`'s
  `MessageVariantSwitcher` + `ChatMessageEditor`. Export writes the full
  tree (Markdown active-path markers + JSON pointers); model history stays
  active-path-only. Added deterministic intent/lock/approval-branch tests,
  thread-key and retention-form tests, UI composition tests and
  exclusion-free branching axe scans.

### Fixed (commit-phase event-contract sweep, 2026-10-21)
- **Live-mode Escape is the third commit→subscribe bug class, and the
  renderer sweep closes the class.** The desktop live/mini-app Escape
  handlers and `ChatApp`'s keyboard handler now subscribe once in
  `useLayoutEffect` and read current state/callbacks through latest refs;
  `LauncherMenu`, `FundCard`, `ScreenPicker`, the Composer attach menu,
  `HotkeysTab` and push-to-talk attach in the commit phase (with latest
  refs for close callbacks); the launcher hide-on-blur policy now reads
  live state from refs instead of re-subscribing per state change. The
  `CommandPalette` was already fixed in
  `5f81fa9`, the run-card in `d216aa2`; this is the same law — an event
  dispatched at the exact observation boundary must see current state.
  Added a deterministic live Escape pin (speaking ⇒ interrupt, listening
  ⇒ stop, with a listener-count assertion) that fails on the old passive
  re-subscribe handler.

### Fixed (full-load voice test headroom, 2026-10-21)
- **Real-timer voice suites no longer race the full worker load.**
  `recording-manager` and `voice-indicator` use explicit 10 s
  `vi.waitFor` windows for their 60 ms product timers; assertions are
  unchanged. The recurring run-to-run failure was a timing ceiling, not
  a product behavior change.

### Changed (branching persistence, 2026-10-21)
- **Plan 40 S1 — the conversation tree exists.** Message creation now
  writes the family pointer invariant: the first message sets
  `Conversation.activeRootId`, later messages are children of the active
  tip and the tip's `activeChildId` points at the new child. Message
  reads walk that active path; `getMessageTree` exposes the full tree,
  and every message carries `parentId` / `variantIndex` / `variantCount`
  / `siblingIds`. User select/edit pointer flips remain plan 40 S2 (no
  IPC or renderer surface in this stage). Tree-building, walk and a
  random-sequence walk-length property suite cover the invariant.

### Changed (turn-layer split, 2026-10-21)
- **Plan 45 S2 — `TurnManager` is split move-only.** The state machine
  and public entry stay in `TurnManager.ts`; approval wait/grants live in
  `approvalGate.ts`, title generation in `titles.ts`, memory
  recall/history shaping in `recall.ts`, assistant persistence in
  `persist.ts` (thin `MessageService` call), and turn/rule notifications
  in `notify.ts` (thin `NotificationService` path). Public types and
  `capTraceSteps` / `buildMemoryContextBlock` remain re-exported from the
  same module, so call sites do not change; trajectory, approval/resume
  and persistence assertions are unchanged.

### Fixed (T2 update-consent fallback, 2026-10-21)
- **A T2 install's update consent can no longer fall back to the T0
  label.** `updateConsentView` now uses `install.tier ?? 'T0'` in the
  synthetic no-candidate payload, with a test pinning a T2 install +
  update-available + missing candidate to T2.

### Changed (one notification creator, 2026-10-21)
- **Plan 42 S1 — notifications are persisted and routed through one
  service.** Added main-side `NotificationService` over the plan-36
  `Notification` table: severity (`info|success|warn|error`), dedupe by
  `dedupeKey` with `payload.count` bumps inside
  `behavior.notifyRate.dedupeWindowMs`, per-source rate limiting inside
  `behavior.notifyRate.windowMs`, and the closed click-action routing
  table (`open-conversation` / `open-settings` / `open-pack-report` /
  `open-path` / `none` + `sourceRef`). Migrated the turn, schedule,
  pack-run, renderer `notification:show` and native `notify` paths; no
  direct `new Notification(` remains outside the service (grep gate).
  Notifications ride the plan-36 boot retention pass.

### Added (Tier-1 preset wave, 2026-10-21)
- **Plan 39 W1 — five reviewed tool-app presets.** Added **GitHub**,
  **Google Calendar**, **Obsidian**, **Notion** and **Spotify** to
  `APP_PRESETS`: endpoint/transport, one keyring-only auth slot per
  preset (stdio env or HTTP bearer), ≤8 help lines, authored prompt
  notes, read-mostly risk maps, relevance exposure and entity scoping
  where the plan specifies it (Obsidian paths, Spotify tracks). No
  destructive tools, no `always` default, no `set_volume` overlap.
  Added the five icon marks, five stdio fixture MCP servers, schema /
  apply / exposure / scope / axe tests, and one user-guide section per
  preset. The add flow now builds stdio command/args from the endpoint
  and writes env or bearer credentials to the keyring.

### Changed (integration truth fields, 2026-10-21)
- **Plan 38 S1 — tier, status and update truth reach the cards.**
  `AppInstanceStatus` is now written by the MCP health snapshot
  (`AppService`/`McpManager` states), pack reconcile/self-disable and
  run outcomes, and read back into `apps:get-state` /
  `miniapps:get-state` as the family vocabulary (`ok | degraded |
  failing | stale` + `lastSuccessAt` / `consecutiveFailures` /
  derived `needs-config` / `needs-secret`). `packCardView` derives tier
  from provenance (`T2` sandboxed, `T1` bundled, `T0` declarative) and
  carries update state + instance status metadata; source installs carry
  their consent tier. A T2 card therefore renders the T2 badge instead
  of the previous hardcoded T0.

### Fixed (live run card mount race, 2026-10-21)
- **A `run:items` burst arriving as a run card mounts is no longer
  dropped.** `MiniAppRunCard` registered its `miniapps:run-event`
  subscription in a passive effect, so the card DOM could be observable
  before the listener existed; two synchronous coalesced batches hit an
  empty listener set and the live tally stayed at 0 until the
  `run:finished` metadata refresh. The subscription now runs in
  `useLayoutEffect` (the `5f81fa9` precedent) and the card withholds its
  DOM until the pack's live-card spec resolves, so the first observable
  render already has final labels and a live accumulator. Added a
  deferred-spec regression test (events emitted before spec resolution
  are counted; pack labels never swap to defaults) and a global no-op 2D
  canvas stub (`tests/setup/canvas.ts`) to silence jsdom `getContext`
  warnings without adding the native canvas package.

### Fixed (suite gate stability, 2026-10-21)
- **The full suite no longer races its own worker load.** Two tests that
  pass in isolation (an axe scan test at 663 ms and a chained jsdom
  `ChatApp` flow at 1,355 ms) exceeded Vitest's 5 s default under
  238-file contention. `vitest.config.ts` now sizes the heavy classes for
  the full suite (`testTimeout`/`hookTimeout` 20 s) and caps
  `maxWorkers` at 8 on a 16-core host; `isolate: false` was rejected
  because module-level caches/singletons and jsdom globals would leak
  across files. No per-test timeouts, skips or assertion changes. The
  `docs/STATUS.md` verify description now names the three contract gates.

### Changed (shared layering, 2026-10-21)
- **Plan 45 S1 — `src/shared` is main-free again.**
  `PdfProcessingStrategy` moved from
  `@main/services/AttachmentService` into `src/shared/types.ts`; the
  attachment service imports it from shared. A source gate
  (`tests/shared-layering.test.ts`) fails if any file under `src/shared`
  imports `@main`.

### Changed (drift gates, 2026-10-21)
- **Plan 37 S3 — the truth walls are executable.** Added the
  retired-terms test (README/STATUS/AGENTS free of the retired engine,
  "Whisper-compatible" and stale counts), an IPC doc-coverage test (every
  registered channel appears in `docs/dev/ipc.md` by exact name; retired
  channels stay out), and a hash-stamped
  `contracts/extension-contract.sync.json` checked by
  `scripts/check-extension-contract-sync.mjs` (byte-identical to the dev
  canonical when present, hash-only in CI). `npm run verify` now names
  `verify:ext-contract`, `verify:app-pack-contract` and
  `verify:extension-conformance`. Every gate was proven red on a
  deliberate break, then green.

### Changed (docs truth, 2026-10-21)
- **Plan 37 S2 — the truth surfaces match the app.** `docs/STATUS.md`
  is rewritten around the real release (v0.9.0), real test count and the
  plan 26–48 table, with retired material moved to `## Superseded` and
  the pending-manual list pruned. README drops the retired decision
  engine and "Whisper-compatible" copy, stale counts and the done
  roadmap. `AGENTS.md` maps the four renderer entries, `src/main/db/`,
  `src/main/apps/`, `docs/dev/sdk/`, `contracts/` and `scripts/app-pack`.
  `docs/dev/ipc.md` covers the full registered channel list. The dev
  plan index (`plans/00-overview.md`) is refreshed to plans 01–48.

### Changed (schema flatten, 2026-10-21)
- **Plan 36 S5 — the ladder is flattened.** The plan-36 conversion ran
  on the owner's real profile (backup left beside it), then the union was
  folded into `schema.sql`, `user_version` was re-baselined to head `1`,
  and `001-roadmap-union.ts` was deleted. Fresh boot is `schema.sql` +
  `user_version = 1`; an existing head DB opens; a pre-plan-36
  (`user_version` 0) DB is refused with a plain TEXT-keyed message — no
  compatibility path. Convergence now means fresh vs existing head, with
  the old snapshot used only to prove the refusal.

### Changed (drift wall + retention, 2026-10-21)
- **Plan 36 S4 — schema drift is a gate and retention is one pass.**
  `tests/schema-drift.test.ts` parses the generated `schema.sql` and
  compares tables, columns/types and indexes against a booted database
  via `PRAGMA` introspection (a deliberate mutation is proven red).
  `runRetentionPrune` (`src/main/db/retention.ts`) is the one boot prune
  pass: checkpoints/graph runs 7 days, notifications 30 days, tool
  results 7 days, and `AiCall`/`ToolCall`/`CommandInvocation` keep-all
  until `behavior.retention` windows are set. The old separate
  graph-node/command-history boot prunes were deleted.

### Changed (config versioning, 2026-10-21)
- **Plan 36 S3 — `config.json` is versioned and strict.** Added
  `schemaVersion` (1) with a transient `CONFIG_UPGRADES` ladder; load
  parses, upgrades, strips unknown keys (top-level and fixed nested
  sections), serves and persists the normalized config; save runs the
  zod config envelope + shape strip, so unknown keys never reach disk.
  `importConfig` rides the same path.

### Changed (JSON envelope registry, 2026-10-21)
- **Plan 36 S2 — every `Json` column has a typed envelope.** Added
  `src/shared/schema/` zod schemas (passthrough, additive-only) for turn
  metadata, attachments, conversation metadata, schedule specs, memory
  tags/provenance, image paths, command args, mini-app run totals/item
  evidence/proposal payload+outcome, sandbox state, notification
  payload, automation trigger/action and connector scopes.
  `TurnMetadata` now lives in the registry and is re-exported by
  `src/shared/turns.ts`; all in-repo importers point at the registry.
  Write paths (MessageService, ConversationService, ScheduleService,
  MemoryService, ToolResultService, CommandService, the mini-app
  stores) validate before storing; read paths parse leniently with
  defaults. `MiniAppProposal.payload` carries `v: 1`.
  `CommandInvocation.args` is stored as the envelope object rather than
  a JSON-encoded string.

### Fixed (palette keyboard race, 2026-10-21)
- **The command palette attaches its keyboard handler in the commit
  phase.** The global keydown listener and the selected-row reset were
  passive effects, so under worker load the listbox could be observable
  while Enter/arrow keys were not yet handled — the mini-app pad tests
  caught it as an intermittent dropped Enter. Both now run in
  `useLayoutEffect`; the palette is never painted before its keyboard
  contract is live.

### Changed (schema foundation, 2026-10-21)
- **Plan 36 S1 — one schema, one boot path.** `prisma/schema.prisma` now
  carries the roadmap union: `Message.parentId` / `Message.activeChildId`
  / `Conversation.activeRootId` (plan 40 branching), `Embedding` (plan
  41), `Notification` (plan 42), `AppInstanceStatus` (plan 38),
  `Automation` and `ConnectorAccount` (plan 48), with
  `Message(conversationId, parentId)` and the dedupe/status indexes.
  `src/main/resources/schema.sql` is regenerated from it. `src/main/db/`
  owns boot: fresh = `schema.sql` + `user_version = head`; existing =
  forward-only numbered modules keyed to `user_version` (migration 001 is
  the additive union and also recreates the `MiniAppSandbox*` tables an
  older profile never gained). `ensureTable`/`ensureColumn` are deleted
  from `DatabaseService`, which is now open + boot + lifecycle only;
  WAL, `foreign_keys=ON` and `busy_timeout=5000` are applied once at open.
  New closed vocabularies live in `src/shared/schema/vocab.ts`; the
  schema contract is `docs/dev/data-model.md` (IDs/timestamps, JSON
  envelopes, retention, index rule). Tests cover fresh-vs-upgraded
  convergence (tables, columns, indexes), data survival and the real
  dev-profile conversion shape.

### Changed (T2 honesty gate, 2026-10-21)
- **Plan 47 S1 (W0) — code packs are blocked while the sandbox grade is
  `none`.** The desktop charter reports `t2Isolation: none` on Linux,
  macOS and Windows, so T2 import (sources pipeline `landInstall`) and
  enabling (`MiniAppRegistry.setEnabled`) now refuse with a plain
  explanation instead of running unconfined. The consent dialog and the
  Apps-tab disclosure read the grade from `miniapps:host-profile`
  (charter data, rendered verbatim) and the user safety doc now states
  the real posture instead of claiming files/environment/network
  isolation. `desktopT2Isolation()` moved main-side
  (`src/main/apps/isolation.ts`); shared mapping exposes only the pure
  `t2IsolationForPlatform(platform)` reader.

### Changed (no-legacy sweep, 2026-10-21)
- **Plan 37 S1 — the corpse code is gone.** Deleted the alternate
  `ai:generate-response` chat path (IPC channel, `AIService.generateResponse`,
  the renderer service and its `ElectronAPI` method), the unsettable
  `DecisionSettings.legacyEngineNotice` (field, settings notice and text
  keys), the 12 IPC channels with no preload consumer (`log:*`, `dev:*`,
  `dialog:*`, `system:get-arch`, `config:get-path`,
  `window:set-always-on-top`, `attachment:download`, `system:quit-app`),
  the shadowed `src/shared/constants.ts`, the `convertToImage` TODO and the
  untracked root `.astro/` directory. The already-run load-time
  migrations were deleted outright, not renamed: the retired
  `config.stt` → `taskAssignments[stt]` seed, the
  `tools.mcpServers`/`mcpToolOverrides` → tool-apps conversion, the
  superseded hotkey-default rewrite and the `mcp:<id>:*` →
  `app:<id>:*` keyring re-namespacing (with their tests). A vitest source
  gate (`tests/no-legacy-markers.test.ts`) now fails on any
  `TODO`/`FIXME`/`legacy`/`deprecated` marker in handwritten `src/`
  code.

### Changed (storyboard tour, 2026-10-20)
- **The visual tour is now a storyboard, not a slideshow** (family
  ui-capture template v1.3.0). `scenes.mjs` declares chapters with
  `beats` (actions → wait → frame, per-frame caption + GIF dwell time);
  `tour.manifest.json` v2 carries the frame list, and the GIF assembler
  builds an ffmpeg concat timeline with exact per-frame durations on a
  fixed 800×420 stage (typing frames short, answers long). Seven
  chapters: launcher ask (type → send → stream → answer), web search
  (real `web_search` call + trace timeline), slash palette, calculator,
  translate, desktop conversation, AI settings (providers + the full
  provider preset catalog).
- **Real demo turns without a provider.** `--demo-fresh` starts from a
  clean isolated workspace; demo boot provisions a local `demo-local`
  assistant provider (model `demo-assistant`) and a local SearXNG
  provider. `mock-assistant.mjs` (scripted stream + tool call, with a
  mid-answer pause for the streaming frame) and `mock-search.mjs`
  (deterministic results) make the captured states real UI, not staged
  stills. `run-demo-capture.sh` starts vite + the three mocks + a fresh
  app, captures, and cleans up only its own processes.
- **Launcher captures use the real window.** cdp viewports with
  `"height": "auto"` never emulate: the runner waits for the app's
  content-driven size and screenshots the real viewport; fixed viewports
  (desktop 1080×720, settings 880×780) resize the real window through its
  own IPC. The fixed launcher heights from the previous entry are
  superseded — content changes cannot clip a frame.
- Gallery: chapter still + a `#### Storyboard` section with every frame
  (plain Markdown — the docs ingestion rejects raw HTML blocks). Website:
  `sync-tours.mjs` vendors the GIF, the manifest (`tour.json`) and the v2
  stills/frames; project pages offer **Story** scrollytelling (desktop
  default — sticky stage, one chapter still at a time, localized mottos,
  scroll rail) and **Play** (the manifest player, mobile default), with
  the choice remembered and the GIF as the no-JS/README/JSON-LD fallback.

### Fixed (launcher resize race, 2026-10-20)
- **Reloading the launcher could leave the window at 98 px under a 121 px
  chrome** (clipped composer/meta strip). The eased resize early-returned
  when a request matched the transient current size while an older target
  was still animating, so the stale 98 px target won. `resizeTargetChanged`
  (`src/main/windowAnim.ts`) now queues every request while a resize is in
  flight; `tests/window-anim.test.ts` pins the reload case.

### Fixed (launcher tour viewports, 2026-10-20)
- **The tour's launcher viewports track the conversation meta strip.**
  The permanent `New chat` / message-count line added above the compact
  composer grew every launcher state by 19 px, so the fixed capture
  viewports cropped the top and bottom off the idle, calculator and
  translate shots (the window was taller than the emulated viewport).
  `capture.viewports` now mirrors the real content heights (idle 121,
  calculator 207, translate 236); those three scenes were recaptured and
  the GIF rebuilt. Desktop/settings viewports are unchanged (fixed-size
  windows), and `docs/dev/visual-tour.md` now calls out that launcher
  heights are content-driven and must be re-measured after chrome
  changes.

### Changed (transparent tour captures, 2026-10-20)
- **The visual tour is captured on a transparent background** (family
  ui-capture template v1.2.6): `capture.transparentBackground: true`
  screenshots with Playwright's `omitBackground`, so the rounded
  frameless windows land on an alpha canvas and the animated GIF pads
  its shared canvas transparently (palette with a reserved transparent
  entry) instead of dark — PNGs and GIF composite onto light and dark
  surfaces (README, docs, website). All eight scene shots +
  `docs/images/visual-tour.gif` regenerated; the option lives in the
  family template (`the family template/scripts/ui-capture`, synced via
  `sync-ui-capture-template.sh`), never as an in-repo patch.

### Added (pack docs surface, 2026-10-19)
- **Mini-app packs document themselves in-app** (plan 34 wave 8): the
  Mini-apps settings cards gain a **Docs** action for packs whose
  manifest carries the docs pointer; the main process serves the pack's
  validated `docs/docs-tree.json` + pages over two guarded IPC channels
  (`miniapps:docs-tree` / `miniapps:docs-page` — handler-side argument
  validation, only tree-listed files readable, every read
  containment-checked inside the pack's docs dir, byte-capped, raw HTML
  neutralized fence-aware). The renderer opens the kit's DocsDialog on
  the landing page (audience badges, kit markdown); bundled packs' docs
  ship in packaged builds (`extraResources`: `src/packs/*/docs`).
  Red-checked in `tests/pack-docs.test.ts` (pointer absence ⇒ honest
  absence; invalid tree ⇒ error, never half-served; non-listed files,
  `../` escapes and absolute paths refused; fence/inline-code/autolink
  exemptions).

### Changed (manifest unification, 2026-10-19)
- **ONE manifest filename, ONE form family-wide: `manifest.json` at the
  bundle root — a file, never code-declared.** The reference data pack's
  manifest file is renamed accordingly; `mini-calc` and `mini-translate`
  no longer declare their manifests in TypeScript via `definePack` — the
  payloads are extracted to
  `src/packs/<id>/manifest.json` (validated exactly like the reference
  data pack; the `.ts` files that remain hold only behavior:
  `evaluate.ts`/`renderer.ts`). `definePack` stays as the authoring
  builder (it serializes to `manifest.json` — the CLI's `init` scaffolds
  that file under its new name; the earlier scaffold filename is
  retired). The
  code/data registration split (`BUNDLED_CODE_PACKS`/`DATA_PACKS`)
  collapses into `ALL_BUNDLED_PACKS`; CI re-validates every
  `src/packs/*/manifest.json` on disk and fails on an unregistered
  directory. D18 clean break: no compat aliases, no fallback readers,
  no dual forms (the pack contract itself is unchanged — same packKind,
  same integer apiVersion lineage; only the filename).
- **Envelope-shared optional fields on the mini-app kind** (canonical
  dev contract first, re-vendored + regenerated):
  `author`, `license`, `repository` (provenance — rendered verbatim,
  D25), `categories` (the charter's closed browse vocabulary, mirrored
  into the pack contract), and `docs` (the plan-34 §10.3 per-extension
  documentation pointer, const `docs/docs-tree.json`). Append-only
  within apiVersion 1 — no version bump. The validator, the generated
  JSON Schema, the settings wire view (`MiniAppView`) and the kit card
  mapping (`packCardView` renders provenance + narrowed categories)
  carry them; the envelope→pack projection passes them through instead
  of dropping them. The import pipeline validates the docs binding at
  discovery: a manifest with the pointer whose tree is missing/invalid
  rejects exactly like an invalid manifest (`docsTree.ts` mirrors the
  wall semantics; the docs-tree schema is now embedded in the main
  process via the artifacts sync).
- **The three bundled packs fill the shared fields honestly and gain
  docs trees**: author `Neuronection`, license `Apache-2.0`, the repo
  URL; categories file-deletion-review `files`+`utilities`,
  mini-calc `utilities`, mini-translate `productivity`; real
  `docs/` trees per the wave-7 contract (the flagship
  file-deletion-review ships overview/usage/security/troubleshooting;
  the surface packs overview+setup) — validated by a new bundled CI
  gate.
- Rider (pre-existing drift repair): `extension.generated.ts` is
  regenerated — the vendored extension-contract artifacts embedded in
  the main process had drifted (the wave-7 envelope `docs` pointer
  landed in `contracts/` without the embedding regeneration; both the
  drift gate and the D23 fixture wall were red on `main`).

### Fixed (security — audit remediation F9, 2026-10-18)
- **Attacker-authored config patterns can no longer ReDoS the host**:
  imported `configSchema` string patterns are validated by a timeout-safe
  static guard at import (`src/shared/app-pack/safePattern.ts` — refuses
  a quantifier iterating more than once over a group that already
  contains one, backreferences, quantifiers inside lookarounds, and
  unbounded counted repetitions); pattern application against values is
  bounded to 256-char subjects with a typed issue beyond. The audit repro
  (pattern `(a+)+$` with an adversarial default previously wedged
  `validatePackConfig` synchronously — the main process hung past any
  test timeout, demonstrated pre-fix) now answers a typed import
  rejection in milliseconds; the guard's unit wall pins the
  refused/accepted classes (family patterns all stay accepted).

### Fixed (security — audit remediation H4, 2026-10-18)
- **Consent is main-verified, never renderer-assertable** (audit
  2026-10-18 §4 H4): `miniapps:source-install` /
  `miniapps:source-apply-update` no longer take a boolean — the renderer
  echoes the `{digest, capabilities}` the consent surface DISPLAYED and
  main re-derives both from the freshly-refetched content at land time,
  refusing on any mismatch; the persisted consent record binds only
  main-computed values (`extensionId`, digest, capability set, main
  clock). Forged consent (a boolean, a wrong digest, a grown capability
  list) is refused — closing the compromised-renderer → self-consent →
  T2 install chain when combined with the C1 fix.
- **Local file-path sources are production-gated fail-closed** (the
  vendored sources schema's own MUST clause, previously unimplemented):
  packaged builds refuse the `local` ref kind at add/sync/install/apply
  seams — https git sources only; dev boots (running from source) keep
  local sources. Path confinement (absolute, traversal-free) was already
  structural and stays.

### Fixed (security — audit remediation C1, 2026-10-18)
- **The Tier-2 sandbox realm-crossing escape (CRITICAL, audit
  2026-10-18 §3)**: the invoke `input` and every capability reply/error
  crossed into the vm context as outer-realm objects, handing pack code
  the child's real `Function` constructor — and through it the full Node
  surface (`fs`, `net`, `child_process`), bypassing quotas, audit and
  net-denial. Every crossing is now MARSHALLED: serialized outside the
  context, parsed INSIDE by context-realm `JSON.parse` (`parseIn` at the
  dispatch seam, the in-context parse in `resolveReply`); an unclonable
  input answers typed `invalid` instead of crashing the child. The
  permanent adversarial wall
  (`tests/app-pack-sandbox-realms.test.ts`, real child + a structural
  source wall on the marshalling seams) asserts the constructor escapes
  die (typed error or `undefined`), realm identity of input/nested
  args/replies, and that benign `globalThis` typeof-chain probes answer
  data instead of crashing the sandbox (the wave-4 rider, now walled).

### Changed (docs — plan 34 wave 3, 2026-10-17)
- **The pack SDK doc set** (`docs/dev/sdk/`, ten chapters + a validated
  `docs-tree.json`): app-packs.md + pack-authoring.md are merged into the
  chaptered set and DELETED; user-facing pack pages split out under
  `docs/user/` (mini-apps stays the entry; new: import-from-git/sources +
  consent how-to, the sandbox safety model, troubleshooting). Quickstart
  carries real `app-pack` CLI transcripts (init/validate against
  `src/packs/file-deletion-review`); the set's tree validates against the
  vendored family `docs-tree.schema.json` (new sync target +
  `tests/docs-tree-contract.test.ts` in the gate); product docs-tree and
  all references re-pointed.

### Added (Tier 2 reference + adversarial packs — plan 32 S5 / ADR-0030, 2026-10-17)
- **The reference Tier-2 pack** (`tests/fixtures/sandbox/reference-pack/`)
  + the completed escape matrix
  (`tests/app-pack-sandbox-adversarial.test.ts`): memory bomb ⇒ heap
  cap / watchdog death ⇒ self-disable (bounded, isolated), prototype
  pollution via IPC payloads stays inert data (`Object.prototype`
  asserted intact), secret sniffing finds nothing (scrubbed env, no
  process, placeholder-only), `process.exit` attempts are denied with
  a clean typed end, bytes/day exhaustion answers `budget`, and the
  full-surface reference run (state + items + events + secrets
  placeholder + typed `net-denied`) passes through a pipeline install.
  User docs state the sandbox safety model in plain language.

### Added (Tier 2 import UX + consent — plan 32 S4 / ADR-0030, 2026-10-17)
- **Tier-2 code packs ride the Phase-8 sources pipeline**: discovery
  classifies per directory (family envelope ⇒ T0; `code`-carrying
  manifest through the sandboxed normative validator ⇒ T2; everything
  else fails loudly), the consent payload carries the charter's T2
  sandbox disclosure VERBATIM + capabilities verbatim + the CONTENT
  digest (career tree algorithm — code drift on a pinned ref is a loud
  `digest-drift`), landing copies the whole subtree and re-verifies the
  digest of the landed copy before install, every T2 update re-consents
  (no code auto-apply window), direct manifest imports of code packs
  are refused, kill switches tear the live sandbox down, and scheduled
  execution stays report-only structurally (surface-kind + no
  fs-write-quarantine/run ⇒ the arm gate is unreachable).
  `tests/app-pack-sandbox-import.test.ts` (e2e over the staged
  transport; the charter-drift wall pins the sandbox grant set against
  the vendored charter tier table).

### Added (Tier 2 declarative contributions — plan 32 S3 / ADR-0030, 2026-10-17)
- **Sandboxed code packs contribute commands through the existing
  declarative vocabulary** (`src/main/apps/contributions.ts` + the
  `miniapps:command-execute` channel): namespaced contribution ids
  (validator-enforced shape) map 1:1 to sandboxed ops — logic in the
  sandbox, rendering host-side, the result crossing as data; the
  renderer never imports pack code. The palette lists enabled sandboxed
  commands as `miniapp:cmd:<packId>:<commandId>` entries (Tier-1 host
  bindings keep priority); dispatch refusals: unknown/disabled pack,
  undeclared command id, sandbox death (self-disable + surfaced
  reason). No new visual components from pack code (ADR-0030 clause 3).

### Added (Tier 2 capability RPC — plan 32 S2 / ADR-0030, 2026-10-17)
- **The audited capability seam lands** (`src/main/apps/sandbox/capabilities.ts`
  + the session router in `SandboxService.ts`): every frame validates
  against the vendored capability-rpc schema both directions; the closed
  method vocabulary serves `cap.state.get/set` (host-persisted,
  quota'd), `cap.items.emit` (typed, atomic batches),
  `cap.secrets.need` (status + placeholder only — values stay in the
  keyring), `evt.progress`/`evt.log` (rate-capped observations) and
  answers `cap.net.fetch` with the typed **net-denied** (the v1 seam
  stance, ADR-0030 clauses 4/6 + plan D4). Quotas (per-invoke calls,
  per-pack calls/minute ring, bytes/day bucket) fail typed `budget`;
  **one `MiniAppSandboxCall` audit row per capability call** — success
  or failure — with argsHash, callNumber, outcome and duration. The
  charter's 15-code error envelope + default retryable map
  (`DEFAULT_RETRYABLE`) is the one vocabulary across the seam; the
  vendored rpc fixtures run through the embedded schema gate in CI.

### Added (Tier 2 sandbox spine — plan 32 S1 / ADR-0030, 2026-10-17)
- **The Tier-2 sandbox lands** (`src/main/apps/sandbox/` +
  `src/main/resources/sandbox-child.cjs`): one `utilityProcess` per
  imported code pack (ADR-0030 clause 1), spawned ONLY from
  digest-pinned installed content (manifest object digest + a recursive
  content tree digest the child re-derives before any pack byte runs),
  frozen module surface (fresh vm context, capability client + pure
  surface only — no require/process/fetch/WebSocket/timers/dynamic
  import; the `.constructor.constructor` host escape is structurally
  dead), wall-clock + memory watchdogs per call and lifecycle, a
  concurrent-sandbox cap answering typed `budget`, per-pack kill
  switches (disable/remove/master-off/app-quit), boot reconciliation
  (`interrupted` ≠ pack failure) and sandbox death ⇒ pack self-disable
  with the surfaced reason. The vendored capability-rpc schema now
  embeds verbatim (`CAPABILITY_RPC_SCHEMA`) via the extension-artifacts
  generator; the validator + registry unlock the Tier-2 pack shape
  (`code` + `contributions` + the sandbox capability set under
  provenance-derived `sandboxed` validation; direct imports of code
  packs are refused — Tier 2 installs ride the sources pipeline).
  Escape matrix: `tests/app-pack-sandbox.test.ts` (real processes, no
  mocks at the process boundary).

### Changed (the integrations UI swap — plan 33 Phase C / ADR-0040 D25, 2026-10-17)
- **The mini-apps settings surfaces render through the family
  integrations kit** (`@neuronection/assistant-ui`): pack cards →
  `IntegrationCard` (with `IntegrationConfigForm` in the card's detail
  slot for pack settings), the Phase-8 sources block →
  `IntegrationSourcesList` + `AddIntegrationSourceDialog` +
  `ConsentDialog`, installed-from-source packs → kit instance rows
  grouped under their source; an app-owned kit instances card keeps
  removed-source parks visible and restorable. The hand-rolled local
  components (`SourceCard`, `InstallCard`, `ConsentModal`,
  `AddSourceModal`, `ConfigField`) are deleted same-commit (plan-28
  precedent). Desktop-specific surfaces stay app-owned and compose into
  the kit's slots: PackRuns, QuarantineManager, OverridesManager,
  DiffModal, import-from-file, remove confirmations;
  `renderInstanceActions` hosts the pin/consented line, the split
  auto-apply vs re-consent update buttons, and restore.
- **The wire→kit mapping is pure and tested**
  (`src/renderer/settings-react/apps/integration-views.ts` +
  `tests/integration-views.test.ts`): pack registry views, flattened
  config fields, sources/candidates/installs and consent payloads map
  onto the kit's `integration-contracts` view-models — capabilities
  narrow through the kit's generated vocabulary, consent law text maps
  verbatim, `absent-from-source` rides instance metadata, and the kit's
  `IntegrationSourceDraft` converts to the same validated-descriptor
  document as before (validation stays main-side). Config values reach
  `saveMiniAppConfig` null-stripped — the wire shape is unchanged.
- **Labels**: every kit label prop is fed from `TEXT` (new keys:
  `MINIAPPS_ENABLE`, `MINIAPPS_DISABLE`, `MINIAPPS_ENABLE_ARIA`,
  `MINIAPPS_CONFIG_CHIP_ADD`, `MINIAPPS_CONFIG_CHIP_REMOVE`,
  `MINIAPPS_CONFIG_ENUM_PLACEHOLDER`,
  `EXT_SOURCES_CONSENT_RECONSENT_TITLE`, `EXT_SOURCES_CONSENT_VERSION`,
  `EXT_SOURCES_CONSENTED_AT`, `EXT_SOURCES_CHANGES`,
  `EXT_SOURCES_ADDED_CAPABILITIES`, `EXT_SOURCES_UPDATE_BADGE`,
  `EXT_SOURCES_UPDATE_RECONSENT`). Suites updated same-commit:
  `tests/miniapps-sources-ui.test.tsx` (kit testids) and
  `tests/a11y-settings-miniapps.test.tsx` (kit surfaces, still
  exclusion-free) plus the new mapping suite; the byte-stable pack
  tests are untouched.
- **The library pin moves to ^0.68.0** (the owner's next publish wave (0.68.0) —
  surface-renderer + the integrations kit, one Version-Packages run;
  the lockfile resolves from the registry then — local dev runs the
  kept library tarball overlay, the career Phase-B precedent). Consent
  copy keeps rendering VERBATIM from the charter payload, and secrets
  never cross kit props (desktop pack config declares no `x-secret`
  fields).

### Added (extension sources — plan 32 Phase 8 / ADR-0040 D13+D15+D22+D25, 2026-10-16)
- **Extension sources: import packs from a git URL or a local folder**
  through the family sources pipeline — the TS adoption of the Phase-3
  career reference semantics against the SAME vendored schemas
  (`contracts/extension-{charter,manifest.schema,sources.schema}.json`
  + the fixture walls now vendor byte-identically into the repo; the
  dev sync script carries desktop TARGETS and the `ext` probe flips
  OK). One pipeline for both kinds: resolve (ls-remote, four ref
  strategies) → constrained shallow fetch (`git clone --depth 1`,
  allowlisted executable resolved once, argv-array only — no shell, no
  interpolation, refs schema-validated before any spawn, 30 s timeout,
  credentials via GIT_CONFIG_* env from keyring slots) → manifest
  discovery (root + one level) → envelope validation (the vendored
  family schema through the extended draft-2020-12 interpreter — it now
  covers `not` + `contains`) → host-profile compat → per-extension
  consent → pinned install. The local kind is the schema's structurally
  distinct variant (absolute path, no `..`); it rides the same git
  transport with the path as origin.
- **The family envelope is importable via an explicit, tested mapping**
  (`src/shared/app-pack/mapping.ts`): kind mini-app + packKind
  assessment with the charter desktop-profile `honors` capability set
  (`fs-read, fs-write-quarantine, decision, llm, run, report, propose,
  ui:window`). `net` is the exfiltration-class T0 rejection; unhonored
  capabilities, surface/data blocks and non-portable config shapes
  (`required`, `x-secret`) self-disable with precise reasons — never a
  half-install; provenance (author/license/repository) renders verbatim
  on consent + cards. Installs land content-addressed under
  `<userData>/mini-apps/<id>/<digest>/`, pinned, and DISABLED (the
  desktop default-off host policy).
- **Consent + updates per D15/D22:** the consent dialog names
  capabilities, provenance verbatim, the digest and the charter's T0
  disclosure verbatim, BEFORE install; consent records persist per
  install. Digest drift on a pinned ref is a loud failure (pins
  untouched, source degraded); capability growth or a configSchema
  change re-consents; byte-identical-manifest data diffs are the only
  auto-apply window — desktop imports only T0 data packs, so there is
  NO code auto-apply path at all. Removing a source parks its imports
  (disabled, data + consent history intact, tombstone-able); bundled
  tombstones are untouched.
- **UI:** a Sources block in Settings → Apps → Mini-apps — add
  file/git source, listed candidates with origin chips
  (bundled/imported/listed, D25), pin + update-available + digest-drift
  states, park/restore affordances, the consent dialog, and the
  add-source form; all strings via TEXT constants, keyboard + axe clean
  (`tests/a11y-settings-miniapps.test.tsx` grows three exclusion-free
  scans).
- **Walls:** the charter-superset drift test now runs in desktop CI
  (generated pack vocab ⊆ vendored charter, incl. the miniAppMapping
  tables); the cross-language fixture wall (D23) runs the vendored
  manifest/sources/bundled fixtures through the desktop interpreter;
  the adversarial sources suite mirrors career's wall cases (bad schema
  typed, apiVersion too new, digest drift, capability growth without
  re-consent, inline tokens, local traversal/relative paths, unhonored
  capabilities) plus REAL local-git transport e2e; the contract-sync
  suite enforces byte-identity for every vendored artifact + the
  generated embedding. IPC: `miniapps:sources-list`,
  `miniapps:source-{add,remove,sync,install,apply-update,restore}`.

### Added (ui:window host surface — plan 32 Phase 4 / ADR-0040 clause 16, 2026-10-16)
- **Packs can declare a window surface:** a pack with the `ui:window`
  capability (declarative-surface class, tiers 0+1 — importable, unlike
  `ui:custom-code`; the validator pins that it requires `report`) adds
  an **Open in window** button on its run report. The window is a
  constrained host-owned BrowserWindow (`src/main/apps/windows.ts`):
  no node integration, context isolation, production sandbox, window.open
  denied, navigation locked to the app origin, family tokens via the
  same theme path as in-app surfaces, and the axe a11y bar
  (`tests/a11y-pack-window.test.tsx`). One window per pack — a second
  open focuses the live one. It closes automatically on pack disable,
  pack removal, the master kill switch and app shutdown, with boot
  reconciliation as the no-orphans backstop; every open/close is
  audited as a `MiniAppWindow` row (new table, same lifecycle reasoning
  as proposals). IPC: `miniapps:window-open` (handler-side validated);
  renderer host `renderer/pack-window-react/` (the result-viewer
  precedent) mounts the existing `PackReportRenderer` — no markup path
  of its own.
- **The renderer core now speaks the family surface fixture contract:**
  `PackReportRenderer` was refactored onto a closed-vocabulary core
  (`PackSurfaceRenderer`) implementing the charter's declarative
  vocabulary semantics — dot-path binds, controlled filter-bar/select
  facets with `aria-pressed`, closed typed action ids with stable
  `surface-*` test ids, badge-via-`badgeField` table cells, grouped
  cards with per-group counts, evidence summaries, unknown-node/action
  degrade at the render seam. Desktop's own implementation — parity
  with assistant-ui's SurfaceRenderer is proven by the SHARED fixture
  suite, not shared code: all 12 cases of
  `contracts/surface-renderer.fixtures.json` (incl. the degrade probes
  and the no-html invariant) run through the same core the window
  hosts in `tests/app-pack-surface-parity.test.tsx` (D23:
  implementations may differ, outputs may not).

### Fixed (model draft wizard reconciliation, 2026-10-15)
- **The ai-settings test walks the new kind wizard:** assistant-ui
  0.66.0 turned the add-model modal into a two-step wizard (kind cards
  → details), and the family ai-settings test still asserted the old
  manual-first form — it failed hunting for the Label field on step 1.
  The test now picks the Text kind card and flips the manual-id toggle
  before asserting the tuning fields. ApiTab also passes localized
  `kindStepLabel` / `changeKindLabel` (new `API_MODEL_KIND_*` TEXT
  keys) instead of the library's English defaults.

### Added (clickable trace meta rows, 2026-10-15)
- **The model · time row under a reply is now a disclosure:** in the
  desktop window, the expanded launcher and the compact context line,
  turns with tool or decision steps expand their full trace timeline
  in place on click (chevron + `aria-expanded`); plain replies keep
  the static badge — same condition under which the timeline would
  render a graph. `behavior.traceDetails` still pins the timeline open
  permanently. The library `ChatTraceMeta` stays presentational; the
  toggle is app-side (`ExpandableTraceMeta` in TraceTimeline.tsx),
  pinned by tests/trace-meta-expand.test.tsx.
- **One toggle, not two:** the library timeline's own summary button
  would duplicate the badges as a second collapse level — inside the
  disclosure it mounts `defaultOpen` with the library summary hidden
  by a scoped `.da-trace-inline` stylesheet rule (stylesheet-guard
  pinned), so the meta row is the single expand/collapse control.
- **Step names read in full:** the library pins trace labels to a
  96 px truncating column ("Decision · decisio…") — app-side CSS
  widens the column and wraps long names onto two lines instead
  (args/response detail re-indented to match), everywhere the
  timeline renders.

### Changed (trace meta joins the context line, 2026-10-15)
- **One context row instead of two in the compact launcher's done
  state:** the collapsed trace meta (model · elapsed · tools) now rides
  the same line as the message count, saving a vertical row of chrome.
  The expandable timeline (`Settings → General → Show turn trace
  details`) stays standalone, and artifact chips keep their own row.
  Pinned by the meta-merge case in tests/launcher-conversation-strip.test.tsx.

### Fixed (new OpenAI models 400 on the token cap — wire param routes by endpoint, 2026-10-15)
- **`400 — unsupported parameter: 'max_tokens' is not supported with this
  model` is gone for every OpenAI model, present and future:** the wire
  parameter that carries the output-token cap now routes by endpoint
  (ADR-0038) — api.openai.com always gets `max_completion_tokens`, every
  OpenAI-compatible base URL keeps `max_tokens` — instead of
  `@langchain/openai`'s model-id regex, which misroutes prefixed ids
  (`openai/gpt-5.6-terra` through a proxy), `gpt-5-chat*` variants and any
  family it predates (the SDK's `maxCompletionTokens` field is only an
  alias, so the fix lives in our factory as a `configuration.fetch` body
  normalizer that survives the bindTools/`withConfig` rebuild). Providers
  may override with `maxTokensParam: auto | max_tokens |
  max_completion_tokens | none` (contract + type now, UI later); the
  temperature family check now inspects the bare model id, so prefixed
  ids lock temperature correctly too. Pinned by tests/ai-chat-models.test.ts
  (endpoint matrix + fetch-body rewrite cases).
- **Temperature is omit-unless-configured (ADR-0038 addendum):**
  `LLMProvider.temperature` is optional and nothing manufactures a
  default anymore (AppConfig, provider presets, setup defaults, the
  manual provider form) — an unset temperature sends nothing, the only
  value reasoning families accept, so new OpenAI families work with zero
  configuration; a user-set value still rides the wire. `modelTuning`
  omits the key when neither the model row nor the provider defines one.
  Pinned by tests/ai-tasks.test.ts.
- **The policy is canonical and enforced:** the shared fixture table
  (`tests/fixtures/wire-params.fixtures.json`, vendored from the dev
  contract) drives the new tests/ai-wire-params.test.ts — the same rows
  the Python factories run — and alignment rules R6/R7 keep
  `max_completion_tokens` in the AI layer and temperature defaults out
  of app code.

### Added (model transport knob — reasoning + function tools on gpt-6 via the Responses API, 2026-10-15)
- **gpt-6-family models 400 with "function tools with reasoning_effort
  are not supported" on chat completions** — the model-scoped remedy is
  a per-model transport knob (ADR-0039): set `chatTransport: 'responses'`
  on the model row and its requests ride the Responses API — honored
  only when the base URL is api.openai.com (compatible servers don't
  implement /responses and keep completions), and always constructed
  store-less (`zdrEnabled` → `store: false`; the API stores outputs by
  default and our posture is "never"). `reasoning_effort` passes
  through on both wires, so reasoning + tools finally work together;
  `auto`/unset stays on completions — nothing changes for existing
  rows. The shared fixture table pins the resolution matrix; the knob
  is config-reachable now (stored config), model-form UI follows.
  **Field learning, same day:** gpt-6 rejects tool tasks on completions
  even with reasoning_effort omitted entirely, and per-row config dies
  with provider re-adds — so `auto` now routes by endpoint: api.openai.com
  rows ride the Responses wire by default (store-less), everything else
  keeps completions, and `chatTransport: 'completions'` is the explicit
  pin. Bare gpt-6 rows work with zero configuration.

### Changed (hide-to-tray into the launcher menu, 2026-10-15)
- **The ✕ button left the composer footer in the compact launcher:**
  **Hide to tray** now lives in the ⋯ menu (between Settings and
  About), decluttering the slimmed-down composer footer. The composer
  renders the ✕ only when the window owner passes `onHide` — the
  expanded launcher keeps it (its only mouse hide), the desktop window
  never had the need (minimize + hide live in its title bar).
  LauncherMenu also lost a leftover double separator above Settings.
  Pinned by tests/launcher-menu.test.tsx and the conditional-hide case
  in tests/composer-multiline.test.tsx.

### Added (launcher conversation meta strip, 2026-10-15)
- **The compact launcher now says where you are:** a slim strip directly
  above the composer shows `New chat` for an empty conversation or the
  live message count (e.g. `2 messages`) once it has turns — the old
  messages stay one `Ctrl+E` away, but the count is visible without
  expanding. A `+` button next to the count starts a fresh conversation
  without opening the ⋯ menu; it hides while the strip reads
  `New chat` (nothing to reset). The strip is permanent across compact
  states, so the chrome never re-flows when the count changes.
  Pinned by tests/launcher-conversation-strip.test.tsx (empty state,
  count + button after a finished turn, reset on click).

### Changed (launcher geometry — uniform inset, 2026-10-14)
- **The composer and response panel now sit exactly 12 px from every
  window edge in every compact launcher state:** the chrome wrapper's
  asymmetric padding (`pt-1`/`pb-3`) and the response panel's
  `mt-2 mb-2` are unified to a single 12 px inset, and
  `compactWindowHeight` no longer adds per-state slack (`+4`) on top of
  the measured chrome — the window height is the content height, so
  idle/thinking/failed top and bottom margins match the sides and the
  window never carries dead space. The `WINDOW_SIZE` fixed heights were
  re-based to the two-row composer (98/128/140) as first-paint
  fallbacks only; the ResizeObserver still re-fits after mount.

### Fixed (composer layout — permanent toolbar footer, 2026-10-14)
- **The input area no longer re-flows on the first typed character:**
  the composer row is now always two-line — full-width textarea on top,
  toolbars (attach, screen share, voice, live, clipboard/selection
  helpers, ⋯/✕/send) in a footer tucked tight under the input (zero
  seam; only the textarea's own padding separates text from buttons).
  Previously that footer only appeared once ChatComposer's sticky
  `data-multiline` flag flipped (it fires on the first character), so
  the pill visibly jumped. The library flag is now informational only;
  the unconditional layout is pinned by a stylesheet guard in
  tests/composer-multiline.test.tsx.

### Added (plan 26 embeddings wave — first-class embeddings support, 2026-10-13)
- **The `embed` slot is a real assignment surface:** `AiTask.EMBED` joins
  the assignable tasks (`taskAssignments.embed`), the canonical presets
  carry a docs-verified `embeddingsModel` per vendor (openai
  `text-embedding-3-small`, gemini `gemini-embedding-2`, mistral
  `mistral-embed`, ollama `nomic-embed-text`; null where a vendor has no
  embeddings surface), and the embeddings ids ride the curated lists.
- **Setup gap-fills embeddings like transcription:** preset setup
  resolves `embeddingsModel` against the fetched catalog and fills only
  an EMPTY embed slot — never clobbers — with `bindEmbeddings` (default
  true) on the review modal and `assignedEmbeddingsModel` on the result.
  The wizard's success panel gains the embeddings rebind row; ApiTab's
  defaults group gains the embeddings assignment row.
- **An embeddings transport with no caller yet (infrastructure-first,
  intentional):** `embedTexts(provider, model, inputs)` in the AI layer
  speaks OpenAI-compatible `/embeddings` and native Gemini
  `embedContent`, classifies failures through the shared provider-error
  vocabulary, bounds requests by the provider timeout, and never lets
  key material reach a message or log. The first consumer (memory /
  semantic search) only resolves the `embed` task and calls it.
- **Decision pre-suggestion (display-only):** when a decision slot is
  empty and the provider's preset declares `decisionDefault`, a muted
  'Suggested: {model}' hint renders under the row — a hint, never an
  auto-assign.

### Added (plan 26 follow-up wave B — capability chips + decision path label, 2026-10-13)
- **The preset grid is self-explanatory:** the setup wizard derives
  per-tile capability chips from the synced preset data — wire type →
  Chat (+ Vision where the preferred model carries it, + Speech-to-text
  where sttModel exists), decisionModels → Decision, keyless-local →
  Local — rendered by assistant-ui 0.55.0's new `chips` prop with TEXT
  labels (`SETUP_CHIP_*`). The grid now reads: openai [Chat, Vision,
  Speech-to-text] · gemini [Chat, Vision] · openrouter [Chat,
  Decision] · typesafe [Decision] · anthropic [Chat, Vision] ·
  groq/mistral/deepseek [Chat] · ollama [Chat, Decision, Local].
- **First-class decision path label:** the manual/custom chain's
  decision provider type reads 'Decision endpoint (System One)' (was
  'Decision (System One)').

### Changed (plan 26 §13.3 follow-up — decision presets exposed, 2026-10-13)
- **Three decision providers, one transport, docs-verified:** the
  `typesafe` preset flips into `presetOrder` (a decision-only tile after
  OpenRouter; keyUrl → docs.typesafe.ai/api with console-worded steps —
  the console URL is not stated in the docs); Ollama gains decision
  models (`nimble` default, `tev1`, `clef`, `clef-flash` — pull-required,
  version floor riding the preset steps: v0.35.0+, clef models v0.35.1+)
  and now surfaces decision rows in setup keylessly; OpenRouter's
  decision ids are corrected to `typesafe/jev-1.13` (pinned, the
  default) + `~typesafe/jev-latest` (rolling) with the systemone surface
  pinned via `base_url_override` (`https://openrouter.ai/api` — the
  `/api` prefix; the SDK appends `/v1/systemone`). No `provisional`
  markers remain on decision data. Canonical + sync re-vendored
  byte-identical; the generated module regenerated.
- **Keyless decision resolution (local Ollama):** the official
  `@typesafe-ai/sdk` requires a non-empty API key (D9), so keyless
  presets (no `keyUrl` in the canonical data) resolve through the
  explicit sentinel key instead of failing `needs-key`; keyed presets
  keep the needs-key failure. Pinned by the decision suites.

### Removed (plan 26 §13.8 no-legacy sweep, 2026-10-13)
- **The one-time legacy decision-config migration is gone outright:**
  `migrate-legacy-config.ts`, `legacy-endpoints.ts`, their 12-case test
  suite and the ConfigService wiring. The migration already ran on the
  real profile (verified end state on disk during Phase 1) and owner
  ruling §13.8 keeps no compat shims with no users in the wild. With it
  die the AppConfig load-time shims: the audio→[stt,tts] cap remap and
  the customModels registry fold (the customModels field itself stays —
  it is the live manual-models list). The byok gate's R2 AppConfig
  exemption is retired (zero `'audio'` literals remain in src/).
### Changed (plan 26 §13.8 no-legacy sweep)
- **No canonical model ids as code literals (§15 single-source):**
  `JEV_MODEL_ID` now derives from the synced preset data (typesafe
  `decisionDefault` → first decision model) instead of a hardcoded
  `jev-latest`; the wizard's decision-probe fallback model and the
  `ai:test-provider` key-only probe derive their id from the preset's
  canonical decision data (a decision provider with neither models nor
  a derivable preset gets an actionable failure, never an invented id).

### Changed (plan 26 Phase 6 closeout)
- **Vendored gates re-synced to the dev masters:** the byok contract
  gate gains **R8** (no needle/llm decision-engine code — engine
  markers and module paths; the legacy-config migration's own mentions
  never match), and the AI-alignment gate's family table now lists
  every repo strict. Byte-identical to dev; selftests 12/12.

### Changed
- **Setup UI swapped to the library kit (plan 26 Phase 2):** the wizard's
  tiles, guided form and first-run card, and the provider rows' logo, now
  render `@neuronection/assistant-ui` components
  (`provider-setup-tiles`, `provider-setup-form`,
  `setup-first-run-card`, `provider-logo` — the local `ProviderLogo.tsx`
  is deleted), and the re-setup review modal renders `setup-review` over
  `switch-row`. The review now emits the full five-bind options body —
  `curatedIds` + `bindChat`/`bindVision`/`bindStt`/**`bindDecision`** —
  with a decision-models switch for presets that declare decision models
  (decision-only presets show it alone), closing the Phase 1 gap where
  the review never offered `bind_decision`. Setup errors render inline in
  the form (role=alert + suspected-vendor hint + retry / set-up-vendor
  buttons) instead of a separate error phase. The dependency pin moves
  `^0.48.0` → `^0.54.0` (owner ruling plan 26 §13.7): verified against a
  locally packed 0.54.0 release-candidate tarball (full `npm run verify`,
  2013/2013); the lockfile entry already points at the registry URL —
  publish-ready, resolving the moment 0.54.0 is published.

### Removed
- **Legacy decision engines (plan 26 Phase 1, ADR-0032):** the needle 3
  local engine (code, vendored wasm runtime, weights download, settings
  UI, tests, userData cache) and the LLM-structured fallback engine are
  deleted outright — no deprecation window (owner ruling 2026-10-12: no
  users in the wild). The `config.decision.engine` enum, the
  `decision.jev` endpoint settings, the ApiTab `intent` task row (the
  `intent` audit label stays), the `decisions:download-weights` /
  `cancel-download` / `set-key` / `clear-key` IPC channels and the
  `openrouter:key` keyring id are gone with them.

### Changed
- **Decision models ride the provider surface (plan 26 Phase 1,
  ADR-0032):** `decision` is a model capability and a decision model is
  an ordinary provider model — provider row (key + base URL), model row
  (rolling alias or pinned version, `decisionTransport: 'systemone'`
  seam), assigned per capability in new `decision:<capability>` slots
  (`tool-dispatch`, `boolean-gate`, `choice`, `score`; `open-args`
  reserved) with primary + fallback, in **Settings → API → Tasks**.
  Capability routing is enforced both directions (a decision model never
  serves a text/vision task and vice versa), an unassigned slot means
  the decision point does not run (fail-open), and resolution is cached
  per config revision for the voice hot path. Decision-only providers
  (the `decision` wire type — TypeSafe or a custom System One endpoint)
  validate via a one-question **decision probe**; mixed providers
  (OpenRouter's Jev route) gain decision models through preset setup with
  `bind_decision` gap-fill. The audit row records the provider, the
  assigned model and the **resolved** model version — observed versions
  power the new pin affordance (pin to the served version, or follow the
  rolling alias). The ADR-0020 privacy notice ships verbatim above the
  assignment list. Settings → Tools → Decisions keeps behavior only
  (thresholds, scope, routing, rules, test) with a deep-link card into
  API settings; the voice auto-send judge link retargets there too.
  A one-time migration (idempotent, `config.json` backed up first)
  maps `decision.engine: 'jev'` + endpoint onto provider/model/slot rows
  and moves the OpenRouter key into the provider row's keyring secret
  (copy-then-verify-then-delete); `'llm'`/`'needle'` configs become
  unassigned slots plus a one-time notice. The mini-app pack contract
  drops its dead per-pack `engine` preference.
- **Renderer surface hygiene + report pagination (plan 31):**
  `RunReportModal` splits into `RunReportModal` (shell) +
  `PackReportRenderer` + `ArmModal` under `renderer/shared/` (public
  exports preserved via re-exports — import sites unchanged), and
  `PackRuns` splits off `DiffModal` + `QuarantineManager` +
  `OverridesManager`. The report table paginates: 50 rows per page,
  "Load more" appends in place, filter/search changes reset to page
  one — the DOM stays flat long before the 2000-item view cap
  (pagination + cap, no virtualization dependency). Ride-along fix:
  `QuarantineManager`'s early return moved below its callbacks — it
  changed hook count between renders, a latent crash whenever a pack
  actually had quarantine records (masked in tests by empty fixtures).
- **IPC decomposition (per-domain registrars):** `ipc-handlers.ts`
  (2435 lines, ~150 inline registrations) is now a thin composition
  root (~850 lines): it constructs the shared services once and calls
  one registrar per domain under the new `src/main/ipc/` — ai,
  apps (tool-apps), attachments, commands, config, conversations,
  decisions, dev/diagnostics, docs, hotkeys, live, memory, messages,
  providers, schedules, search, system, tools, translation, window —
  each with a typed deps object and an exported `<DOMAIN>_IPC_CHANNELS`
  teardown list, mirroring the `apps/ipc.ts` pattern. Behavior is
  unchanged (every channel name, argument validation and return shape
  moved verbatim); `removeIpcHandlers` now spreads the union of the
  lists, which also closes the gap where channels registered inline
  (e.g. `hotkeys:*`, `provider:add/update/delete/set-default`,
  `apps:get-state`) were never removed on teardown. Guarded by the new
  `tests/ipc-structure.test.ts` (each list ⊆ its module's
  registrations; the union of all lists covers every `ipcMain.handle`
  under `src/main` exactly once).

### Added
- **Scheduled recurring assessments, report-only (plan 33):** schedules
  gain a `kind` discriminator (`prompt` default / `mini-app` with pack +
  root) — the wheel dispatches mini-app schedules to `RunService.start`
  (report-only: the run row carries `disallowArm`, the arm gate rejects
  with a typed reason, the report hides Arm, and a manual re-run of the
  same root stays fully capable). The schedule points at the latest
  run's conversation; the Automation wizard gains a What-runs toggle
  (Prompt / Mini-app run) with pack + folder pickers and the reused
  spec/rhythm editor; schedule rows show pack + root for mini-app rows.
  Caching makes recurring runs cheap — unchanged trees cost ~zero model
  calls after the first pass (surfaced by the plan-29 cache-hit ratio).
- **Manifest JSON Schema export (plan 30):** the pack contract now
  publishes a generated draft-2020-12 JSON Schema —
  `contracts/mini-app-packs.manifest.schema.json` (family canonical in
  `the family contract canonical/`), emitted by `sync-app-pack-contract.mjs --schema`
  from the same canonical file, drift-gated in CI alongside the TS
  module. It covers the vocabulary (kinds, capabilities by tier
  variant, verdicts, statuses, report/live-card components + closed
  binds, actions, error codes), id/version patterns, apiVersion
  deprecation window, config-schema subset and size limits; everything
  not expressible (cross-references, i18n completeness, privacy lint,
  host-baseline union) is listed in its `$comment` as host-owned rules.
  All bundled manifests validate against it (ajv), the imported and
  bundled variants are separate `$defs`, and desktop's import path now
  runs the schema as a cheap structural pre-check (small interpreter
  over the generated module) before the normative full validator —
  malformed imports reject with schema-pointed paths.
- **Parallel item decision (plan 28b):** the runner's decide loop now
  runs a bounded concurrency window — min(shared funnel limiter slots,
  4) — instead of one ask at a time: large residuals settle ~4× faster
  wall-clock with zero determinism cost. Persistence drains in scan
  order (item rows, totals and progress events are byte-identical to
  the sequential loop — the existing suites are the regression oracle),
  the budget reserves at ask time (`spent + reserved` never
  over-commits `maxModelCalls`), a terminal result (budget/rate-limit/
  provider/cancel) stops new launches and lets in-flight asks settle
  and persist, and everything never persisted stays pending (resume
  re-serves it from the fingerprint cache). Concurrency is read from
  the ONE limiter (`decisionSlots()` via the decide bridge) — no second
  knob.
- **Run economics in the Usage dashboard (plan 29):** Settings → Tools
  → Usage gains a "Mini-app runs" section under the tool bars — per
  pack: run count, an items-scanned bar, model calls + token sums,
  a cache-hit ratio badge (the number that says whether the config is
  paying for itself), paused/canceled/failed counts and the last run
  time, sharing the 7d/30d/all window selector. Data comes from the new
  read-only `miniapps:run-stats` IPC — aggregated main-side over the
  retained run rows (the renderer never scans runs), with the retention
  scope stated honestly in the card.
- **Launcher deep-link into the report (plan 27 S2, complete):** the
  launcher's live run card now carries the View-report action — it
  deep-links `settings:open {tab:'apps', miniAppsReportPackId,
  miniAppsReportRunId}`, and the settings window opens the Mini-apps
  view with that run's report modal pre-opened (the run-finished
  launcher banner carries the same action). The `settings:open`
  payload gained the two mini-app fields (sanitized main-side,
  delivered via the queued `settings:navigate` push); the notice
  vocabulary gained an explicit-action channel (`NoticeState.action`)
  so notices can carry routing data text-derivation cannot. The
  desktop window keeps its in-window report.
- **Live run cards in the transcript (plan 28 S2):** run messages now
  render as host-owned live cards in both chat windows — pack title,
  live status badge (polite live region while in flight), decide-phase
  progress bar fed by the real `run:progress`/`run:items` event
  sequence, verdict tallies from the persisted totals, cost line, and
  the View-report action (the plan 27 chip folds into the card). Card
  content follows the pack's `liveCard` declaration, resolved
  host-side over the new `miniapps:live-card` IPC (cached per pack)
  with the SDK `DEFAULT_LIVE_CARD` as fallback; markdown remains only
  as the non-renderer fallback and no longer leaks the raw run id.
  Progressbar/stats are axe-scanned; the event-sequence suite drives
  the actual broadcast seam (estimate → decide progress → paused →
  resumed → settled).
- **Live run cards, SDK contract (plan 28 S1):** the mini-app pack
  manifest gains an optional `liveCard: { nodes }` slot (assessment
  packs) declaring which nodes the live run card in the chat
  transcript shows — a closed `badge`/`stat`/`progress` subset bound to
  a closed run-state bind list (`run.status`, run cost paths,
  `totals.*`, `progress`), validated like the report schema (unknown
  types/binds, per-type bind rules, duplicate ids,
  `liveCardComponentsMax` 16, mandatory `live.<id>` i18n labels for
  stat nodes). Packs declaring nothing get the SDK `DEFAULT_LIVE_CARD`
  (status, progress, verdict tallies) — live cards are zero-config for
  every mini app. Contract vocabulary + limits ride
  `contracts/mini-app-packs.json` (family master mirrored) with the
  sync script regenerated and drift-gated; builder `ui.liveCard()` +
  `DEFAULT_LIVE_CARD` added; authoring guide documents the slot (the
  transcript card itself renders in S2).
- **The run card reopens its report, and runs open where you watch them
  (plan 27 S1):** assistant messages carrying mini-app run metadata now
  show a **View report** chip in the desktop window, opening the full
  report (evidence, review queue, quarantine/restore, export) in a
  modal without leaving the conversation — closing plan 26 D5's
  reachability promise. Starting a run from the palette (or typed
  slash) now also **opens the desktop window on the run's
  conversation** so the card and its progress are visible immediately —
  previously the run created its conversation but never opened it (the
  palette path dropped the conversation id, and the local select never
  loaded the conversation into the transcript). The report renderer
  (`RunReportModal`/`PackReportRenderer`) moved to
  `src/renderer/shared/` (settings-window imports cleaned, zero
  settings-only dependencies — now shared by both windows), the settle
  refreshes the open transcript (terminal `run:*` broadcasts reload the
  active conversation), and the chip + open modal ship axe-scanned.
- **One home per setting (plan 26 polish):** the translate pad's
  duplicated knobs are gone — the pad's auto-translate delay lives only
  on the `mini-translate` pack card (Tools → Translation shows a pointer
  instead of a second copy), and the pad's `defaultTarget` pack field
  was removed entirely (target comes from `/tr <lang>` or the engine
  default — one default, in Tools). Engine configuration (providers,
  keys, routing) deliberately stays under Tools → Translation: it is
  shared by the pad, `/tr` turns and the agent `translate` tool, and
  must survive the pad being disabled or uninstalled. Bundled pack
  upgraded to 1.2.0 (in place, user config preserved).
- **Architecture audit round (plan 26 hardening):** the host sensitive
  baseline is now ENFORCED (a pack omitting sensitive globs cannot get
  `.env`/`*.key`-class files past classify or the arm gate — `rule:
  host-sensitive` outranks pack rules); run retention actually prunes
  (newest 50 finished runs per pack, paused/interrupted always kept —
  previously the promised limit was never enforced); truncated scans
  surface honestly (`totals.scanTruncated`, file/time-capped walks no
  longer report a clean "done"); `run:item` broadcasts are coalesced
  into batched `run:items` counts (~250 ms, no per-item IPC storms on
  20k-file runs); report views cap at 2000 items with an honest
  "export for the full set" notice (exports remain complete); the
  report renderer implements `select` (field filter) and grouped
  `cards`, and renders `actions` nodes; a quarantine manager (list,
  per-item + restore-all by record id — survives run retention — and
  the user-armed empty) and a stored-overrides manager (list, clear
  one/all) ship in the runs area; scan deadlines scale with the file
  cap; the decide bridge no longer double-resolves the engine; the
  `guidelines` config rides the decide input; quarantine retention
  also prunes removed packs' leftovers; runs settle the bridge on
  crash paths.
- **Pack authoring documentation (plan 26 close-out):** a dedicated
  developer guide (`docs/dev/pack-authoring.md` — full feature
  reference: capabilities, config-schema subset, privacy, i18n rules,
  every pipeline step with examples, the complete condition grammar and
  signal list, all report components and typed actions, the run/verdict
  cache model, the typed error table, limits, two worked examples, the
  Tier-1 code-pack layout, an architecture map, plus testing patterns
  and a debugging handbook) and a `src/packs/README.md` orientation for
  the bundled-pack directory. CI now auto-validates **every** manifest
  under `src/packs/` and fails if a pack directory is unregistered.
- **One directory per bundled pack (plan 26 layout unification):** all
  bundled apps now live under `src/packs/<id>/` — manifest
  (`manifest.json` at the pack root), pure logic
  (`mini-calc/evaluate.ts`, moved
  from shared/commands), and the renderer binding (`renderer.ts`) —
  with two registration points (`src/packs/index.ts` for main,
  `src/packs/renderer.ts` for the renderer) behind a `@packs/*` alias.
  Deletion review moved from `resources/packs/` into its pack
  directory (now bundled via import, not fs scan); the surface-pack
  state split into `surfacePackState.ts` (leaf module — no import
  cycles between the registry and pack bindings).
- **Per-pack live behavior (plan 26 polish):** the mini-app controller
  (`useMiniApps`) and pad surface (`MiniAppSurface`) are fully generic —
  every per-app behavior moved into its pack module: calculator
  evaluation and translate debounce/pending/error/copy semantics are
  `useLive` hooks under `chat-react/packs/<id>/`, the surface renders a
  closed row vocabulary (compact result / card result with meta /
  pending / error), and copy-on-Enter copies the active pack's
  `copyValue`. No pack ids or command ids appear outside pack modules.
- **No hardcoded renderer fallback (plan 26 polish):** the launcher's
  pre-fetch `FALLBACK_STATE` is gone — the mini-app registry is the
  single source of truth (before the first successful read, surface
  modes simply don't engage; the palette row executes the command
  normally). Mini-app tests now mock `getMiniApps` honestly instead of
  leaning on the fallback, and the translate pack's manifest title
  preserves the original "Translate" mode-bar UX.
- **Modular pack directories (plan 26 Tier-1 layout):** each bundled app
  lives under its own directory — `src/main/apps/packs/<id>/`
  (manifest) and `src/renderer/chat-react/packs/<id>/` (renderer
  binding) — with single registration points on both sides
  (`SURFACE_COMMAND_BINDINGS`, `SURFACE_RENDERER_BINDINGS`). Command→mode
  dispatch is table-driven (no per-app if-chains: the calc entry is
  emitted from the pack's declared `commands` contribution through the
  binding table; the translate pad's target handling lives in its own
  pack module via `applyOpenOptions`). Adding a first-party surface =
  one manifest + one binding, zero core edits — the template for
  Tier-2 imported code packs (isolated process + RPC shim, ADR-0029
  clause 10, deliberately a separate future plan).
- **Bundled mini apps are genuinely uninstallable (plan 26):** removing
  a pre-installed pack (Calculator, Translate pad, Deletion review) is
  now sticky — `config.miniApps.removedBundled` tombstones keep
  `ensureBundled` from resurrecting it across boots, the confirm dialog
  says so and points at the new **Restore pre-installed apps** button
  (`miniapps:restore-bundled`), and the launcher treats a successful
  registry read as authoritative — zero installed surface packs means
  zero launcher modes (the pre-fetch default no longer re-enables
  removed packs; user imports are still never clobbered).
- **Calculator and Translate pad are true pre-installed mini apps
  (plan 26 dogfooding, completed):** their surface packs are the source
  of truth — the calculator's palette entry comes from the `mini-calc`
  pack's commands contribution (not a hardcoded builtin) and disappears
  when the pack is disabled; the translate pad reads its default target
  and auto-translate delay from the `mini-translate` pack's config
  (legacy translation settings remain the fallback); the launcher mode
  registry consults the pack state (enable + master switches are
  functional, disabled surfaces fall back to their normal commands);
  bundled pack upgrades (shipped version newer than the installed
  bundled one) upgrade in place preserving user config. Both surface
  packs configure through Settings → Apps → Mini-apps under a
  "Pre-installed surfaces" section — engine configuration (providers,
  keys, routing) stays in Tools → Translation where the agent tool and
  /tr turns share it.
- **Smoke round 2 (plan 26 polish):** pack settings forms now render the
  pack's own field labels (resolved from its default-locale i18n)
  instead of raw config keys; every run row gains **Run again on this
  folder** (one-click re-run against that run's root — the answer to
  "set a directory"); bare launcher surface packs (Calculator, Translate
  pad) no longer render as management cards in Mini-apps — they collapse
  into a muted note pointing at the palette (their engines stay
  configured under Tools → Translation etc.).
- **Launch mini-app runs from the palette (plan 26 S8 polish):** every
  runnable assessment pack gets a command-palette entry ("Deletion
  review — assess a folder") that opens the OS folder picker (wrapped in
  the launcher dialog guard so hide-on-blur never eats the window),
  starts the run, and switches the launcher straight to the run's
  conversation for live progress; cancelled picks fail silently. Also:
  the Apps settings tab is renamed from "MCP servers" to "Apps" (it now
  hosts servers, mini-app packs and their settings) and the mini-apps
  panel adopts the standard settings card grid and paddings.
- **The deletion-review reference pack + dogfooding, stage 7 (plan 26):**
  `file-deletion-review` ships bundled as pure data — configurable
  exceptions/exclusions/fresh-window/read-context (all config, no
  re-release), sensitive-glob vetoes, deterministic rules + three typed
  questions, evidence-backed verdicts, category-grouped quarantine
  arming; bundled packs install at boot through the same validated
  registry path (never clobbering user imports); the calculator and
  translate pad are defined as surface packs on the contract
  (byte-compatible — existing tests unchanged); contract gains the
  append-only `decide.readContextWhen` config gate.
- **Mini-app arm + quarantine, stage 6 (plan 26):** HITL Class-B arming
  (`MiniAppProposal`: fail-closed gate at arm time, idempotent resolve,
  revalidate-and-move in one per-item-atomic operation — changed files
  drop back to ask), the quarantine store (`MiniAppQuarantine`) with
  mirrored layout + batch manifests, EXDEV fallback, Undo/Restore that
  never overwrites, 30-day boot retention and a user-armed
  empty-quarantine (the only permanent deletion); sequential fail-soft
  batches with an arming kill switch; `miniapps:arm/resolve/abort/
  restore/quarantine` IPC + `miniapps:proposal-event` push; the report
  modal's grouped Quarantine-candidates card and per-item Restore
  buttons.
- **Mini-app report surface + review queue, stage 5 (plan 26):** View
  report opens the pack's declarative report (stat/badge/progress/table/
  cards/filter-bar from the pack's schema, host-rendered from the closed
  vocabulary) with the mandatory per-item evidence drilldown (rule label
  + question answers + confidence); ask items form a review queue whose
  Keep/Candidate/Exclude choices persist as `MiniAppFeedback` and are
  applied by later runs over rules and the model; item reveal/open
  re-validate against the run root in main; all surfaces axe-scanned
  exclusion-free.
- **Mini-app runs in history, reporting + exports, stage 4 (plan 26):**
  each assessment run opens a real conversation (the schedules
  precedent) whose result card settles into a permanent summary with
  totals and actual cost; live `run:*` progress streams to every window
  over the new `miniapps:run-event` push (estimate, per-item verdicts,
  pause/resume) while the launcher stays usable; `miniapps:run-*` IPC
  (start with typed root refusals, cancel, resume, runs-list, report,
  markdown/JSON/CSV export, changed-since-last-run diff); the Settings →
  Apps → Mini-apps runs area shows the pre-flight estimate, history with
  per-run cost (calls + tokens), pending counts and exports; completion
  notifications ride the standard notify-on-complete setting.
- **Mini-app assessment runner + RunService, stage 3 (plan 26):** the
  `scan → classify → decide → compose` pipeline with per-item
  checkpointing (`MiniAppRun`/`MiniAppRunItem` tables; schema + runtime
  bootstrap in the same commit), the fingerprint verdict cache
  (root-scoped, config/pack/engine-keyed — resume and re-runs never
  re-decide), budget pre-flight with resumable exhaustion (`paused`,
  "N items pending"), provider-failure fail-stop, cooperative cancel,
  boot reconciliation of orphaned runs (`interrupted`), and the ONE
  priority concurrency limiter at the decision funnel (interactive
  chat/voice overtakes queued background runs). Cache/resume behavior
  is proven by `AiCall` audit-row counts in the full-stack tests, and
  classify/compose semantics (candidate rules confirm via compose;
  compose defaults to `ask`) are pinned by contract amendments.
- **Mini-app pack capability layer, stage 2 (plan 26):** the trust
  boundary under `src/main/apps/capabilities/` — host-enforced `fs`
  (run-root validation against system/broad roots on both the requested
  and the resolved path; walk skips symlinks, mount points and special
  files; every read re-validated against the root; content excerpts
  capped), a `decide` bridge that asks typed questions through the
  existing decision funnel (registry-resolved engines, one `AiCall`
  audit row per call, failures mapped to the contract's typed error
  codes), a `run` bridge limited to start/progress/cancel with per-pack
  isolation, and `capabilitiesFor` registration gating (undeclared
  capability = throw; no `net` surface exists at any tier). All fs
  operations are injected; `node-fs.ts` is the production adapter.
- **Mini-app packs framework, stage 1 (plan 26, ADR-0029 accepted):**
  the pack contract lives family-canonical in
  `the family contract canonical/mini-app-packs.json` (vendored at `contracts/`, with a
  generated TypeScript vocabulary module + drift gate); a pure SDK at
  `src/shared/app-pack/` (types, `definePack` builders, and the ONE
  validator shared by SDK and runtime — parity test-enforced); the
  runtime registry (`src/main/apps/`) with install/enable/disable/remove,
  sha256 digest + origin, apiVersion negotiation and boot self-disable
  with path-precise reasons; Settings → Apps → **Mini-apps** (pack list,
  capability badges, self-disable reasons, config auto-form from the
  pack's schema, import from file); the `npm run app-pack` authoring CLI
  (`init`/`validate`); and `miniapps:*` IPC. Tier 0 packs are
  declarative-only (no code, `net` denied); no pipeline execution yet —
  that lands with the S2/S3 capability + runner stages.

- **Launcher chat + mini tools in the tour:** the tour now shows the
  hotkey overlay's own chat (seeded conversation inside the launcher —
  not the desktop window) and the calculator/translate mini tools with
  live output; demo mode provisions a local demo translate service
  (LibreTranslate-compatible, `scripts/ui-capture/mock-translate.mjs`)
  so the pad renders real translations. Frames use real window geometry.
- **Richer demo workspace + tool-trace tour:** seeded demo turns now carry
  real turn metadata (tool-call/result trace steps, file artifacts) so the
  history renders tool traces instead of bare text; the tour grew to 5
  scenes including the 'Tools and approvals' conversation.
- **Demo tour capture pipeline (family demo-tour standard):** reproducible
  screenshots + `visual-tour.gif` captured from the **real running app**
  over the DevTools protocol (`./scripts/capture_ui.sh`, family template
  v1.2.0, `cdp` mode) with `--demo` seeded conversations and real window
  viewports (launcher bar, desktop chat, settings). `tour.manifest.json`
  emitted for the website; launch recipe in `docs/dev/visual-tour.md`.
- **Demo mode (plan 16 D2, identity-auth §13 Class L):** launching with
  `--demo` (e.g. `npm run electron -- --demo`, or add it to the packaged
  binary's invocation) starts the app on an **isolated demo data dir** —
  `userData` is redirected into its `demo/` subdir before any service
  resolves paths, so the config, database, secrets, and tool results of
  your real workspace are never touched. A few sample conversations are
  seeded idempotently into the fresh demo database (`src/main/demo.ts`,
  fixed `demo-*` ids — re-launches change nothing). Demo mode is
  **content-only**: no users, no profiles, no login concepts (the schema
  has none; family identity class L). Delete the `demo/` dir to reset.
- **Product threat model (plan 16 closeout):** `SECURITY.md` now carries
  the family identity-auth §20 threat-model table in Class-L terms —
  auth surface/session/instance/admin rows collapse to "none / N/A",
  the live rows document the renderer↔main/IPC boundary (ADR-0010/0011),
  the user↔agent tool policy engine, local-file data isolation,
  `safeStorage` secrets, the local `AiCall`/`ToolCall` audit, and the
  content-only demo exposure.

## [v0.9.0] - 2026-09-24
### Changed
- **Fixed Hotkeys actually lists the fixed keys.** Settings → General →
  Hotkeys now shows the in-window shortcuts that aren't configurable global
  hotkeys — **Hold Control** push-to-talk, plus `Escape`, `Ctrl+E`,
  `Ctrl+D`, and `Ctrl+K`. The section was previously empty; push-to-talk
  stays non-configurable by design (an in-window gesture, not a global key).
- **The Jev engine now follows the rolling `jev-latest` alias** instead of a
  pinned version, so TypeSafe releasing new Jev versions no longer needs an
  app update. Docs and settings copy updated to match.
- **The "Apps (AI tools)" settings tab is renamed to "MCP servers".** The
  surface connects MCP servers, so the label now says so; the **Servers**
  view, empty state, and the stale Tools description were updated to
  match. Internal naming is unchanged.
- **New global hotkey: Start Live Conversation** (default
  `Ctrl/Cmd+Alt+Space`, editable under Settings → General → Hotkeys). It
  opens the window and starts the live voice loop from anywhere.
- **Default tool verification is now Trusted workspace.** Out of the box,
  built-in state-changing tools (file writes, shell, downloads, system
  ops) run without asking; clipboard reads and destructive tools still
  prompt, and MCP/app tools keep their own settings. Change it under
  Settings → Tools → Default verification.
- **Decisions settings are organized into tabs.** The long Decision section
  under Tools is split into **Engine** (engine, thresholds, setup, prompt,
  dry-run test),   **Scope**, **Routing**, and **Rules** sub-tabs — a pure
  reorganization, no behavior change. The **Also uses the decision engine**
  card now also lists **live conversation interruptions** (barge-in).

### Added
- **Live conversation mode (plan 25).** A **Live** button in the composer
  starts a hands-free voice loop: the mic stays open while the reply is
  spoken, the reply auto-plays, and you can interrupt by speech. A
  session-invoked `live-intent` decision point (`ignore`/`interrupt`/`end`)
  decides what a detected utterance means — layered over the existing
  `stt.ts` noise filter plus a deterministic echo/keyword ladder, so the
  model only judges the ambiguous rest and fails closed. Full-duplex on a
  headset, with a visible half-duplex downgrade on speakers; the mic is
  live only inside an explicit session. Default off. The transcript box
  shows only the current phrase; a sent phrase lingers briefly with a
  delivered check so it can be read back, and an opt-in **Show what live
  mode ignores** toggle adds a brief hint of filtered utterances. Fast
  interruption without speaking over it: a global **Stop Speaking /
  Interrupt** hotkey (stop the reply, then end live mode), an `Escape`
  ladder, and tray entries. Very long replies are announced as shown on
  screen instead of read aloud; STT/TTS hiccups show a notice without
  ending the session; an optional **Live session turn limit** guards
  runaway spend. Full-duplex is chosen per device (headset detected, or
  **Allow interruption on speakers**), and repeated echo auto-downgrades
  the session to half-duplex; a **Voice interrupt** toggle switches
  half/full duplex on the fly during a session. Live mode ends a phrase
  sooner than dictation via a configurable **Live phrase pause** (default
  0.4 s) for snappier turns; the completeness gate stays fail-closed. The
  mic stays open while a reply is being prepared (TTS synthesis), so a
  slow synthesis can be interrupted before playback starts. Long replies
  are read in sentence-sized batches synthesized one at a time (the next
  while the current plays), so an interruption stops paying for the rest
  instead of discarding one big synthesis. Live controls now live in a
  dedicated **Voice → Live** sub-tab, with new **End after silence** and
  **Spoken reply limit** settings.
- **The Decision tab shows which voice features use the engine.** A
  read-only "Also uses the decision engine" card lists **Voice auto-send**
  (showing the assigned-Voice-model carve-out when the judge is set to the
  Voice task) and **reply speaking on request**, each with the resolved
  engine and a link to Voice settings. Hidden when no engine is enabled;
  editing stays in the Voice tab.
- **End-user and developer documentation set.** `docs/` now has a
  [docs/README.md](docs/README.md) index split by audience: a full
  [user guide](docs/user/README.md) (getting started, the launcher and
  desktop windows, chat and attachments, voice, commands, tools and
  approvals, tool apps and MCP, memory, decisions, a
  [decision-models spotlight](docs/user/decision-models.md) covering the
  local Needle 3 and cloud TypeSafe Jev engines, translation,
  automation, a settings reference, privacy, troubleshooting) and a
  [developer guide](docs/dev/README.md) (the existing architecture,
  development, IPC and packaging pages plus new testing, data-model,
  AI-layer, tools-and-policy, renderer-and-windows, security and
  adding-features pages).
- **Auto-send judge is now selectable (plan 24 S6 follow-up).** Voice →
  auto-send gains "Judge phrases with": **Decision engine** (Jev/Needle — fast,
  optionally private) or **Assigned Voice model** (the Voice/chat task
  assignment). The live status line shows the resolved engine and its
  readiness, with a link to Tools → Decision. Fail-closed behavior and the
  utterance fallback are unchanged; `task` mode simply skips the decision
  engine.
- **Standing voice mode (plan 24 S5 follow-up).** Saying "speak aloud from
  now on" (or similar) arms every following reply in that conversation
  (persisted as `ConversationMetadata.speakReplies`), not just the one
  reply; "stop speaking" clears it. A second speculative question in the
  same pre-model call distinguishes a standing mode from a one-off "read
  it to me", which still speaks a single reply.
- **Per-conversation speak toggle (plan 24 S5 follow-up).** The desktop
  inspector gains "Speak all replies in this conversation"
  (`ConversationMetadata.speakReplies`) — a per-conversation override of the
  global Speak replies setting; works even before the first message (the
  intent is held in memory and written once the conversation is persisted).
- **Fix: existing databases missing the new `AiCall` token columns
  (plan 24 follow-up).** A DB created before the token columns existed
  failed every AI audit write with P2022 (`no such column: inputTokens`).
  `DatabaseService.setup()` now adds `inputTokens`/`outputTokens`
  idempotently via the existing `ensureColumn` pattern, so older installs
  upgrade in place instead of erroring on every decision/chat audit.
- **Speaking controls in Voice settings (plan 24 follow-up).** The Voice tab
  gains a "Speak when I ask in my message" toggle (`voice.speakOnRequest`,
  default on) for the prompt-armed speak feature, plus a link to
  Tools → Decision → Rules for command-triggered speaking. Speak rules now
  choose their target: **speak the reply** or a **fixed message**. Speaking
  always uses the model assigned to the **Speech (tts)** task; the old
  OpenAI-only Voice/Speed pickers (`voice.speakVoice`/`speakSpeed`) are
  removed — the configured provider and its own default voice are used
  (OpenAI's default, Gemini's `Kore`, …), so Gemini TTS is no longer
  forced through an OpenAI voice alias.
- **Custom decision rules (plan 24 S7).** Settings → Tools → Decision gains
  a Rules editor: when the engine picks a matching command, run one safe
  action — just run it, route to a model, show a notification, speak a
  message, or tag the conversation. Rules are validated config data (never
  scripts), dispatch actions still go through policy/approval, and the
  "Try a command" dry-run reports which rule would fire.
- **Auto-send as a decision point (plan 24 S6).** The voice auto-send
  verdict now runs through the `utterance-gate` decision point
  (blocking/pre-input/`gate` domain): a structured `noul` through the
  decision engine when one is enabled, with the existing utterance
  evaluator as the fallback (still providing transcript correction when
  auto-fix/formatting is on). It remains fail-closed — any error, timeout,
  or low confidence means the transcript is not sent.
- **Prompt-armed auto-speak (plan 24 S5).** A pre-model `noul` over the
  user's own prompt ("read that to me", "say it out loud") arms speaking
  for that reply even when the global auto-speak toggle is off, and the
  model is steered to write for the ear (no markdown/code/URLs). It is a
  non-blocking advisory decision point: it never gates the turn, and a
  model reply can never arm it (injection guard). The turn's `finished`
  event carries the verdict; auto-speak (global toggle) is unchanged.
- **TypeSafe Jev cloud decision engine (plan 24 S4a).** A third decision
  engine — TypeSafe System One ("Jev", model `jev-1.13`) —
  alongside the structured chat model and the local Needle model, served
  **via OpenRouter** using the official TypeSafe SDK (`@typesafe-ai/sdk`,
  baseURL pointed at OpenRouter; confined to the AI layer behind a
  `JevClient` seam). It answers typed questions natively and
  projects tool dispatch into a `__tool__` Choice (always with a `__none__`
  out) plus closed-set argument questions, so it cannot invent a tool or
  an invalid enum value. Cloud-only and opt-in: the OpenRouter API key
  lives in the OS keyring (`openrouter:key`), never config; requests send
  the command and candidate tool list off-device, under a wall-clock
  timeout with 429/529 backoff; any failure falls through to the chat
  turn. Default OFF, as before. Deferred to S4b: key-entry UI,
  per-capability engine assignment, the structured-digest entity Choice,
  token usage on the audit row, and the family-wide `SDK_RE` update for
  `@typesafe-ai/sdk` (touches other repos' vendored gate copies).
- **Configurable Jev API endpoint (plan 24 S4b).** The Jev engine's API
  base is no longer hardcoded to OpenRouter: Settings → Tools → Decision
  offers OpenRouter / TypeSafe (direct) / Custom, with a validated custom
  base URL (http/https, no embedded credentials). The SDK appends
  `/v1/systemone`. The saved key must be valid for the chosen endpoint, and
  the key field's label/placeholder follow the endpoint (OpenRouter / TypeSafe).
- **Grounded entity args for Jev (plan 24 S4b).** With an app in decision
  scope, its cached context digest now becomes a `Choice` over the known
  entity/area ids for catalog arguments (`area`, `entity_id`, `name`, …),
  so the model can only pick a real target — unknown names are refused
  locally instead of shipped as guesses (the plan-23 `INVALID_AREA` fix).
  Cache-only, scope-filtered, fail-soft to today's behavior when no digest
  is cached.
- **Decision audit carries token usage (plan 24 S4b).** `AiCall` rows gain
  nullable `inputTokens`/`outputTokens`; an engine that reports usage (Jev)
  persists it on the `intent` audit row. Schema, regenerated
  `src/main/resources/schema.sql`, and the runtime `ensureTable` bootstrap
  updated together.
- **Jev key entry (plan 24 S4b).** Settings → Tools → Decision now takes
  the OpenRouter API key when the Jev engine is selected — stored in the
  OS keyring (`openrouter:key`, `decisions:set-key`/`clear-key`), never
  written to config. The engine's readiness shows "API key required"
  until a key is saved.

### Changed
- **Themed dropdowns replace native selects (settings).** Every settings
  `<select>` (General theme/launch mode, Voice, Tools, Decision, Apps,
  Commands, Search, Automation, Translation, Setup) now renders the
  themeable `@neuronection/assistant-ui` `Combobox`, so the open menu
  follows the active theme’s surface/text/accent instead of the OS-drawn
  native popup (previously a light menu with the system-blue highlight in
  every theme). `SelectField` in `settings-react/tabs/fields.tsx` is the
  shared label+combobox primitive; behavior and persisted config are
  unchanged.
- **Docs cover the recent voice features.** The user guide (voice,
  decisions, settings, launcher/desktop) and the developer guide
  (architecture, ai-layer, data-model, ipc) now document the selectable
  auto-send judge (`voice.autoSendEngine`), standing voice mode
  (`ConversationMetadata.speakReplies`) and the per-conversation Speak
  replies toggle.
- **Voice settings split into Input and Replies sub-tabs.** The Voice tab
  now uses the standard `SegmentedTabs` sub-navigation: **Input**
  (dictation, live transcript, auto-send + engine, cleanup, custom
  instructions) and **Replies** (speak replies, speak-on-request, speak
  rules). Each sub-tab shows its assigned task model (Transcription /
  Speech) with a **Configure models** link, replacing the separate
  "Assigned models" section; behavior is unchanged.
- **Decision settings grouped into one Engine card (Settings → Tools →
  Decision).** The engine selector, its hint/readiness, the confidence
  thresholds and the engine-specific configuration (the Jev key/endpoint
  and the Needle download) now live in a single bordered "Engine"
  container with dividers, instead of being scattered across unboxed rows
  and separate boxes. Test, Scope, Route tools and Custom rules stay their
  own cards; behavior is unchanged.
- **Developer docs moved under `docs/dev/`.** `architecture.md`,
  `development.md`, `ipc.md` and `packaging.md` now live in
  `docs/dev/`; all references (README, AGENTS.md, CONTRIBUTING.md) point
  at the new paths. `docs/STATUS.md` stays at the docs root.
- **Decision-point contract + tool-dispatch point (plan 24 S3).** The
  fast path is now a decision point: `shared/ai/decision-points.ts` holds
  the phase/mode/domain contract and a batch runner (parallel fan-out,
  per-point timeout, cancellation via `AbortSignal`, fail-open per point),
  and `ai/decide/points/tool-dispatch.ts` owns the eligibility and
  direct/route/fall-through classification that used to live inside
  `TurnManager.tryDecisionDispatch` (now a thin caller). `DecisionProvenance`
  moved to the shared decisions module. Behavior is unchanged: same
  eligibility, same act/confirm/refuse bands, same fail-open.

- **Engine-kind leaks purged + generic readiness (plan 24 S2).** The turn
  layer no longer switches on engine kind: trace labels and the
  dispatched-by attribution go through the registry (`decisionEngine-
  DisplayName` / `decisionEngineTraceModel`), and a source-guard test
  pins that `TurnManager` contains no `engine === 'needle' | 'llm'`
  branch. `decisions:get-state` now returns a generic per-engine
  readiness/capability list (`engines[]`) alongside the Needle download
  detail, and the Settings card renders the selected engine's readiness
  from it. The per-turn "Decisions" panel is deferred to S3, when
  decision points exist to report on.

- **Decision engine registry (plan 24 S1 — groundwork).** Engine
  resolution moved behind one registration point
  (`ai/decide/registry.ts`): each engine declares its capabilities, a
  display name and its resolve/create/audit hooks, so adding an engine is
  one file plus one entry and callers never switch on engine kind. `off`
  is now a resolution state, not a value in the engine enum, and the old
  sync/async resolver split is gone. New engine-neutral contract types
  (capability matrix, typed question/answer, generic readiness) land in
  `shared/ai/decisions.ts` ahead of the Jev engine. Default OFF behavior
  is unchanged.

- **Ergonomic launcher + voice triggers.** The launcher hotkey now
  defaults to `Control+Space` (was `CommandOrControl+Shift+A`); installs
  still carrying the old default are migrated on config load, while
  user-customized bindings are preserved. Voice is now **in-window
  push-to-talk**: hold Control in the focused launcher to record, release
  to transcribe — no global voice chord required, so the old
  `CommandOrControl+Shift+R` default is left unbound (still rebindable in
  Settings → Hotkeys). A short arm delay, cancelled by any other key,
  keeps Ctrl+E / Ctrl+D / Ctrl+K and other Ctrl combos working untouched.

## [v0.8.0] - 2026-09-21
### Added
- **Preset-level fast-path posture.** `ToolAppPreset.fastPath`
  (`'eligible' | 'never'`, default eligible) declares whether a preset's
  tools are fit for direct decision dispatch; the Home Assistant preset
  marks `never` (Assist-style name-matched tools would guess
  area/device strings and fail the registry match). The decision
  surface filters ineligible apps' tools and the scope checkbox renders
  disabled with the reason.

- **Apps-tab live-context readout (plan 23 S6).** The app detail modal
  now shows what the model actually sees: "Live context: N entities ·
  age" (or "No live context published yet") from the digest cache —
  cache-only readout, never triggers a fetch (`apps:context-digest-
  stats`). Turn tool-call counts were already persisted in message
  metadata (plan 13/20) and now measure the fast path's effect.
- **Home Assistant bundled app skill (plan 23 S5).** The preset now
  authors a trusted, actionable playbook instead of reference notes:
  resolve rooms/names to `entity_id` from the prompt's device list
  before acting, skip discovery/confirms when the list already covers
  it, never consult memory tools for device names, never probe for the
  current time, and only discover when a device is genuinely missing
  (`preset.skill` seeds `ToolAppSpec.skill` through the authored
  template, absorbing legacy `promptNotes`; renderer submissions stay
  stripped). The digest-over-real-MCP path gained an end-to-end test on
  a dedicated stdio fixture (discovery → suffix match → one call →
  scope-filtered, capped block).

- **App context digests (plan 23 S3).** Apps may provide a compact,
  cached "what exists" digest (Home Assistant reference: the entity
  list) that rides the system prompt and the decision-engine prompt —
  "turn off the office light" resolves to `light.office` without any
  discovery, `enable_app`, memory, or system probes. Digests are TTL-
  cached per server (15 min), refreshed single-flight, invalidated on
  state-changing tool results and app saves, entity-scope-filtered at
  render time, hard-capped (150 rows / 1 200 chars), served stale with
  an age note when a refresh fails, and proceed digest-less when the
  app has no provider (D4/D5/D10/D13). Digests ride **bound apps only**
  (selection match, sticky or `enable_app` seeds) — unrelated turns
  carry zero app-context tokens. Kill switch in Settings →
  General → "Let apps provide live context" (`behavior.appContext`).

- **About & fund surfaces.** The launcher ⋯ menu gained an About item
  (bottom of the menu) that opens the settings window's new About tab —
  the family `AboutPanel` with version, Apache-2.0 license, creator,
  project links, tech chips and the sponsor channels. A discreet heart
  button next to the ⋯ trigger opens the in-flow fund card (family
  `SponsorCard`): Buy Me a Coffee first, GitHub star second — one shared
  `SPONSOR_CHANNELS` config (`renderer/shared/funding.tsx`) so new
  channels land everywhere at once.
- **`DA_AI_DEBUG=1` AI wire tracing.** New opt-in env flag for the dev
  session: every agent model call logs `[ai-debug] llm start` (resolved
  model + the bound tool names sent to the provider) and
  `[ai-debug] llm end` (whether the response carried `tool_calls`, with
  a text preview) — the fastest way to tell "the model never asked for
  tools" apart from "tool calls were lost in the stack" when a provider
  misbehaves.
- **Mode switching from the desktop window.** The desktop header gained
  "Open launcher mode" and "Open expanded mode" buttons (`desktop:open-
  launcher` IPC): the desktop window hides, the launcher shows with the
  active conversation handed over via `session-sync`, and a new
  `launcher:set-mode` push deterministically applies the compact or
  expanded state (no toggle races). Every surface can now reach every
  other: launcher ⋯ menu + Ctrl+E/Ctrl+D, expanded header desktop
  button, desktop header launcher buttons.
- **Mini apps now work in expanded mode and the desktop window.** The
  calculator and translate pads were launcher-compact-only — and worse,
  a bare `/calc` in desktop silently swallowed the input, and Enter in
  an expanded-mode pad sent the expression as a chat turn. One shared
  controller (`useMiniApps` + `MiniAppSurface`) now drives all three
  surfaces: bare `/calc` / `/tr [lang]` opens the focused pad anywhere,
  Enter copies the result (never a turn), Escape / the pad's × exits,
  and the command palette enters focus mode with `/exit`. Also wires
  the palette "Open" row action and mini-app guard for the desktop
  window.
- **The command palette now works in expanded mode.** Typing `/` (or
  pressing Ctrl+K / the "Open Command Palette" hotkey) in the expanded
  launcher opens the same in-flow palette as the compact bar and the
  desktop window — rendered in the expanded composer slot — with full
  execution, mini-app entry, row actions, and an Escape that closes the
  palette instead of collapsing the window. It was previously
  launcher-compact-only, so slash commands appeared dead in expanded
  mode.
- **Conversation history in the launcher ⋯ menu.** The menu grew a
  History entry (with a conversation-count badge) that opens a compact
  in-flow list of recent conversations. Clicking a row opens that
  conversation in expanded mode by default; a dedicated monitor icon on
  the right of every row opens it in desktop mode instead. Escape steps
  back from the history list before closing the menu, Arrow/Home/End
  keys navigate the items, and the list shows the active conversation,
  relative timestamps, and an empty state.
- **Redesigned launcher ⋯ menu.** Grouped sections (New conversation +
  History / view actions / Settings), icon tiles with hover accents,
  right-aligned shortcut hints (Ctrl+E / Ctrl+D), and full keyboard
  navigation; surfaces covered by the exclusion-free launcher axe scans.
- **Preset data now syncs from the family canonical file (plan 17
  Phase 1.6).** Provider presets, curated model allowlists, the
  whisper transcription default, vendor key URLs, setup checklists,
  and key-prefix hints are generated into
  `src/shared/ai/providerPresets.generated.ts` from
  `contracts/ai-presets.json` (the family single source) by
  `scripts/sync-ai-presets.mjs` — never hand-edited. Desktop's
  groq/ollama local enum mapping stays in the hand-written layer
  (the documented D2 carve-out). A new BYOK contract gate
  (`scripts/check-byok-contract.sh`, vendored with the canonical
  data) runs beside the AI alignment gate in CI: generated-data
  drift, `audio` capability literals outside the migration shim,
  setup-orchestration placement, the contract-test matrix, and
  options naming.
- **Actionable "no model" errors in the launcher.** When a turn fails
  because no chat model is assigned, the error banner now carries a
  deep-link button — "Set up AI" when nothing is configured, "Choose a
  model" when a provider exists — that opens Settings on the API tab
  at the right section (the deep-link target grew a `section` field),
  and actionable errors linger 20 s instead of 5 s so the button is
  actually clickable.
- **Defaults-first task assignments.** The Tasks tab leads with a
  "Default models" section — text, vision, transcription, speech —
  and tucks the derived tasks (titles, translate, plumbing, intent,
  voice endpoint) into "Other tasks" below.
- **Transcription and speech become separate capabilities, with
  whisper as the curated default (plan 21 Stage G).** The merged
  `audio` capability is split into `stt` (whisper-class) and `tts`
  (speech-class) — legacy caps migrate automatically — so pickers
  stop offering transcription models for speech and vice versa. The
  OpenAI preset curates `whisper-1` and setup gap-fills the
  transcription task (toggleable in the review); the wizard's
  defaults step gains a transcription row, and the Tasks tab puts a
  "Voice models" section (transcription, speech, voice endpoint) on
  top, separate from the text defaults.
- **The setup review is now editable cards and switches.** Curated
  models render as selectable cards with capability icons; the
  default fills are switch rows showing the current assignment —
  no more bare checkboxes.
- **Re-setup appends instead of replacing; bulk model cleanup (plan 21
  Stage F).** "Set up automatically" unions the fetched curated
  catalog into the provider's existing models (dedupe by id;
  custom models always kept) — configured models are never deleted.
  The edit form's Advanced section gains "Remove all fetched models"
  (destructive, confirmed; custom models untouched). The on-demand row
  action opens an **editable review modal**: pick which curated models
  to append, and toggle filling the empty text/vision defaults (each
  shows the current assignment) — the wizard flow stays confirm-free.
  Multi-select model
  management is tracked as a library `ModelRegistry` candidate.
  Curated models keep the `tools` capability by default — reasoning
  stays opt-in per model via the reasoning-effort tuning (D20).
- **Curated catalogs, on-demand re-setup, integrated provider rows
  (plan 21 Stage E).** Setup now persists only the curated models per
  preset (openai `gpt-5.6-terra/luna/sol`, gemini `gemini-3.8-flash`,
  anthropic `claude-sonnet-5` — the desktop center file; full-catalog
  fallback on drift; family-level single-sourcing tracked). Provider
  rows gain a "Set up automatically" action that re-runs setup on
  demand using the stored keyring key — revalidating, refreshing the
  curated catalog and gap-filling defaults. Provider rows and the edit
  form show vendor logos; the manual edit form moves the base URL
  under an Advanced disclosure matching the wizard. Manual add/edit
  and delete now persist immediately through the provider IPC
  (scrub-on-save) instead of riding the settings draft — every
  provider write is instant, results surface as notifications, and the
  settings window adopts the main config after each one.
- **Setup wizard as an overlay (plan 21 Stage D).** The provider
  setup flow now renders as a focused wizard modal with contextual
  footer actions and a header close — first run keeps a slim inline
  "Set up AI" card (with the Ollama detection banner) that launches
  it, and "Add provider" opens it directly. Each step's action button
  is the save (setup persists immediately; close just dismisses), which
  removes the mixed signal with the settings window's draft Save. The
  "Custom / manual" card and the edited-base hand-off chain into the
  legacy manual modal — sequential overlays, never nested.
- **Provider card grid + guided setup flow (plan 21 Stage C).** "Add
  provider" now reveals a card grid — vendor logo (simple-icons;
  monogram fallback for OpenAI/Groq) + name only — including a
  "Custom / manual" card that opens the legacy full form for any type
  or custom base URL. Picking a card opens the guided form: connection
  name prefilled, API key front and center, and the API base URL tucked
  into a collapsed Advanced section (read-only for fixed-base presets;
  editing it routes the save through the manual form with name/type/key
  carried over). After a successful setup the card offers the next step:
  "Default models" — bind the default text model and default vision
  model (vision options are capability-filtered). The Tasks tab renames
  the chat slot to "Default text model" and gains a "Default vision
  model" row; fetched catalogs get inferred capabilities so
  vision-capable models surface there.
- **Default text + default vision model routing (plan 21 D14).** A new
  `vision` slot joins the task assignments: turns that carry images or
  screen captures resolve the vision assignment first and fall back to
  the chat model (an explicit per-conversation model override still
  wins). `provider:set-default-model` accepts the target task and
  rejects vision bindings for models without the vision capability.
  Setup gap-fills `vision` alongside `chat` when the preset's bundled
  model is vision-capable and the slot is unassigned. Bundled preferred
  models updated per current catalogs (D15): openai `gpt-5.6-terra`
  (luna/sol ride the fetched catalog), gemini `gemini-3.8-flash`,
  anthropic `claude-sonnet-5` — all text+tools+vision.
- **One-click BYOK provider setup (plan 21).** Settings → API gains a
  "Set up AI" card for first run: neutral provider tiles (OpenAI,
  Gemini, OpenRouter, Anthropic, Groq, Mistral, DeepSeek, Ollama), a
  paste-anywhere key that pre-selects the matching tile, a per-vendor
  setup checklist, and a silent local probe that offers "Ollama
  detected — connect in one click". Setup validates the key
  **fetch-first** (the real model catalog is fetched under an abort
  timeout before anything persists), then binds the preset's bundled
  model to CHAT only when it exists in the fetched catalog and CHAT is
  un  assigned. Failures route to guided fixes instead of raw errors:
  invalid key, credit/quota limits, region blocks, timeouts, "Ollama is
  not running", and mis-paste hints ("this looks like an OpenRouter
  key — set up OpenRouter instead?"). When the catalog lacks the
  bundled model, the success view offers an inline model pick bound
  through `provider:set-default-model`. Setup is idempotent via a
  `presetKey` stamp on the provider row: re-setup updates the key in
  place, and pre-existing manual rows with the same type + base are
  adopted (earliest first), never duplicated. First-run entries: the
  launcher/desktop empty state and the tray menu ("Set up AI…") open
  the settings window on the API tab; all entries hide once a
  configured provider exists. New primitive
  `provider:set-default-model` upserts a model onto a provider and
  binds it to CHAT (+ default provider); cross-provider ids are
  rejected. Strings live in the `SETUP_*` section of `TEXT` (en-only,
  structured for later single-sourcing); the setup card ships with
  exclusion-free axe scans.

- **`[digest]` pipeline observability.** With `DA_AI_DEBUG=1` the
  context-digest plane now logs its skip reasons (no capability or
  provider), cache hit/refreshed/stale/failed states, context-tool
  discovery (a candidate miss names the tool counts), invoke failures
  and empty payloads — fetch and injection were previously fully
  silent, leaving live-trace diagnosis to inference.

### Changed
- **The system prompt knows the current date/time.** Every turn's
  system prompt (and the decision-engine prompt) now leads with the
  local date/time, weekday and IANA timezone (plan 23 S1) — models no
  longer spend a `system_info`/`llm_GetDateTime` tool call learning
  "now" before acting.

- **Plan 23 pause (2026-09-21).** The global skill-pack library
  (`config.skills`), the route-hand-off extensions, and the mid-turn
  digest/seed plumbing were reverted after the first live runs showed
  the composition had grown into compensating patchwork (multiple seed
  entry points, overlapping instruction channels, prompt recomposition
  at the middleware seam). Kept: the clock line (S1), the context-digest
  plane with its bound-only injection and the Apps-tab readout (S3/S6),
  the per-app authored skill (presets seed `spec.skill`; the legacy
  `promptNotes` channel was removed outright) and the decision-prompt
  digest (D9). A simplification pass replaces playbook-steered id
  resolution with programmatic validation against the digest.

- **Google chat models run on `@langchain/google`** (the LangChain-
  recommended `ChatGoogle`), replacing the legacy `@langchain/google-
  genai` and its hand-maintained converter patch — structured output
  now rides Gemini's full-JSON-Schema `responseJsonSchema`, and
  ToolMessage images are delivered as sibling `inlineData` parts
  natively (previously: local `patch-package` patch; the wire shape
  stays pinned by `tests/ai-gemini-tool-image.test.ts`).

- **Home Assistant preset defaults to `/api/mcp`.** The bundled preset's
  default endpoint is now `http://homeassistant.local:8124/api/mcp`
  (Home Assistant's MCP endpoint). Applies to new preset setups; the
  add-flow prefills it automatically. Existing saved apps keep their
  stored endpoint — edit the connection to update.
- **App detail modal: one Save, always-visible footer.** Editing an
  existing app now shows a persistent footer with Close and Save on
  every tab; a single Save persists the connection and the directives
  together (the separate per-section "Save connection" / "Save
  directives" buttons are gone, and a failed connection validation
  skips the directives write instead of half-saving).
- **Auto-scroll is now opt-in (off by default).** Transcripts in the
  launcher, expanded and desktop views no longer jump to the newest
  message while a response streams — you scroll manually, and the
  jump-to-latest pill stays available. Re-enable via Settings → General
  → "Auto-scroll to the latest message" (`behavior.autoScroll`).
- **One execution path for tools-capable models.** The turn gate no
  longer requires `getToolCount() > 0`: every model with the `tools`
  capability runs the agent graph even when the registry is empty
  (uniform telemetry/trace behavior), and the plain gateway stream is
  reserved for models without the `tools` capability or builds without
  a wired agent — one less rarely-exercised path to hide bugs in.
- **Settings behaves like a classic window.** The settings window no
  longer floats above everything (always-on-top removed) and gained
  title-bar controls — minimize and close buttons next to the version
  in the header — while the maximize ability is disabled; the footer
  Close button stays.
- **One trace UI everywhere.** Finished turns now render the same
  assistant-ui trace in every view — launcher, expanded, and desktop:
  the collapsed-expandable `ChatTraceTimeline` ("Turn trace · N tools")
  when turn trace details are enabled, the compact
  `model · duration · tools` badge row when not — replacing three
  divergent renderings (the launcher badge row, the FlowStatusCard
  "Turn trace" card in expanded/desktop that also vanished entirely for
  plain chat turns, and a timeline gated per view). Turn trace details
  stay opt-in (Settings → General, default OFF); the FlowStatusCard
  card is removed and `TraceTimeline` degrades to the badge row for
  turns without tool calls.

### Fixed
- **Sticky app bindings survive across turns again.** The agent runner
  keyed its sticky window and mid-turn `enable_app` bindings by the
  graph thread id — which carries a per-turn suffix
  (`conversation:message`) — so every new turn started from an empty
  window: matched apps had to re-earn their binding on each message,
  D19 router apps lost their mid-turn-enabled tools on the next turn,
  and app-context digests stopped riding the second turn onward. Both
  maps key on the conversation id now, bounded to the
  `CONVERSATION_STATE_LIMIT` (64) most recent conversations with
  oldest-first eviction.
- **Changelog head de-tangled.** The plan-23 rebase had committed this
  file with unresolved conflict markers and duplicate section headers;
  the kept-series entries below are intact and no content was lost.

- **App detail Save no longer reverts edited connection fields.** The
  one-Save footer wrote the app twice — the connection first, then the
  directives spread over the pre-save snapshot — so the second write
  restored the old endpoint (and any other connection field) while both
  writes logged as successful. Save is now a single write carrying the
  connection patch and the directives together; the footer test had
  pinned the two-call behavior and now pins the single write.
- **Chat turns with tools bind again on Gemini.** The native datetime
  tool's `z.union([z.string(), z.number()])` arguments rendered as a
  JSON-Schema type array, which the migrated `@langchain/google`
  converter rejects client-side ("Gemini does not support union types
  in function schemas") — failing every Gemini turn that bound tools
  with "An error occurred.". The schema now takes strings only (the
  tool already parses epoch digits-as-string, 'now', 'today' and ISO
  input), and the bind-time schema guard additionally reports
  type-array unions with tool + path so the next offender is named
  before it breaks a turn; a catalog-wide test keeps all native tool
  schemas Gemini-clean.
- **Decisions "Try a command" works with OpenAI reasoning models and
  Gemini.** Three provider 400s broke the decision-engine test (and any
  structured-output call on those models): OpenAI's gpt-5/o-series
  reject any non-default `temperature` ("Only the default (1) value is
  supported"), so the model factory now omits temperature for those
  models entirely — deterministic-task pins (`temperature: 0` on the
  decision and translation tasks) degrade to the model default there
  while every other model keeps them. Both Gemini ("Unknown name
  \"propertyNames\"") and OpenAI's `response_format` validator
  ("'propertyNames' is not permitted") reject JSON Schema keywords
  outside their supported subsets — free-form `z.record` argument
  schemas map onto exactly those — so the schema bound for structured
  output is now pruned to provider-safe keywords for every provider
  before the call (output values still validated by the zod schema).
- **Agent turns sent NO tools to the provider (tools=NONE) — tool
  calling was dead in every view.** The app-selection middleware
  filtered `request.tools` down to the app tools kept for this turn,
  so when no MCP apps were configured (or none matched the query) the
  model received an empty tool list and answered in plain text — on
  every provider, regardless of the model's `tools` capability. The
  filter now drops only the un-bound app tools and keeps all native
  tools (`web_search`, screen, files, …). Found via the new
  `DA_AI_DEBUG=1` wire tracing (`tools=NONE` in the llm-start line);
  regression test pins native-tool survival when no apps are
  configured.
- **Plain-stream turns crashed for OpenAI models ("model.stream(...) is
  not a function or its return value is not async iterable").** The
  current `@langchain/openai` returns a Promise from `.stream()`, but
  the gateway iterated it directly — Google's client still returns the
  generator synchronously, which is why only OpenAI (and any
  non-Gemini/Anthropic provider, e.g. OpenAI-compatible endpoints)
  failed. The gateway now awaits `.stream()` before iterating, so both
  client shapes work. This path is reached by models without the
  `tools` capability (plain no-tool chat turns) — e.g. after disabling
  tools on a model in Settings → Models — and by any task that streams
  through the gateway.
- **"New conversation" from the command palette did nothing.** The
  `nav:new-conversation` builtin round-tripped through main, which
  broadcast `launcher:new-conversation` to the windows — but no renderer
  ever listened, so pressing Enter on the palette row (or submitting
  `/new`) silently swallowed the command. The execute path now resolves
  it renderer-side (immediate fresh conversation, no round-trip), both
  launcher and desktop windows listen on the broadcast channel as a
  main-originated fallback, and a regression test pins the
  palette-row → fresh-transcript flow in expanded mode.
- **Editing a custom MCP app lost or hid most of its configuration.** The
  detail modal's connection editor bailed out for stdio servers (showing
  only a "Native group" placeholder — command and arguments were neither
  displayed nor editable) and silently dropped the access-token field on
  save. The editor now shows the full creation surface: stdio command +
  arguments (round-tripped), HTTP/SSE endpoint, bearer token, allowlist,
  timeout, max concurrency, env and headers. Token replacement travels as
  an `authToken` payload that main merges into the keyring headers blob —
  sibling custom headers are preserved (secret values never come back to
  the renderer, so it cannot merge client-side), and a hint marks apps
  with an already-stored token. Save errors from main now surface in the
  editor instead of failing silently.
- **Voice post-processing silently did nothing.** The utterance
  evaluator resolved the `voiceEndpoint` task with no fallback, so on
  a fresh setup (voice endpoint unassigned) every dictation verdict
  failed closed — no transcript correction, no formatting, no
  auto-send judgment; the raw transcript went through as-is. The
  voice endpoint now falls back to the chat model, like titles,
  plumbing and intent.
- **Auto-configured models showed text-only capabilities.** Fetched
  catalog rows were persisted without caps, so the Models tab fell
  back to the `text`-only default — vision and tools chips sat
  disabled on terra/luna/sol and every fetched model. Setup now
  persists inferred capabilities on fetched models
  (`gpt-5.6*`/gemini/claude → text+tools+vision), heals legacy
  uncapped rows on the next re-setup merge, and the Models tab infers
  caps for any remaining uncapped rows at display time.
- **Dead model assignments blocked the vision defaults.** If
  `taskAssignments.chat`/`vision` pointed at a model id that no longer
  exists on any provider (leftovers from an earlier setup era), the
  no-clobber guard treated the slot as taken and re-setup never filled
  it — the UI showed it empty while setup silently skipped it.
  Assignments now count as live only when the model resolves; dead
  references are rebound on the next "Set up automatically".
- **Vision defaults now converge on re-setup.** When a provider's text
  model was already bound (manually or by an earlier setup) and the
  vision slot was empty, re-running "Set up automatically" left vision
  unbound even though the text model supports it (and vice versa: a
  non-vision text model now gets the curated preferred bound for
  vision). Re-setup binds the vision slot to the bound text model when
  it is vision-capable, otherwise to the curated candidate, and the
  row action reports each binding as a notification instead of doing
  it silently.
- **Curated setup missed snapshot-suffixed catalog ids.** OpenAI (and
  other vendors) list models as dated snapshots
  (`gpt-5.6-terra-2026-09-11`), so exact-id curation matched nothing
  and setup fell back to the full 136-model catalog with no defaults
  bound. Curation now matches curated ids against exact ids and
  dated-snapshot suffixes, binds the resolved snapshot id as the
  text/vision default (falling back to the first curated match when
  the preferred id is absent), and — only when truly nothing matches —
  keeps the full catalog and says so in the wizard instead of failing
  silently.
- **Structured decisions with Gemini: schema rejected with 400.** The
  decision schema's free-form `args` object rendered JSON-Schema
  keywords Gemini's response schema does not accept (`propertyNames`,
  `additionalProperties`, `default`), so every structured pick failed
  with "Invalid JSON payload received". The model factory now converts
  the zod schema to a Gemini-safe JSON schema (keywords pruned) for
  Google providers; OpenAI-compatible, Anthropic and Ollama paths are
  unchanged, and the caller-side zod parse remains the output
  validator.
- **The structured chat-model decision engine now works with Gemini.**
  The engine sent two system messages (steer + tool catalog); Gemini's
  adapter only accepts one system message in first position, so every
  decision attempt failed with "System message should be the first one"
  and fell through to chat. The prompt and catalog now ride a single
  system message.
- **Fall-through traces name the engine that actually ran.** A failed
  decision attempt was always traced as "Decision · Needle" even when
  the structured chat-model engine was selected; the failure status now
  carries the resolved engine and the trace renders "Decision · Chat
  model" accordingly.
- **Decision engine ignored non-Latin input.** The lexical tokenizer only
  recognized ASCII (`a-z0-9`), so Greek (and any non-Latin) queries
  produced zero tokens — the candidate pass skipped the engine entirely:
  no routing, no tool dispatch, and no Decision trace row on plain
  turns. Tokenization is now Unicode-aware (letters/digits in any
  script, accents folded, Greek final-sigma plurals trimmed like
  English `s`), and route-tool example lines in non-Latin languages now
  mine working keyword tags.

- **Fast-path posture consistency.** `appContextFor` filters
  ineligible presets' apps, so the decision prompt no longer carries
  the device digest (or skill lines) for tools the surface excludes —
  no more dangling context teaching the engine to refuse.

## [v0.7.0] - 2026-09-19
### Changed
- **Flatter Tools sub-tabs.** The Tools panel itself (verification
  defaults above, native tool catalog below a thin divider) and the
  Memories, Web search, Translation, Decisions and Folders panels render
  directly on the tab — the outer bordered boxes are gone; the tab
  already frames the section.
- **Reworked app cards (Apps tab).** Cards now use the family `Card`
  compound: the app name owns a full-width row (the enable switch lost
  its inline label — it stays available to screen readers via its aria
  label), health/status shows as a color-dotted chip in the badge row,
  and actions sit on a footer divider — **Edit** (renamed from the
  vague "Details"), **Test**, and a danger-tinted **Remove** with a
  trash icon. Cards lift on hover.
- **Native tools and folder access are separate Tools sub-tabs.** The
  Tools tab's first section previously stacked verification defaults,
  the native tool catalog and granted folders into one scroll; the
  catalog (with its defaults) now lives on **Tools** and folder grants
  plus docs indexing move to a dedicated **Folders** sub-tab.
- **Uniform tabs across the settings window.** The API settings section
  switcher (Providers / Models / Task Assignments), the Apps tab's
  Apps/Settings view switcher and its detail-modal Connection / Tools /
  Scope switcher, and a new Tools-tab section switcher (Tools / Memories
  / Usage / Web search / Translation / Decisions) all render the family
  library's `SegmentedTabs` — one pill-style, keyboard-navigable
  component (roving tabIndex, arrow/Home/End keys) instead of three
  hand-rolled strips; the Tools tab's previously stacked sections now
  live one click apart.
### Added
- **Acknowledgments.** A `THIRD-PARTY-NOTICES.md` (linked from the README's
  new Acknowledgments section) credits Cactus Compute's Needle project —
  the vendored Apache-2.0 wasm runtime and the pinned `needle3` weights
  the optional local decision engine is built on.
- **Needle model credit.** The Decision card shows a compact credit line
  ("Needle 3 · Cactus Compute · Apache-2.0") whenever the local Needle
  engine is selected, linking to the model's Hugging Face page (opens in
  the system browser; the vendored runtime keeps shipping its LICENSE).
### Changed
- **Decision scope is now fully opt-in.** A freshly enabled decision
  engine dispatches nothing until you opt in: the built-in tool
  vocabulary (open apps/URLs, screenshots, volume, …) defaults to OUT
  of scope alongside the empty app allowlist — previously the built-ins
  stayed dispatchable even with no apps selected. Opt back in with the
  "Include built-in tools" switch in Settings → Tools → Decision; the
  card shows an idle hint while nothing is in scope. Configs that
  explicitly saved the switch keep their setting.
### Added
- **Decision scope, route tools and prompt steer (plan 20 S7a).** The
  decision engine's tool surface is now user-scoped and steerable.
  `config.decision.scope` allowlists tool apps (precision-first: empty
  default = no app tools in scope) and can exclude the curated built-in
  vocabulary. Custom **route tools** turn the engine into a router: a
  picked route tool hands the input to a normal chat/agent turn pinned
  to a chosen model — a validated hand-off (`name` pattern, unique,
  `modelId` must resolve; unresolvable models skip the tool with a
  warning), never an execution. An extra prompt (≤1000 chars) plus
  per-route-tool example lines are assembled into the engine system
  prompt in one place (`ai/decide/prompt.ts`) and consumed by both the
  needle and LLM engines. Routing dispatch: a picked route tool starts a
  normal turn on the routed model (agent or stream by that model's own
  capability) with a "routed to …" trace step and metadata provenance;
  a missing model or key falls through to the chat turn. Settings
  (Tools tab Decision card): app scope multi-select with an idle-hint
  for an empty scope, built-in-tools switch, route-tool add/edit/remove
  (name, description, model select from configured models, example
  lines) and the extra-prompt textarea — all strings via `TEXT`,
  axe-scanned with the ToolsTab.
### Fixed
- **Fast-path failures now repair through the agent.** When a decision-
  dispatched tool errors (e.g. Home Assistant couldn't match the target),
  the turn no longer dead-ends on the raw error: it falls through to the
  standard agent turn in the same conversation, seeding the trace with
  the failed attempt so the whole story stays visible. The agent's
  `enable_app` activation now traces with a readable summary
  ("Activating 'Home Assistant'…") instead of raw JSON, and decision
  fall-throughs (low confidence / compound request / engine error) show
  a "Decision · Needle" step in the agent's trace too.
- **Decision fast path skipped app tools on a cold MCP cache.** The
  decision surface projected app tools only from the manager's cached
  listing — which the agent path never populates (it connects lazily
  via `enable_app` without caching tool descriptions), so after every
  app start the first commands always fell through to the agent. The
  decision surface now warms the listing itself (settings-path
  `listServerTools`, bounded 2.5 s, fail-soft) and projects from it.
  The agent's on-demand activation is untouched — the decision engine
  preselects candidates locally, so warming costs one listing call and
  zero extra LLM context.
### Added
- **Decision trace step.** When a decision engine dispatches a tool,
  the turn trace now shows a "Decision · Needle" (or "· Chat model")
  step with the confidence and the act/confirm band — so the local
  model is visible in the same place the chat model's work is. The
  provenance was already persisted in message metadata and the
  `ai_calls` audit table (`intent` task, model `needle3`); it is now
  visible in the trace UI too.
### Fixed
- **Decision fast path never saw app tools; mispicks on big catalogs.**
  Two defects from the first live run: (1) the projected tool surface
  was capped at 40 and the native registry alone filled it — connected
  app tools (e.g. Home Assistant) were invisible to the engine;
  (2) with a 40-tool catalog the local model mispicked (it tried to set
  the monitor brightness for "dim the living room") at confidence 1.0.
  The surface now carries a curated dispatch vocabulary: native tools
  project only tagged, dispatch-worthy entries (power/shell/kill family
  excluded outright), app tools keep their authored keyword tags, and a
  lexical preselection pass (the plan-15 D17 pattern) ranks a small
  candidate set for the engine — measured on the real model: correct
  picks at honest confidences in ~600-700 ms, and off-topic inputs skip
  the engine call entirely. Fall-through reasons are now logged
  (`[decision] …`) for observability.
### Added
- **Decision engines settings (plan 20, stage 5 — the feature is now
  fully user-facing).** Settings → Tools gains a "Decision engine" card:
  pick the engine (off / chat model with structured output / local
  Needle), tune the act/confirm confidence thresholds, download the
  local model (~34 MB, pinned + checksum-verified, cancellable, offline
  afterwards), and try it with a test command that shows what the
  engine would pick — nothing executes. The API tab also gains the
  "Decisions (intent)" task row for assigning a specific model to the
  LLM engine. Everything stays optional and off by default.
### Fixed
- **Palette app-tool dispatch.** Executing an app tool from the command
  palette (plan 15 S6 rows, e.g. Home Assistant) failed with "Unknown
  tool" — the direct-dispatch host only knew native registry tools.
  App/MCP tools now execute through the same direct turn: effective
  risk (per-app overrides), the D18 entity-scope guard (out-of-scope
  device ids are rejected before execution, mirroring the agent
  bridge), timeouts and result capping identical to native tools.
### Added
- **Direct MCP execution + HA fast path (plan 20, stage 4).** With a
  decision engine enabled, "dim the living room to 30" can now run
  entirely through the Home Assistant tool app: the engine picks the
  app's tool from the projected surface (descriptions include the
  entity-id format), the dispatch validates the entity against the
  app's configured scope, and the call executes over the app's MCP
  server — approvals unchanged for state-changing actions.
- **Decision fast path in turns (plan 20, stage 3 — for users who enable
  a decision engine in config; default OFF changes nothing).** Short,
  plain composer inputs (no attachments, no slash command, no research
  flow) may now dispatch directly to a tool via the decision engine
  chosen in `decision.engine` — riding the exact same direct-tool turn
  as slash commands: unchanged risk policy, approvals, trace steps and
  audit rows. A confident single-call decision executes immediately;
  a mid-confidence one raises the approval card first; compound,
  low-confidence or failing decisions fall through to the normal
  chat/agent turn. Engine provenance (engine, confidence, band) is
  recorded in the assistant-message metadata. No settings UI yet —
  engines are enabled via `config.json` (`decision` block).
- **Local Needle decision engine (plan 20, stage 2 — groundwork, not yet
  user-visible).** The local engine behind the stage-1 decision funnel:
  the Needle 3 wasm runtime (Cactus Compute, Apache-2.0) is vendored
  pinned (revision + SHA-256) and runs isolated in a utility process
  (serialized operations, per-op timeout, crash-safe); the 35 MB model
  weights download is user-initiated, checksum-verified and atomic, and
  the engine works fully offline afterwards (no telemetry — asserted in
  tests). Engine output is zod-validated; a hallucinated tool name is a
  hard error, never a silent drop. Not reachable from the UI yet —
  turn routing and settings land in later stages.
- **Decision engines (plan 20, stage 1 — groundwork, not yet user-visible).**
  New optional capability for local/cloud intent routing and tool
  dispatch (Home Assistant fast paths, model routing), default OFF.
  Foundation only in this stage: the `intent` AI task (audited like
  every gateway call), `config.decision` settings (engine kind +
  act/confirm confidence thresholds), the decision funnel
  (`src/main/ai/decide/` — resolve → invoke → validate → audit →
  act/confirm/refuse band), and the LLM structured-output engine that
  runs on existing provider models. The local Needle engine, turn
  routing, and settings UI land in later stages; with the engine off,
  behavior is byte-identical to before.
- **Per-OS autostart.** "Launch on system startup" (Settings → General)
  now actually works everywhere and starts the app hidden in the tray
  on Windows and Linux (`--hidden` boot; on macOS the window opens —
  Electron has no hidden-launch flag). Linux is managed by the app
  itself via the XDG autostart entry (`~/.config/autostart/`), since
  Electron's login-item API is macOS/Windows-only; Windows registers
  with a `--hidden` argument. The toggle disables itself with a hint
  in development builds, a second app launch reveals an already-running
  instance even when it sits hidden in the tray, and the real OS state
  is exposed via the new `system:autostart-status` channel.
### Fixed
- **Startup composer focus.** The input area now auto-focuses when the
  app opens: the first window show (app boot / window recreation) never
  sent the `focus-input` push — only re-summons did. The composer now
  focuses on mount (`useChatSession`), which also fixes the desktop
  window, which had no focus push path at all.

## [v0.6.0] - 2026-09-18
### Changed
- **Translate pad polish (user feedback).** Long translations render in
  a multiline result panel styled like the response area — wrapped,
  scrollable, capped at the response-height budget, window grows with
  content — with an engine/route footer (`via DeepL · en → el`) and an
  always-visible copy button (was a single truncated line). The mini
  app mode bar is now a drag region: the window can be moved from the
  Translate/Calculator header (the exit button stays clickable).
- **Translate pad: configurable, conservative auto-send.** New
  `translation.padDebounceMs` (default 1500 ms, clamped 300–10000;
  was a fixed 700 ms) controls how long the pad waits after the last
  keystroke before sending — configured in the Tools-tab Translation
  card. The "Translating…" indicator now appears only while a request
  is actually in flight (the previous build showed it immediately on
  every keystroke), and the previous result stays visible until the
  next one replaces it.
### Added
- **Plan 19 S6 — translate pad mini app.** Bare `/tr` (or `/tr <lang>`
  with no text) opens the launcher translate pad instead of a usage
  error: debounced live translation (~700 ms, latest-call-wins),
  result row with hover copy, Enter copies (calc-consistent), pending
  and typed-error states inline, target language carried from the
  opening slash and shown in the mode bar. Runs over the new direct
  `translation:translate` IPC — no turn, no persistence, same
  `TranslateService` funnel (engines, failover, audit). The calc mini
  app is byte-identical (guarded sync path); `/tr <lang> <text>`
  keeps the direct turn fast path. Pad ships with event tests and an
  axe scan (zero exclusions).
- **Plan 19 S5 — translation docs sweep.** Architecture: AI-layer map
  entry for `src/main/ai/translate.ts` (the sanctioned service-engine
  module) and the Translation tool/section write-up; STATUS: plan-19
  row, phase note, on-target smoke checklist (LibreTranslate/DeepL
  live pass, custom-language turn, agent-path turn, kill switch,
  provider test). Plan 19 complete.
- **Plan 19 S4 — translation settings.** New Tools-tab Translation
  section (mirroring the Web-search card): engine-mode selector
  (`auto`/`service`/`llm`), default-target picker (custom languages
  first, then the built-in ISO-639-1 table), the custom-languages
  editor (code + name + optional native name with inline validation —
  built-in collisions, duplicates and malformed codes are rejected
  client-side and re-validated at config merge), and the ordered
  service-provider list (enable/reorder/edit/test/delete, keys
  keyring-only behind masked hints). Removing a custom language also
  clears a matching default target. The API tab gains the
  `TRANSLATE` AI-task row (`requires: 'text'` — the LLM engine
  assignment; no chat fallback). Section ships with an axe scan
  (zero exclusions) and config round-trip coverage; existing
  Tools-tab and Settings-app a11y suites extended for the new bridge
  methods.
- **Plan 19 S3 — the `translate` tool and `/tr` slash command.** New
  read-only native tool backed by `TranslateService` (service engines
  or the LLM task; agent-callable like any native tool, subject to the
  usual policy). Slash aliases `/tr` and `/translate` with the
  `/tr [language] <text>` grammar: the first token is the target only
  when it names a language (built-in or custom), everything after it
  is the text, a lone language token is a usage error, and an omitted
  target falls back to `translation.defaultTarget` (a clear error when
  unset). Results render with an engine/route meta line
  ("via DeepL · en → el"). Palette row + inspector example come from
  the shared alias table; both windows share one submit-time resolver.
  Event-driven turn test drives the real registry through the
  direct-tool channel; a scripted-graph smoke covers the agent path.
- **Plan 19 S2 — translation service engines + provider management.**
  DeepL and LibreTranslate fetchers live in `src/main/ai/translate.ts`
  (the sanctioned AI-layer module): DeepL v2 API with `:fx` free-key
  endpoint routing and typed auth/quota errors; LibreTranslate `/translate`
  with auto source detection and server-error passthrough; both cap
  output, honor per-provider timeouts (default 10 s, clamp 1-30 s) and
  external aborts, and write `translate`-task `AiCall` audit rows.
  `TranslateService` gains search-style provider CRUD (`save/delete/
  enable/move/test`), keys stripped to the keyring behind `keyHint`
  masking, `assertHttpUrl` SSRF posture, and ordered failover across
  enabled instances. New `translation:*` IPC surface (get/save/delete/
  set-enabled/move/test) exposed through the preload bridge and
  documented in `docs/dev/ipc.md`.
- **Plan 19 — custom language codes.** Users can define their own
  target languages (custom codes/scripts, e.g. Ancient Greek) under
  `translation.customLanguages` (`{code, name, nativeName?}`); entries
  are sanitized at config merge (2-12 chars `[a-z0-9-]`, lowercased,
  no built-in collisions, duplicates dropped) and `defaultTarget`
  validates against built-ins + custom codes. One resolution helper
  (`resolveLanguage`) serves validation and the LLM prompt carries the
  custom name; the settings editor lands with the plan-19 S4
  Translation card.
- **Plan 19 S1 — translation substrate.** New `translate` AI task
  (`AiTask.TRANSLATE`, no chat fallback), `translation` config section
  (`mode: auto|service|llm`, `defaultTarget`, ordered `providers` with
  merge-time validation of mode and default target), a shared ISO-639-1
  language table (`src/shared/languages.ts`), the `src/main/ai/
  translate.ts` engine module (translation prompt builder, output
  normalizer with fence/quote stripping and an 8k result cap, 10k input
  cap, LLM engine through the gateway at `temperature: 0`, pure engine
  dispatcher) and the `TranslateService` shell — uniform
  `translate({text, target?, source?})` entry with ordered service
  failover, keyring-resolved keys, abort propagation and typed errors
  for every unconfigured path. Service fetchers land in S2.

## [v0.5.0] - 2026-09-18
### Changed
- **`mcp:*` compat channels retired (plan-15 polish exit).** The seven
  plan-11 IPC channels (`mcp:get-servers` … `mcp:list-tools`), their
  preload bridge methods and the Tools-tab MCP server card are gone —
  MCP servers are managed exclusively as tool apps through the
  `apps:*` surface and the Apps tab (full parity: connection editor,
  secrets, allowlist/timeouts, per-tool enable/risk, tests). The
  Tools-tab native list no longer mixes in MCP catalog rows;
  `AppService.mcpServerViews/saveMcpServer/setMcpToolOverride` and the
  now-unused `McpServerView`/`McpServerSaveInput` shared types were
  removed with them.
### Added
- **Plan-15 polish, per-app usage analytics.** New `apps:usage-stats`
  IPC over the existing `tool_calls` audit: `AppService.
  appDisplayNameForTool` attributes each call to its app (backing MCP
  server or native-group membership; unattributed native/command calls
  are excluded) and `getAppUsageStats` aggregates totals, outcomes and
  average durations per app. The Apps tab settings sub-view gains an
  "App usage" card (7/30/all windows, CSS bars, no chart lib).
- **Plan-15 polish, tool-cache TTL refresh.** MCP tool snapshots now
  carry a fetch timestamp (`McpManager.cacheAgeMs`); whenever the
  settings Apps tab fetches state (`apps:get-state`), `AppService`
  fire-and-forget re-lists enabled apps whose cached snapshot is older
  than `TOOL_CACHE_TTL_MS` (5 min) or missing — never blocking the
  response, deduped while in flight, failures swallowed so a down
  server keeps serving its stale snapshot.
- **Plan-15 polish, Apps tab batch.** Lucide icon picker per app
  (curated 46-icon set in `settings-react/apps/app-icons.tsx`, saved as
  `app.icon` via the existing spec validation; cards render the picked
  icon, falling back to the name monogram), the app list is a
  two-column card grid (`sm:grid-cols-2`), and the app-detail Tools
  tab gains a filter box (name/description/keyword tags) plus
  risk-tier group headings with counts.
- **`datetime` native tool.** Feature-rich date/time/timezone tool
  (`src/main/ai/tools/native/datetime.ts`, category `system`,
  read-only, auto-run): `now` snapshot (epoch, ISO week, quarter,
  leap year, day of year), `format` (ISO / RFC 2822 / unix /
  unix_ms / full-long-medium-short presets / `%`-token template
  with optional locale), `convert` (DST-aware IANA timezone
  conversion), `shift` (calendar-aware add/subtract with month-end
  clamping), `diff` (units + calendar + business days), `info`
  (calendar facts), `relative` ("in 3 days" / "2 hours ago"),
  `countdown`, `week`,   `business-days`. Accepts ISO 8601, epoch
  seconds/millis, `now`, or `today` inputs; calling it with no
  arguments returns the full current `now` snapshot. Pure date math helpers
  are exported for tests (`tests/datetime-tool.test.ts`, 21 cases).
### Changed
- **Settings modals adopt `ModalBody` from `@neuronection/assistant-ui`.**
  The padded body region (`px-6 pb-6`) that every settings modal hand-rolled
  (Api, Automation, Commands ×3, Search, Apps ×2, Tool details) is now owned
  by the library layout — `ModalHeader` / `ModalBody` / `ModalFooter` carry
  their spacing; callers pass only content. Also fixes the Apps detail/add
  modal bodies, which previously rendered without horizontal padding.
  Dep bumped to `@neuronection/assistant-ui@^0.42.0` (0.41.0 shipped
  `ModalBody`).
### Changed
- **Provider model-catalog fetching moved into the AI layer (ADR-0018).**
  The per-provider branches (OpenAI-compatible `/models`, Anthropic
  `/v1/models`, native Gemini `v1beta`, Ollama `/api/tags`) now live in
  `src/main/ai/catalog.ts` — the sanctioned non-chat-endpoint surface,
  keyed at call time like TTS. `AIService.fetchAvailableModels` is a
  thin wrapper (key-presence check + delegate); behavior, error copy
  and the returned `Model[]` shape are unchanged. Satisfies the
  family alignment gate's R5 — desktop is strict again.
- **Details modal tabbed + tool cards (plan 15 polish).** The app
  Details modal is now tabbed — Connection / Tools / Scope — and the
  Tools list renders as multiline cards (name + risk chip, description
  line, keyword-tags editor full-width with the risk override beside
  it), with tool descriptions straight from the server cache. Saving
  scope rules no longer kicks the user back to the first tab.
- **Apps tab redesigned (plan 15 polish).** Apps / Settings sub-views;
  richer app cards (two-line descriptions, source + health + bound-tool
  chips); unified "Add app" flow — From preset (cards with per-preset
  risk preview) or Custom MCP server; tool budget moved into the Apps
  Settings sub-view with a usage bar, plus the all-apps master switch
  and matching help.
### Added
- **Add custom apps from the Apps tab (plan 15).** "Add custom app"
  creates a preset-free app from a raw MCP server config — streamable
  HTTP, SSE or a local stdio command, with an optional bearer token
  (keyring-stored). Completes the D11 move: the Apps tab is now the only
  place apps are added; the Tools-tab MCP form keeps working through the
  compat layer and will retire with it.
- **Agent-side app router (plan 15).** Every enabled app appears in the
  agent's context as one directory line (name + short description), and
  the agent can activate an app mid-turn with an `enable_app` tool call —
  its tools become callable for the rest of the conversation without a
  user round-trip. This makes discovery language- and synonym-agnostic
  (the model is the router), covers exactly the keyword-matcher's blind
  spots, and enforces the tool budget at activation. Routing is scoped to
  user-enabled apps; policy, approvals and audit still gate every
  execution. Enabled apps persist per conversation thread.
- **Standing per-app directives (plan 15).** Each tool app can carry
  user-authored standing directives (capped, 500 chars) — e.g. "For all
  Home Assistant tools use the app tools, never shell commands" — that
  are injected into every turn's system prompt while the app is enabled,
  regardless of whether the app is bound. Rendered as fenced,
  app-labeled blocks, distinct from preset `promptNotes` (reference
  data, bound-only). Edited in Apps → Details; the model and servers
  can never write them.
- **Tool apps in the palette (plan 15 S6).** Enabled app tools appear in
  the command palette (source `mcp`, grouped under Integrations) and
  dispatch through the standard turn path — no new execution channel.
  Destructive and kill-switched tools are excluded; server-down rows are
  flagged disabled with their cached descriptions; integration-pack rows
  bound to a tool an enabled app exposes are suppressed from the catalog
  and resurface when the app disables or is removed (D12). The inspector
  tool catalog carries `appName` + inline health for app tools. Plan 15
  complete: S1 foundations, S2 per-turn selection, S3 deferred search,
  S4 HA preset + entity scoping, S5 Apps tab, S6 palette.
- **Settings → Apps tab (plan 15 S5).** App list (source chip, health
  chip + last error, enabled switch, search + status filters), detail
  modal (connection editor with keyring-only token, per-tool table with
  new-tool markers and tighten-only risk overrides + undo, entity-scope
  rule editor with a live device preview via `apps:preview-scope`,
  exposure selector gated on provider tool-search support), preset card
  with permission preview before add, and a tool-budget card (budget is
  now `config.toolApps.toolBudget`, enforced by the selection engine).
  The Tools tab keeps native-tool toggles only — its MCP section moved
  here (D11). Axe scans exclusion-free.
- **Home Assistant preset + scope enforcement (plan 15 S4).** The
  flagship bundled preset (zod-validated manifest, versioned) ships the
  D10 default risk map — status/list/filter tools read-only, control
  state-changing, nothing destructive — plus fenced `promptNotes`
  capability guidance injected only while the app is bound, and help
  copy recommending a restricted HA user token as the strongest device
  scoping. Preset-authored data (`baseRisk`, entity role/arg,
  `promptNotes`) is main-owned: renderer submissions are stripped and
  new tools are stamped from the preset template at reconcile (D13).
  D18 `entityScope` is now enforced at the bridge: action tools'
  entity arguments are validated before dispatch (out-of-scope calls
  skip the approval card and get an honest error) and discovery
  results are filtered before the model sees them. Trajectories run
  against a real streamable-HTTP MCP fixture: dim-lights
  match→approval→resume, scoped list/control, and server-down
  degradation. `apps:list-presets` serves the bundled presets (add-flow
  preview lands in S5).
- **Deferred tool search for tool apps (plan 15 S3).** Apps with
  `exposure: 'deferred'` bind unconditionally behind the provider's
  server-side tool search on capable models (Claude Sonnet 4+/Opus 4+/
  Haiku 4.5+, gpt-5.4+ on the real OpenAI API — the installed
  middleware gates the concrete model and throws elsewhere), staying
  outside the 25-tool budget (flat context). Capability detection lives
  in the model factory seam and runs before the search middleware is
  ever constructed; incapable providers silently fall back to
  `relevance` semantics. `apps:get-state` now reports
  `deferredSupported` for the active chat model (settings gating lands
  with the Apps tab in S5).
- **Per-turn tool-app selection (plan 15 S2).** The agent now curates
  app tools every turn: `always` apps bind unconditionally, `relevance`
  apps match a deterministic whole-token matcher (D17 — normalized,
  substring-proof; the app name is an implicit tag) with a 2-turn
  sticky window so follow-ups like "now the bedroom too" stay bound
  (D15), and everything else is dropped under a 25-tool budget guard
  that drops `relevance` before sticky apps in spec order and never
  drops `always` apps. A dropped app surfaces as a capped, config-only
  availability hint so the model can offer it by name (D16) plus an
  "App selection" trace step in the turn timeline. Unbound app tools
  are rejected by a `wrapToolCall` guard and excluded from HITL
  `interruptOn`, so an approved-on-resume tool always executes (D14).
  `entityScope` enforcement rides the preset stage (S4) per plan.
- **Tool apps foundation (plan 15 S1).** Apps are bundles of tools
  wrapped around MCP servers — the first stage of the tool-apps plan:
  `config.toolApps` (zod-validated `ToolAppSpec`s with per-tool
  `toolState` — denylist posture, tighten-only risk overrides — and
  ordered `entityScope` allow/deny entity patterns), a new
  `AppService` (validated CRUD, self-disable-on-invalid boot
  pipeline, keyring lifecycle `app:<id>:*` with deletion on remove),
  and the `apps:*` IPC surface (get-state / save / remove /
  set-enabled / set-tool-state / set-entity-scope / test-connection).
  MCP-backed apps feed the existing tool substrate unchanged
  (registry, policy, HITL, audit untouched).
### Changed
- **MCP servers now live only inside tool apps (breaking, plan 15
  D11).** `config.tools.mcpServers` and `tools.mcpToolOverrides` are
  removed: a one-time migration wraps every standalone server as a
  custom app (config + per-tool overrides + keyring blobs move;
  `mcp:<id>:*` secrets re-namespaced to `app:<id>:*`). The Settings →
  Tools MCP section keeps working through a compat view over the app
  store until the Apps tab ships (plan 15 S5); per-tool risk edits on
  that legacy surface keep plan-11 semantics (any risk, written as
  the app's authored baseline), while the new `apps:*` surface is
  tighten-only.
- **assistant-ui 0.39 → 0.40**: `ChatToolsCatalog` entries accept an
  optional `badge` chip (`{ label, tone?: 'info' | 'warning' }`) beside
  the tool name — groundwork for marking non-callable HITL capability
  rows (ADR-0015) distinctly from callable tools.
### Fixed
- **App tools vanished for a turn when the MCP reconnect failed.** A
  failed reconnect (or backoff window) left the app with zero tools —
  the model improvised with unrelated tools instead. Now the last known
  tool list stays bound as unreachable placeholders: invocations return
  an honest "server unreachable" observation, the app-selection trace
  step names unavailable apps distinctly (`tools could not be loaded`)
  instead of a generic no-match, and no approval is wasted on calls that
  cannot succeed.
- **App matcher missed plural queries** ("turn on the lights" vs a
  `light__…` tool): D17 normalization now stems trailing `s` on both
  query and vocabulary tokens (4+ chars), preserving exact matches while
  adding plurals. The Apps-tab detail modal also gains a per-tool
  keyword-tags editor — the user-facing lever for teaching the matcher
  server-specific tool names (HassMCP-style `domain__Action` names carry
  no plan-preset tags).
- **The Apps-tab budget card counted only app tools while the selection
  engine counts native + command + app tools** — a toolset could be over
  budget (whole apps dropped for the turn) with no warning shown. The
  card now shows the engine-accurate total (native + apps) and warns
  against the configured budget.
- **App health chip said Unavailable after a successful connection test.**
  The settings path (Test / tool listing) never updated the MCP server
  state to `connected` — only the agent path did — so the Apps tab row
  chip lagged reality. Connection success now marks the server
  connected (and clears reconnect backoff) on every path; the Apps-tab
  tool list also states that changes apply immediately.
- **Composer no longer flips 1↔2 lines per keystroke** (assistant-ui
  0.37 → 0.39.0): the library `ChatComposer` derived its `data-multiline`
  flag from the textarea's width — which the flag itself controls via the
  footer-wrap styling — so drafts near the wrap threshold oscillated the
  layout (and the toolbar positions) on every keystroke once a
  response/trace was on screen. Upstream 0.39.0 makes the flag
  hysteretic: once multiline it stays until the draft clears.
- **Gemini no longer hallucinates screenshot descriptions.** Tool results
  carrying images (`screen_capture`, `recall_screenshot`) were invisible
  to Gemini models: `@langchain/google-genai` serializes every ToolMessage
  content block — including base64 `inlineData` — into the
  `functionResponse.response` JSON struct, which the Gemini API treats as
  opaque text (LangChainJS issue #10297; fix PRs closed unmerged as of
  2.3.2). The model received "The image is attached below." plus an inert
  base64 JSON blob and invented plausible content. `patch-package`
  (new devDependency + `postinstall`) now applies
  `patches/@langchain+google-genai+2.3.2.patch`: the converter splits
  ToolMessage parts into text (kept in `response.result` as a plain
  string) and media, then nests media as the Gemini-3-documented
  `functionResponse.parts` on `gemini-3*` models or as sibling
  `inlineData` parts on older ones. Covered by
  `tests/ai-gemini-tool-image.test.ts` (fails if the patch is not
  applied); text-only and error tool results are byte-identical to the
  stock converter.
### Security
- Cleared the 10 high-severity `npm audit` findings (GHSA-ggr8-5vv4-36mx,
  `deepmerge-ts` stack exhaustion): npm `overrides` now pins
  `deepmerge-ts` to the patched `^8.0.2` across the Prisma CLI chain —
  upstream ships the fix only in unreleased `8.1.0-dev.5+`, so no version
  downgrade was needed. Also dropped the unused `@prisma/migrate`
  dependency (nothing imported it; it dragged a second major of Prisma
  7.x internals into the tree). Prisma generate/validate/gensql verified
  unchanged.
### Changed
- **pdf-parse 1.1 → 2.4** (PDF text extraction in AttachmentService +
  DocsIndexService): v2 replaces the bare `pdf(buffer)` call with the
  `PDFParse` class (`getText()` + explicit `destroy()`), ships its own
  types (the `@types/pdf-parse` stub is gone) and keeps a CJS build, so
  no ESM migration was needed in the main process. Real-PDF extraction
  smoke verified; docs-index suite updated to the class-shaped mock.
- **zod 3.25 → 4.6** (LangChain stack accepts `^3.25.76 || ^4`): tool
  schemas, manifest validation, memory-verdict parsing and config
  validation all pass the suite unchanged. Two internal migrations:
  `z.record` calls now carry explicit key schemas (v4 requirement), and
  the settings/command-catalog schema introspection moved from the
  removed `_def.typeName` v3 internals to v4 `def.type` (enum `entries`,
  literal `values` array, number-format checks for integer detection).
- **openai SDK 5.23 → 7.17** (the sanctioned STT/TTS surface): typecheck
  and the stt/tts suites pass unchanged — `audio.transcriptions.create`
  with Node read streams and `audio.speech.create` are stable across
  the v6/v7 majors; no code changes.
- **Vite 6 → 8** (Rolldown-based) with `@vitejs/plugin-react` 4 → 6 and
  `vite-tsconfig-paths` 5 → 6; vitest 5.0.1 and `@tailwindcss/vite`
  4.3.3 already peer-support vite 8. One code fix: a pre-existing
  duplicate mid-file import block in `tests/command-tools.test.ts`
  (esbuild merged it silently, oxc errors) — removed. Renderer build
  drops from ~15s to ~1s. Dev-server config unchanged (dev CSP relax
  plugin, ports, multi-entry inputs all as before).
- **@neuronection/assistant-ui 0.30 → 0.37**: reviewed the library
  changelog 0.31–0.37 — all additive or fixes, no breaking API against
  this app's inventory (ProviderForm's preset-catalog props are
  optional; `HitlProposalCard`, `SegmentedTabs` and the `/flow-trace`,
  `/markdown-diff-view`, `/countries` subpaths are new surface).
  Behavior deltas: chat bubbles use `--as-radius` (softer bubbles, tail
  corner kept), `ChatToolCard`/`ChatTraceTimeline` render detail JSON
  as structured key/value panes, `SettingsShell` collapses its rail to a
  chip row below 48rem shell width (the settings window stays wider).
  Full verify gate incl. exclusion-free axe scans green.
- **Prisma 6 → 7 migration** (Rust-free client): generator moved to
  `prisma-client` (output `src/generated/prisma`, CJS module format —
  the `binaryTargets` engine matrix is gone), SQLite access now runs
  through `@prisma/adapter-libsql` (N-API driver — the same prebuilt
  binary serves vitest under Node and the app under Electron, replacing
  better-sqlite3's per-ABI builds and the entire runtime query-engine
  discovery in `DatabaseService`). CLI config moved to
  `prisma.config.ts` with dotenv (v7 stops auto-loading `.env`;
  the datasource entry is conditional so generate/gensql work without
  `DATABASE_URL`, keeping CI green); `prisma:gensql` uses the renamed
  `--to-schema` flag; packaging drops the `*.node` engine
  extraResources. Bootstrap `schema.sql` regenerated byte-identical.
  Verified end-to-end under Electron's runtime (connect/DDL/query via
  the compiled dist client). Also clears the audit findings from the
  Prisma CLI's `mysql2` chain via an override.
- Dev-tooling majors: ESLint 9 → 10.10 (with typescript-eslint /
  `@typescript-eslint/*` 8.70, which support ESLint 10 — flat config
  needed no changes), concurrently 9 → 10, wait-on 8 → 9. Lint output
  unchanged (0 errors), full verify gate green.
- Routine in-range dependency refresh (`npm update`): LangChain stack
  patches (core 1.2.11, openai 1.5.13, anthropic 1.5.10, google-genai
  2.3.2, langgraph 1.4.15), Electron 44.4.1 (security patches), React
  19.3.0, lucide-react 1.46.0, vitest 5.0.1, tsc-alias 1.9.5,
  `@types/node` 24.13.5. Full verify gate green.
- Settings restructure: a new **Voice** page owns speech input
  (dictation behavior) and spoken replies (speak-replies toggle,
  voice, speed) plus a read-only assigned-models block for the STT/TTS
  tasks with a jump to API → Tasks. The API page now uses sub-tabs —
  `Providers | Models | Task Assignments` — replacing the stacked
  sections; all task assignments (including stt/tts) stay together on
  the Tasks sub-tab. VoiceSection became the VoiceTab page.
### Fixed
- Long tool-using turns (multi-step web investigations) no longer fail
  with "Recursion limit of 12 reached": the agent's LangGraph superstep
  budget rose from 12 to 25 (~12 tool rounds instead of 5), and the
  research flow derives its own budget (`RESEARCH_RECURSION_LIMIT`,
  built from `MAX_RESEARCH_ROUNDS` with a spare round of headroom)
  instead of sharing the agent constant. The per-turn token budget rose
  from 80k to 300k cumulative tokens, sized to bind around the 5-minute
  wall clock instead of cutting research-heavy turns short (modern
  models carry far larger contexts than the old spend guard assumed).
  All three budgets stay internal constants — no settings surface.
### Added
- Graceful limit degradation (plan 17 S1): turns that hit a budget —
  the agent's step limit, the cumulative token budget, or the 5-minute
  wall clock — no longer die with a raw framework error. Both runners
  synthesize one partial answer from the findings gathered so far
  (static honest line when there is nothing to salvage), the turn
  completes with an amber "partial answer" notice instead of the error
  banner, and the salvaged answer is persisted so follow-up questions
  work. Real provider/tool failures still fail loudly.
- History that fits (plan 17 S2): long conversations no longer push
  past the model's context window with a raw provider error. History
  is clamped (PDF text and per-message image caps) and windowed
  newest-first over whole turns to an internal token budget (weighted
  heuristic, no tokenizer dependency); the current turn is never
  trimmed, and a visible "Older context trimmed" trace step marks
  what the model no longer sees.

## [0.4.2] - 2026-09-16
### Changed
- The clipboard offer is now a composer toolbar button instead of a
  floating chip above the composer: it appears only when the clipboard
  changed since the last summon (poll-on-summon, main-gated by
  `behavior.clipboardWatcher`) and inserts the full clipboard text on
  click; the preview moved into the tooltip. Polling logic moved to a
  `useClipboardOffer` hook.
### Added
- (nothing yet)

## [0.4.1] - 2026-09-16
### Fixed
- First message in a conversation failed on Google providers with
  "System message should be the first one": recalled memories were
  injected as a second leading system message next to the agent's own
  system prompt, which Gemini rejects. The memory context block now
  composes into the single system prompt (`memoryContext` on the turn
  input); the non-graph fallback path keeps its valid system-first
  shape. Recalled-memory turns are provider-agnostic again.
### Added

## [0.4.0] - 2026-09-16
### Changed
- Speak clicks now react immediately: synthesis shows a "Preparing
  audio…" bar (plus a spinner on the clicked reply button, which
  disables until audio arrives) instead of nothing during the
  provider roundtrip — speech is now a tri-state
  (idle → loading → speaking) surfaced through the SpeechBar in both
  windows. The composer speak-selection button disables while loading.
- Speak selection moved from a floating chip into the composer toolbar:
  a speaker button appears next to the other composer actions while
  text is selected in the window (launcher + desktop). The chip's
  preview/dismiss row is gone — the selection is already visible in the
  composer, and `useWindowSelection` moved to its own module.
- The slash-command hint now lives in the composer placeholder
  ("Ask AI anything — / for commands") instead of a separate dismissible
  pill above the composer — one less floating row in the compact
  launcher, same visibility window (both only show for empty input).
  The palette still teaches Tab/Enter interactively once open.
### Fixed
- The packaged launcher hid itself whenever it lost focus ("clicking
  another window minimizes it"), regardless of settings: the
  click-away hide was gated on dev mode only and never consulted
  `behavior.hideOnBlur`, so the Settings → General toggle
  ("Hide the launcher when it loses focus", default off) did nothing.
  The hide is now opt-in through that toggle; dev builds still keep it
  off for DevTools usability.
### Added
- (nothing yet)

## [0.3.0] - 2026-09-16
### Added
- **Native Gemini TTS support.** GOOGLE-type providers with a Gemini
  TTS model (e.g. `gemini-3.1-flash-tts-preview`) assigned to the
  `tts` task now synthesize via the native `generateContent` API
  (`responseModalities: ['AUDIO']`) inside the sanctioned
  `src/main/ai/tts.ts` module — plain `fetch`, no new SDK imports.
  The raw PCM response is wrapped in a WAV container for playback
  (`audio/wav`); the app's OpenAI-style voices map onto Gemini's
  prebuilt voices (unknown names pass through verbatim) and speed is
  ignored on this path. Provider errors are normalized with their
  HTTP status so the compact error notice still works.
### Fixed
- Deflaked `tests/node-run-persistence.test.ts`: graph-node-run writes
  are fire-and-forget by design, so the test now polls the database for
  both rows (5 s budget) instead of assuming they landed once the turn
  `finished` broadcast arrived — it failed intermittently under
  full-suite parallel load.
- TTS playback was blocked and the speaking bar stuck forever: the
  chat window's CSP (`default-src 'self'`) rejected the
  `data:audio/wav` media URL, and a CSP-blocked media load fires no
  element events in Chromium so nothing ever settled the player. The
  chat entry CSP now carries `media-src 'self' data:` (settings and
  result-viewer stay strict), and `speechPlayer` gained a 10 s
  start-watchdog that settles playback which never begins. Also fixed
  a latent stop-latch bug in `speechPlayer.play` (the generation
  counter was captured before the internal `stop()` bumped it, so the
  playback promise could never resolve and the "Speaking…" bar never
  hid on natural end).
- TTS failures now surface as a compact notice in the UI instead of
  failing silently: `ai:tts-synthesize` rejects with a short
  status-mapped message (`compactTtsError` in `src/main/ai/tts.ts`,
  e.g. "model or endpoint not found (HTTP 404)" for provider SDK
  errors whose raw text is just "404 status code (no body)") and the
  renderer shows it via `TEXT.SPEECH_FAILED`.
### Added
- Docs for node telemetry & flows (plan 13 S7): architecture.md gains a
  "Node telemetry, traces & the research flow (plan 13)" section
  (stream-derived telemetry, `GraphNodeRun` persistence, the research
  graph and its explicit policy-gated interrupts);
  development.md explains how to read `resumed` in traces and
  persisted node timelines (checkpoint jumps vs fresh execution);
  ipc.md documents the `flow` fields on `ai:turn-start` and
  `commands:execute`; the README marks the still-owed on-target
  flow-UI screenshot with a placeholder note.
- **Research flow graph (plan 13 S6).** The one custom `StateGraph`:
  `plan → (search → fetch → assess)* → synthesize` with bounded rounds
  (max 3, family extraction-loop rule) and a 2-fetches-per-round cap,
  producing a cited report with per-source references. Nodes call the
  model factory + audit handler (`chat.research` task) and the
  registry's `web_search`/`web_fetch` tools directly
  (`schema.parse` → `exec`). Security: no HITL middleware on custom
  graphs — tool execution consults the policy engine explicitly
  (`decision`/`needsApproval` → LangGraph `interrupt()` with the same
  approval envelope), so approvals reuse the same ApprovalCard,
  60-second main-owned auto-deny and idempotent resume; a rejection
  cancels the flow cleanly ("Research cancelled — the fetch was
  denied."). Fetched content stays an untrusted observation in state
  and the synthesis prompt forbids following instructions inside it.
  Streaming rides the same `updates`/`messages` bridge — node
  telemetry (`plan`/`search`/`fetch`/`assess`/`synthesize` labels),
  FlowStatusCard rendering and `GraphNodeRun` rows (flow `research`)
  come free. Invoked via the `/research <topic>` builtin command
  (`flow: 'research'` on the turn request); without a wired runner the
  turn fails with a clear error instead of silently chatting.
- Node-outcome persistence (plan 13 S5, changelog repair): finished
  graph nodes land in the `GraphNodeRun` table (flow, thread, node,
  outcome, duration, resumed — 7-day prune riding the checkpointer
  boot prune) and the final node timeline persists in message
  metadata (`nodeTimeline`), so trace meta stays truthful after
  restart.
- Memory consolidation (plan 16 S2): Settings → Memories gains "Smart
  merge" (off by default) + a "Consolidate now" pass with a status
  line. On saves landing in the gray zone (similar but below the
  deterministic-dedupe threshold), a `plumbing`-task gateway call
  arbitrates keep-new/keep-old/merge; verdicts are zod-validated and
  any failure falls back to the deterministic path. Merged rows record
  the absorbed memory as provenance so the manager's undo restores
  both sides; user-sourced memories are never auto-deleted.
- Memory on the FTS5 search stack (plan 16 S1): `memory_search` and
  turn-start recall now run through a `Memory_fts` external-content
  FTS5 index (porter tokenizer, trigger-synced, boot rebuild
  self-heals drift) with bm25 ranking and the exact-match boost —
  finding stemmed matches the old LIKE path missed. The bounded LIKE
  path remains as the tested degradation fallback, a query timeout
  guarantees recall can never stall turn start, and injection caps are
  byte-identical.
- Tool-usage dashboard (plan 12 §7): Settings → Tools → Usage reads
  the tool_calls audit read-only — per-tool call counts, ok/error/
  denied splits, approval-source ratios, average durations and recent
  failures over a 7-day/30-day/all window; dependency-free CSS bars
  riding the shared motion tokens.
- `plumbing` task routing (plan 12 §7): the task registry gains an
  internal-helper assignment (cheap-model suggestion in the UI) used
  for title-ish work — titles prefer their own assignment, then
  plumbing — and future internal calls via `resolveInternalModel`
  (plumbing → chat-model fallback).
- Per-conversation personas (plan 12 §7): the desktop inspector gains
  a Persona field per conversation — composes after the provider
  system prompt with explicit precedence framing ("this conversation
  only"); the launcher keeps the global prompt. Persona survives
  restarts in conversation metadata.
- TTS replies (plan 12 §6): Settings → Voice gains "Speak replies"
  (off by default) with voice + speed options, and Settings → Models
  gains a `tts` task assignment (OpenAI-compatible `/audio/speech`;
  audio-capable models). When enabled, a finished assistant reply is
  stripped to speakable text (code blocks drop, links speak their
  label) and synthesized main-side through the sanctioned
  `src/main/ai/tts.ts` endpoint module — task-resolved, keyring
  secret, audited on the `tts` task. Playback uses HTMLAudio in the
  renderer with a `da-voice-wave` speaking bar (stop control) in both
  windows; hidden windows still speak, and completion notifications
  are unchanged. Explicit speaks — a "Speak reply" button on
  assistant replies (launcher done-state header + desktop message
  rows) and a "Speak selection" chip whenever text is selected in a
  window — bypass the auto-play toggle but still require the tts
  assignment; starting a new speak stops the current one.
- Local-docs index + `docs_search` (plan 12 §5): a granted folder can
  be opted into indexing (Settings → Tools → Document index) —
  markdown/text/PDF files are chunked into a `DocChunk` table mirrored
  into an external-content FTS5 virtual table via triggers (checkpointer
  precedent, raw-SQL bootstrap). Re-indexing is an mtime delta (edited
  files refresh, deleted files prune) and inherits the file tools'
  traversal rules (symlink-skip, junk prune, budgets). The read-only
  `docs_search` tool queries the index with sanitized prefix-term MATCH
  queries (FTS5 grammar cannot be injected) and returns bm25-ranked
  `path + snippet` passages. Embeddings stay deferred (D2).
- Command hotkeys (plan 12 §4 macro half): custom commands from
  Settings → Commands can be bound to spare global key combinations in
  Settings → Hotkeys. A bound command runs as a normal turn through the
  same command/policy path — approvals still apply — into a dedicated
  per-command conversation; results notify when windows are hidden.
  Bindings reject accelerators already taken (CommandOrControl-aware)
  and apply live on config save.
- Scheduled prompts (plan 12 §4): Settings → Automation lets you create
  schedules — every-N-minutes, daily-at, weekdays-at, or an advanced
  5-field cron — each with an explicit IANA timezone. A main-process
  scheduler (single timer wheel, injectable clock) fires prompts as
  normal assistant turns into a dedicated per-schedule conversation,
  runs once on boot when a run was missed (no catch-up burst), and
  queues behind an in-flight turn. DST boundaries are handled in the
  conversion math: fall-back overlaps fire on the first occurrence,
  spring-forward gaps fire at the shifted instant. The model cannot
  create or edit schedules (D4 — no schedule tools exist; a test pins
  it).
- File-artifact convention + renderer: tools that produce a file or
  folder append a machine-readable `[artifact]` marker line to their
  result; `TurnManager` extracts it main-side (never from model
  prose), persists it in the message metadata and ships it on the
  `finished` turn event. Both windows render animated artifact chips
  under the response — click opens the file via the new
  `system:open-path` IPC (exists + non-executable + files confined to
  granted roots, same rails as the `open_path` tool), folder icon
  reveals it in the file manager. `download_file` emits the marker.
- `download_file` tool (plan 12 §3 download loop): downloads a public
  http(s) file into a granted folder — optional destination path
  (editable on the approval card, missing path = first granted root +
  sanitized URL filename), collision-safe ` (2)` renaming, 50 MB cap
  (pre-checked via content-length, aborted mid-stream otherwise with
  partial-file cleanup), robots.txt respected, and an html
  content-type warning when the URL is a web page rather than a file.
- Live download progress: a main-process `DownloadTracker` mirrors
  byte progress onto the open `download_file` trace step over the
  turn envelope; both windows render an animated progress card
  (percent, speed, destination, cancel) reusing the shared motion
  tokens, and the cancel button aborts the transfer via the new
  `tools:cancel-download` IPC (partial file removed). Turn-level
  cancel aborts in-flight downloads too.
- Bind-time schema guard for Gemini: when the active provider is
  `google`, tool parameter schemas are scanned for keywords the native
  function-calling API rejects (`exclusiveMinimum`/`exclusiveMaximum`)
  and a warning names the offending tool + schema path — covers native
  zod tools and third-party MCP tools alike
  (`src/main/ai/tool-schema-guard.ts`).
### Changed
- `web_fetch` now shares the hardened SSRF guard with `download_file`
  (`src/main/ai/tools/net-guard.ts`): DNS-resolved pre-request checks
  (loopback/RFC1918/CGNAT/link-local/ULA/6to4 — not just literal
  hostnames), and redirects are followed manually so every hop is
  re-validated against the same rule (5-hop cap).
### Changed
- *(nothing yet)*
### Fixed
- `kill_process` tool schema no longer serializes as
  `exclusiveMinimum` (zod `.positive()` → `.min(1)`), which the Gemini
  native API rejected with a 400 "Unknown name" for the whole request.

## [v0.2.1] - 2026-09-10
### Added
- `.gitleaks.toml` allowlisting the two secrets-handling test fixtures,
  whose synthetic API keys (fake by design) tripped the default
  generic-api-key rule.
- Stable-name release download aliases (checksummed via
  `SHA256SUMS.txt`) so download links survive version bumps, plus
  `FUNDING.yml` (BMC-only).
### Changed
- README template rollout: direct download links, family wordmark
  colophon, community/security sections.
### Fixed
- Stable-name release aliases: globs now match electron-builder's raw
  space-bearing artifact names (dots only appear once action-gh-release
  sanitizes release asset names), unblocking the publish job.
