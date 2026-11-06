# Notifications

Desktop Assistant records background outcomes as **notifications** so a
toast you miss is never lost. Everything lives on this computer — the
content is never sent anywhere.

## Where the inbox lives

**Settings → Notifications** lists every recorded outcome, newest first.
Each row shows a severity chip (Info, Success, Warning, Error), the
title, the body, how many times the same event repeated (`3×`), and when
it happened.

- **Unread filter** — switch between *All* and *Unread*.
- **Mark read** — clears the unread mark on one row; **Mark all read**
  clears them all.
- **Clear all** — removes the whole inbox history (asks first).

Background outcomes that land here include scheduled prompts finishing,
mini-app assessment runs settling, downloads completing, memory
consolidation, and anything the assistant sends with the `notify` tool.

## Click routing

A notification can carry one **closed** action. Clicking it routes
through the same rails the rest of the app uses — never a raw link:

| Action | What clicking does |
|---|---|
| **Open conversation** | Opens the desktop window on that conversation |
| **Open settings** | Opens Settings at the relevant section |
| **Open report** | Opens the mini-app run report in Integrations |
| **Open file** | Opens the file with the default app — only if it exists, is not executable, and sits inside a folder you granted |
| **None** | No button; the row is informational only |

The tray and the inbox share this one router, so a click behaves the same
from either place. Opening a notification marks it read.

## Tray badge

The tray icon shows the count of **unread Warning/Error** notifications
(Info and Success never badge). What each platform can actually render:

| Platform | Badge |
|---|---|
| **macOS** | The unread count appears beside the tray icon (a real badge). |
| **Windows** | No tray badge exists; the count rides the tray tooltip. |
| **Linux** | No tray badge exists; the count rides the tray tooltip. |

The badge clears as soon as you read or clear the warn/error rows.

## Not an approval surface

Notifications are **informational only**. Anything that needs a decision
— running a tool, moving files — still raises an approval card in a
window. Nothing is ever approved from a notification (family ADR-0015).

## Privacy

Notification content stays in the local database, pruned on the normal
retention schedule (default 30 days). It is never sent to a model or a
server. See [Privacy and security](privacy-and-security.md).
