# Clipboard history

**Settings → Tools → Clipboard** is an opt-in text history. It is off until
you turn it on; enabling it is the consent step, and nothing is captured
before that.

## What it stores

- Plain text only (no images, files or rich formats), up to 100 kB per item.
- At most 200 unpinned entries, kept for 24 hours by default. Pinned
  entries stay until you unpin or delete them and are never auto-pruned, so a
  heavily pinned list can exceed the 200 mark.
- Entries are encrypted with your OS keyring before they reach SQLite; the
  database never holds the plaintext. If the keyring is unavailable, the
  history is **session-only** and disappears on quit — it is never written in
  plaintext.
- Nothing syncs, and there is no telemetry.

## What it ignores

Clipboard formats that applications mark as concealed, transient or
password-manager content are skipped where the platform exposes the hint
(macOS `ConcealedType`, Windows clipboard-history exclusions, KDE
`passwordManagerHint`). This is best-effort; a password manager that copies
without a hint can still be captured. Use **Pause capture** or turn the
feature off when that matters.

## Using it

- Search the history, **Copy** an entry back to the clipboard, **Pin** the
  ones you keep, or delete a single entry.
- **Clear history** removes every entry, including pins.
- **Pause capture** stops new captures without losing the list.
- Retention and the maximum entry count are editable.

The list lives in Settings for now. Palette rows, a dedicated hotkey and
per-app exclusions are later steps.
