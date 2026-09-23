# Troubleshooting

## The hotkey does nothing

Another application may have registered the same global shortcut.
Registration failures are soft and logged. Change the combination in
**Settings → Hotkeys**.

## The window is invisible (Linux, Cinnamon/Mint)

A transparent always-on-top frameless window can fail to render on
Cinnamon/Mint. If the window disappears, untick **Settings → General →
Transparent window** from the tray menu.

## Chat says no model is configured

Chat needs at least one provider. Open **Settings → API Settings** and
complete the **Set up AI** card. Slash commands and built-ins still work
without a model.

## A turn fails or shows an error

Real provider, network and tool errors stay loud (unlike budget limits,
which produce a partial answer with an amber notice). Check:

- The provider key is valid and the account has credit/quota.
- The model id still exists on the vendor side.
- Your network can reach the provider's base URL.

Keys live in the OS keyring. On Linux without a keyring backend the app
fails closed and discards keys — assign the provider again from a session
with a keyring available.

## The assistant misreads screenshots or images

Screenshot and image results reach the model as images and need a
vision-capable backend. Assign a **Default vision model** in **Settings →
API Settings → Tasks**. Models without tool-calling fall back to plain
streaming chat automatically.

## A tool never runs

- The tool may be **disabled** — check **Settings → Tools → Native tools**
  (kill switch) or the app's per-tool toggle.
- It may need a **granted folder** — file and shell tools only touch
  folders you add in **Settings → Tools → Folders**.
- It may be waiting for approval and the card **auto-denied after 60
  seconds**. Re-run and answer in time.
- For MCP/app tools, the server may be unreachable — see below.

## Approval cards keep appearing

That is the policy working. Read-only tools run silently and built-in
state-changing tools run under the default **Trusted workspace** preset;
clipboard reads and destructive tools confirm every call. To ask before
changes, set **Settings → Tools → Default verification** to **Cautious**
or **Fully manual**, or grant a tool **Always allow** in its details.

## Voice input does not work

- Voice input is off until a model is assigned to **Transcription (voice
  input)**.
- Enable **Settings → Voice → Enable voice input**.
- If auto-detect wobbles, pin a **Transcription language**.

## Phrases are never committed

Raise **Mic gain**, or set **Send every** so the transcript commits after
a fixed amount of speech even without a pause.

## Auto-send does not fire

Auto-send needs the **Voice post-processing** model assigned and **Auto-
send completed phrases** enabled. It is deliberately fail-closed: any
error, timeout or low confidence means the transcript is not sent.

## Spoken replies are silent

Assign a model to **Speech (TTS)**, and either enable **Speak replies** or
ask in your message (with **Speak when I ask in my message** on). Voice
and speed come from the assigned model.

## `/tr` reports that something is missing

Translation needs either a configured service or the **Translation (LLM
engine)** task assigned, matching the **Engine mode**. The error names
exactly what is missing.

## The decision engine never fires

Nothing is in scope until you select apps or enable built-in tools in
**Settings → Tools → Decisions → Scope & routing**. With an empty scope
the engine idles. Also check the confidence thresholds.

## An app shows Unavailable or Error

The MCP server may be down or unreachable. Use **Test connection** in the
app's card. Tool snapshots refresh automatically when stale.

## Where are my files, and how do I reset?

Everything lives in the app's `userData` directory (Linux:
`~/.config/<app-name>/`): `conversations.db`, `config.json`,
`window-state.json`, and `secrets.json` when a keyring is available.
Deleting the directory resets the app to first-run state. See
[privacy and security](privacy-and-security.md).

## Reporting a bug

Open an issue at
[github.com/neuronection/desktop-assistant/issues](https://github.com/neuronection/desktop-assistant/issues).
Include your OS, the app version (**Settings → About**), what you did,
what you expected, and what happened. Do not paste API keys or secret
values.
