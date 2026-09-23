# Getting started

## 1. Install

Download the installer for your platform from the
[latest release](https://github.com/neuronection/desktop-assistant/releases/latest):

| Platform | File |
|---|---|
| Windows | `Desktop-Assistant-windows-setup.exe` |
| Linux (AppImage) | `Desktop-Assistant-linux.AppImage` |
| Linux (deb) | `Desktop-Assistant-linux.deb` |
| macOS (Intel) | `Desktop-Assistant-macos.dmg` |
| macOS (Apple Silicon) | `Desktop-Assistant-macos-arm64.dmg` |

Verify downloads against the `SHA256SUMS.txt` published with each release.

Desktop Assistant is beta software. Expect rough edges, and keep an eye on
[STATUS.md](../STATUS.md) for what is verified and what is not.

## 2. First run

The app starts in the system tray and does not open a window immediately.
Look for the tray icon:

- **Linux / Windows** — the tray/notification area.
- **macOS** — the menu bar.

If you enabled "Launch on system startup", the app starts hidden in the
tray (on macOS the window opens at login instead). You can turn autostart
off in **Settings → General**.

## 3. Connect an AI provider

Chat needs at least one AI model. The fastest path:

1. Open **Settings** — from the tray menu, or press the
   **Open Settings** hotkey (default `Ctrl+,` / `Cmd+,`).
2. Go to the **API Settings** tab. A **Set up AI** card appears on first
   run (it is also offered from the chat empty state and the tray menu).
3. Pick a provider card — OpenAI, Google Gemini, OpenRouter, Anthropic,
   Groq, Mistral, DeepSeek, or local **Ollama** (detected automatically
   when it is running).
4. Paste your API key and press **Set up automatically**. The key is
   validated against the vendor, the curated models are added, and the
   default text, vision and transcription models are bound.

Your API key is stored in your operating system's keyring (via Electron
`safeStorage`), never in a config file. If a Linux session has no keyring
backend, the app fails closed: the key is discarded and an error is
logged, by design.

You can also add any OpenAI-compatible endpoint by hand: choose the
**Custom / manual** card, or **Add provider** in the API tab, and fill in
the base URL and key. Providers whose models have not been fetched yet
appear with **Refresh Models**.

**No provider yet?** The launcher still works — slash commands and
built-ins run without a model — but chat answers need one.

## 4. Summon the assistant

Press the global hotkey (default **`Control+Space`**) from any
application. The launcher appears. Type a question and press Enter. The
window stays only a few pixels tall until the answer starts streaming,
then grows as far as it needs.

Useful first moves:

- Press `Ctrl+E` to expand the full transcript in place.
- Press `Ctrl+D` to continue in the desktop window.
- Press `Ctrl+K` to open the command palette.
- Type `/` to see slash commands.

Press `Escape` to collapse a response, then `Escape` again to hide the
window to the tray.

## 5. Make it yours

A short tour of the settings tabs:

- **General** — theme, autostart, which window the summon hotkey opens,
  transparency, memory/app context toggles.
- **API Settings** — providers, models, and which model serves each task
  (chat, vision, titles, transcription, speech, translation, decisions).
- **Voice** — dictation and spoken replies.
- **Tools** — native tools, granted folders, memories, usage, web search,
  translation and decisions.
- **MCP servers** — MCP server connections and reviewed integration presets.
- **Commands** — the palette, app discovery, web search, custom commands.
- **Hotkeys** — every global shortcut, including command hotkeys.
- **Automation** — scheduled prompts.
- **About** — version and project links.

See the [settings reference](settings.md) for every option.

## Next steps

- [Chat and attachments](chat-and-attachments.md) — get the most out of a turn
- [Tools and approvals](tools-and-approvals.md) — what the assistant can do, and how it asks
- [Voice](voice.md) — dictate and have replies read aloud
- [Privacy and security](privacy-and-security.md) — where everything lives
