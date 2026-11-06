# The launcher and desktop windows

Desktop Assistant has two windows built from one codebase. You can move a
live turn between them at any point, even mid-response.

## The launcher

The launcher is the compact overlay summoned by the global hotkey. It is
frameless and rounded, always on top by default, and only a few pixels
tall until there is something to show.

### The launcher state machine

A turn moves through visible states:

| State | What you see |
|---|---|
| **Idle** | Just the composer, with a placeholder and a first-run hint |
| **Queued** | The turn is waiting behind another turn |
| **Thinking** | A persistent status line: phase, elapsed time and step count |
| **Working** | The latest tool step appears on the same line |
| **Streaming** | The reply streams token by token; a stop button replaces send |
| **Done** | The finished reply, with the status line becoming its compact trace row |

The **status line** stays in the same place above the composer through
thinking, streaming and done, so finishing a reply does not add or remove
a row. The step count opens the full list on demand; when a turn is
resumed after an approval, the replayed step carries a small **resumed**
badge instead of duplicating a row.

While a reply streams, paragraph wrapping already matches the finished
markdown — a single newline in the model text does not become a visible
line break. Code and math blocks keep their whitespace while streaming.
The reply card keeps **Speak reply**, **Open desktop mode** and **Expand**
in a small header row above the text, so the actions stay visible without
covering what you are reading.

A slim line above the composer tells you where you are: **New chat**
when the conversation is empty, otherwise the message count (for
example `14 messages`) — and the line itself is a button: clicking it
expands to the full window, doing the same thing as the **Expand**
action (`Ctrl+E`). After a turn
finishes, the model name, elapsed time
and tool count join the same line, so the whole context fits in one
row. Next to the count sits a **+** button that starts a
fresh conversation without opening the ⋯ menu.

Turn the detailed timeline on in **Settings → General → Show turn trace
details** to see expandable step timelines (including tool calls) under
assistant replies in every window. Even with details off, the model ·
time row under a reply is a toggle: click it to unfold that turn's
trace timeline in place (desktop window, expanded launcher, and the
compact context line); turns without tools or decision steps keep the
plain badge. That row is the **single** toggle — the timeline opens
with its steps already listed, so there is no second collapse level.

### Growing and resizing

The window measures its content and grows or shrinks automatically. A
streaming reply grows it in measured steps without resizing the native
window on every frame, and it settles back down after the reply is
complete — so the launcher stays smooth instead of flickering. Each new
reply starts from the compact panel height, even when the previous reply
was long. When a reply is too long for the compact panel, the existing
**Expand** icon in
the reply header gets an accent highlight instead of switching to the
full conversation view while you are reading. Expanding starts at the
beginning of the latest reply, not at the beginning of the whole
conversation. The composer caps
its own height and scrolls internally. You can also resize the launcher
manually with the invisible handles in the bottom-left and bottom-right
corners; a manual resize suspends the auto-fit until the next message or
dismissal.

### The launcher menu

The **⋯** button opens the launcher menu:

- **New conversation**
- **Expand** (`Ctrl+E`)
- **Open desktop mode** (`Ctrl+D`)
- **History** — recent conversations, with a count; pick one to reopen
  it expanded or in the desktop window
- **Recent speech** — this session's spoken utterances with one-click
  replay
- **Settings**
- **Shortcuts** (`Ctrl+/`) — every accelerator in one sheet: general and
  voice chords, the fixed in-window keys, and command hotkeys (an
  unbound action shows **Not Set**), with a **Customize in Settings**
  shortcut
- **Hide to tray** — hides the window; it keeps running in the tray
  (the global hotkey brings it back)
- **About**
- **Support this project**

### The Escape ladder

`Escape` does the most local thing first:

1. If the **Shortcuts** sheet is open, close it (the launcher stays).
2. If a **mini app** (calculator, translate pad) is open, exit it.
3. If the launcher is **expanded**, collapse it back to compact.
4. Otherwise, **hide** the window to the tray.

While voice input is active, `Escape` does not hide the window.

### Hide on blur

With **Settings → General → Hide the launcher when it loses focus**
enabled, clicking elsewhere hides the launcher. Native file dialogs are
skipped so that attaching files still works.

## The desktop window

Press `Ctrl+D` in the launcher (or choose **Open desktop mode**) for the
full window.

- **Session sidebar** — your conversations, docked on the left.
- **Full-height transcript** — the whole conversation with markdown,
  code, math and diagrams.
- **Drag and drop** — drop files anywhere to attach them.
- **Inspector** — a right-hand panel with:
  - the live or persisted **trace timeline**, with step details,
  - **turn metadata** (model, token counts, durations),
  - the last message's **attachments**,
  - a searchable **tool catalog**,
  - a per-conversation **model override** and **persona**,
  - a per-conversation **Speak replies** toggle ("Speak all replies in
    this conversation"),
  - **export** to Markdown or JSON.
- **Remembered geometry** — window bounds and maximized state persist;
  the window **hides instead of closing**.

In the desktop window the header carries the window controls. The
expanded launcher's header (also the drag handle) carries **Hide to
tray**; there is no composer dropdown: **launcher mode** and
**desktop mode** are icon actions in the panel header. The launcher
has no minimize — a minimize request (even from the taskbar's window
menu) hides the window to the tray instead.

## Handoff between windows

- **Launcher → desktop**: `Ctrl+D` opens the desktop window synced to the
  active conversation. Streaming continues there.
- **Desktop → launcher**: choose **Open launcher mode** in the desktop
  header. The launcher opens on the same conversation, in compact or
  expanded mode.

Approvals resolve from either window; the second window's answer is
ignored (resolution is idempotent).

## Window behavior

- **Always on top** — the launcher pins above other windows by default.
- **Transparent window (glass corners)** — a product trait. On
  Cinnamon/Mint a transparent always-on-top window may fail to render; if
  the window disappears, untick **Settings → General → Transparent
  window** from the tray menu.
- **Frameless + rounded** — the window is drag-movable from empty areas;
  controls opt out of dragging.
- **Residency** — autostart is per-OS: an XDG autostart file on Linux, a
  login item on Windows/macOS.

## Keyboard shortcuts

Global (configurable in **Settings → Hotkeys**):

| Default | Action |
|---|---|
| `Control+Space` | Summon/hide the launcher |
| `Ctrl+,` / `Cmd+,` | Open Settings |
| — (unassigned) | Start voice recording |
| — (unassigned) | Expand/collapse the launcher |
| — (unassigned) | Open desktop mode |
| — (unassigned) | Open the command palette |

In-window:

| Shortcut | Action |
|---|---|
| `Enter` | Send |
| `Shift+Enter` | New line |
| `Ctrl+E` / `Cmd+E` | Expand/collapse the transcript (launcher) |
| `Ctrl+D` / `Cmd+D` | Open desktop mode |
| `Ctrl+K` / `Cmd+K` | Open the command palette |
| `Ctrl+/` / `Cmd+/` | Open the shortcuts sheet |
| `Escape` | Escape ladder (see above) |
| Hold `Control` | Push-to-talk while the launcher is focused (voice enabled) |

Plus any **command hotkeys** you bind in **Settings → Hotkeys**.
