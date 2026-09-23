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
| **Thinking** | A trace strip: phase, elapsed time, step chips |
| **Working** | Tool steps appear as the agent acts, each with a compact chip |
| **Streaming** | The reply streams token by token; a stop button replaces send |
| **Done** | The finished reply, with action buttons and a compact trace row |

The **trace strip** shows every thinking, tool and streaming step as a
chip. When a turn is resumed after an approval, the replayed step carries
a small **resumed** badge instead of duplicating a row.

Turn the detailed timeline on in **Settings → General → Show turn trace
details** to see expandable step timelines (including tool calls) under
assistant replies in every window.

### Growing and resizing

The window measures its content and grows or shrinks automatically. The
composer caps its own height and scrolls internally. You can also resize
the launcher manually with the invisible handles in the bottom-left and
bottom-right corners; a manual resize suspends the auto-fit until the
next message or dismissal.

### The launcher menu

The **⋯** button opens the launcher menu:

- **New conversation**
- **Expand** (`Ctrl+E`)
- **Open desktop mode** (`Ctrl+D`)
- **History** — recent conversations, with a count; pick one to reopen
  it expanded or in the desktop window
- **Settings**
- **About**
- **Support this project**

### The Escape ladder

`Escape` does the most local thing first:

1. If a **mini app** (calculator, translate pad) is open, exit it.
2. If the launcher is **expanded**, collapse it back to compact.
3. Otherwise, **hide** the window to the tray.

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

In the desktop window the header carries the window controls. There is no
composer dropdown: **launcher mode** and **desktop mode** are icon
actions in the panel header, which is also the drag handle.

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
| `Escape` | Escape ladder (see above) |
| Hold `Control` | Push-to-talk while the launcher is focused (voice enabled) |

Plus any **command hotkeys** you bind in **Settings → Hotkeys**.
