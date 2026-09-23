# Automation

Two features run work without you typing in the launcher: **scheduled
prompts** and **command hotkeys**.

## Scheduled prompts

**Settings → Automation** creates prompts that run on a rhythm in their
own conversation. Only you can create or edit them — the assistant has no
schedule tools.

Create a schedule with **New schedule**:

| Field | Notes |
|---|---|
| **Name** | e.g. "Morning briefing" |
| **Prompt** | What the assistant should do each time it fires |
| **Rhythm** | Every N minutes, Daily at a time, Weekdays at a time, or Advanced cron |
| **Timezone** | An explicit IANA zone |

Advanced cron uses the 5-field form `minute hour day month weekday`,
evaluated in the selected timezone.

Scheduling is DST-safe: in a fall-back hour the first occurrence wins; in
a spring-forward gap the instant is shifted.

Each schedule gets its own conversation. The list shows:

- an **Enabled** switch,
- the **next run** ("in 2 h 15 min"),
- the **last run** outcome,
- **Run now** (queued behind the current turn if one is busy),
- **Delete**.

Overdue schedules fire once, not in a burst. A manual run is queued rather
than interrupting a turn.

## Command hotkeys

Bind a custom command to a spare global key combination in
**Settings → Hotkeys → Command Hotkeys**.

- The recorder is collision-aware: a combination already assigned is
  rejected.
- The command runs as a normal turn — approvals still apply.
- Each command hotkey gets its own dedicated conversation, created on
  first run and reused.

Create the commands themselves in **Settings → Commands → My commands**
(see [commands](commands.md#custom-commands)).

## Notifications

With **Settings → General → Notify when a turn finishes in the
background** enabled, finished background turns raise a notification. In
launcher mode, notifications appear as an in-flow banner; in desktop and
settings windows they appear as toasts. Clicking a notification opens the
relevant card or window.
