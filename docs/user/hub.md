# The hub: dock, quick actions and Studio

The **hub** is the assistant's always-there edge: a dock tab (or card,
orb) that shows what is happening with speech, and a
quick-actions panel for the things you reach for most. Configure it in
**Settings → Hub**.

## The dock

Pick a shape in **Settings → Hub → Appearance**:

| Shape | What it is |
|---|---|
| **Card** | 400×72 now-playing pane with the current line and progress; it appears only while speech or live is active and fades when idle |
| **Edge** | A half-pill that hugs the left, right, top or bottom of the screen |
| **Dot** | A 28 px orb you can drop anywhere; hovering it opens a strip of glass action buttons |

Each shape has a role: the **edge** is the full hub, the **dot** is the
minimal always-there presence with quick actions, and the **card** is the
session surface — it shows while audio plays or a live session is running,
even when **Keep on screen** would pin the other shapes.

The edge is the hub dock. It is **30 px** compact, or one of three text
sizes: **Compact** (204 px face), **Comfort** (220 px, default) or
**Large** (240 px). The visible face has three modes: a slim control
strip when there is no text (the empty dock collapses to it), a
single-line state bar for **Listening…** or **Translating…**, and the
three-line face for real text. The window
envelope is derived from the size preset (240 × 97 at Comfort) and stays
fixed while text changes; the dock remains fully clickable (a
click-through toggle could strand it on X11).

### Text on the dock

**Text in the dock** shows the latest line inside the edge dock: the
current speech chunk, the live caption, a state line while audio is
preparing, or the latest hub result. Long lines clamp to three lines.

The dock sits above other windows, so text can appear in screen
recordings. If that matters, turn on **Hide the HUD from screen capture**
in Appearance — it also hides the dock from magnifiers.

### Controls

The dock's controls come from a shipped, state-based manifest, so each
mode shows exactly what applies:

- **Idle** — Quick actions (chevron), Open assistant, Dictate (mic) and
  the Live toggle.
- **Speech** — Quick actions, Pause/Resume and Stop.
- **Dictation** — Quick actions, Send and Stop, in the same rail.
- **Live** — Quick actions, Interrupt and End live.
- With desktop text selected or copied, **Translate** and **Speak**
  join the idle dock; during speech, dictation or live they step aside.

**Open assistant** shows the launcher in one click, without leaving the
knob. The mic button is the primary quick-question path. It records in
the HUD itself — the launcher never opens. **Send** transcribes and sends the
question to the assistant in the **Voice questions** conversation and
keeps the reply in the dock while speaking it; **Stop** discards the
recording. Dictation needs voice input enabled and a transcription model
assigned. Only state-essential controls appear, and only while they
apply: pause/stop are shown whenever audio is active — no hover-only
state. Every mode's controls form one continuous segmented rail fused
into the HUD border — the HUD hairline is the rail boundary — and the
outer border, not the text or buttons, carries the state color.

Drag the edge dock with the cursor. It slides along its current edge and,
when you bring the pointer close to another edge, previews and switches
to that edge. Only the central 80% of the target edge counts; corners are
ignored, and the switch needs a short dwell and a clear drag direction so
a passing cursor cannot move it. Release to save the side and position to
**Settings → Hub → Appearance**; press `Escape` during the drag to cancel.
The card is **clickable like the knob**: clicking the line pauses/resumes a
reply and interrupts live, while dragging it still moves the window (both
share the same custom drag seam as the knob and dot, with a corner snap on
drop). The card and orb remain freely draggable.

**Hide hub** empties the screen until you bring it back with **Show the
HUD** in the tray menu.

### Dot buttons

Hovering the dot opens a small strip of the same glass buttons the dock
uses, extending toward the screen center. The buttons are configured
separately in **Settings → Hub → Dot buttons** (Speak selection, Dictate,
Live — in the order you set). While dictating, the strip stays open with
**Send** and **Stop**, and the orb's ring carries the listening tint; the
click behavior for active sessions (stop a reply, interrupt or end live)
stays on the orb itself.

## Quick actions

Click the chevron, or right-click any HUD shape and choose **Quick
actions…**, to open the panel beside the dock. It is a separate, never
focusable window: it never steals your typing.

The same right-click menu opens **HUD settings** (size, dock text and
layout in one place), **Speech settings**, the **Look** and **Size**
presets, quick actions and **Keep on screen**.

Hovering the dock text reveals **Copy** for the displayed response.

The panel shows:

- Your **popover actions**, in the order you set. Translate/Speak appear
  only when text is selected. The defaults are Live → Translate selection
  → Speak selection → Dictate → Open assistant → Hide hub.
- Four actions per page with `‹ / ›` when the list needs more; the page
  resets when the available actions change.
- The latest **result** with **Copy**, **Open assistant** and **Retry**.

Translation reads the current selection in main, translates it through
the configured translation provider, and stays in the panel until you
dismiss it or run another action. The dock line shows the same result as
a preview and clears after **Hide results after** (10 s by default); the
panel keeps the full result.

Click the translated line in the dock (or **Open assistant** in the
result) to open the launcher with the translation selected in the
composer, ready to edit or send.

While a translation is running the dock says **Translating…** and the
border pulses in violet; the panel shows the same state with a spinner.
Text and buttons keep their normal colors. Live mode is just as explicit:
while the mic is listening the dock says **Listening…** and the outer
border brightens and expands with the mic volume, so silence and sound
are visibly different. **Working…**, **Preparing reply** and **Approval
needed** replace it through the rest of a live turn.

Actions that need a selection are disabled with a short explanation
until text is selected. Every action runs in the main process — the panel
never receives provider endpoints or keys.

## Studio

**Settings → Hub → Studio** chooses the look. A preset is a named set of
tokens and motion; it is not a script and cannot change what a click
does:

| Preset | Look |
|---|---|
| **Pulse** | Deep glass, hairline, state glow (the default) |
| **Aurora** | Animated gradient ring with a soft glow |
| **Minimal** | Quiet surface, no waveform, fewer effects |
| **Snake** | A bright segment circling the border |
| **Terminal** | Flat, monospaced, state-accent line |

**HUD size** is separate from the Studio look:

- **Compact / Comfort / Large** resize the dock, the square glass
  controls and the text together. Comfort is the default.
- **Custom** exposes dock width, control size and text size, then applies
  them once. The window is calculated from the content, so there is no
  separate height slider.

Studio also controls **Motion** — decorative motion on/off. Your OS
reduced-motion setting always wins.

The full per-style rule editor (typed conditions and effects) is a
follow-up; today the presets and these typed toggles are the whole
Studio vocabulary. Arbitrary scripts, CSS and window resizing are never
accepted. The launcher transcript's reply actions use the same square
glass language one step smaller, with a 24 px hit target.

## Limits and privacy

- The popover is a separate window; it does not resize the dock.
- Results are local until you copy or open them.
- Text on the dock is a preview, not a transcript archive.
- Quick actions are a curated list, not shell commands or app scripts.
