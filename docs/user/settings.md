# Settings reference

Open Settings from the tray menu, the **⋯ → Settings** launcher menu, the
`Ctrl+,` / `Cmd+,` hotkey, or the palette. The window is organised into
tabs; every sub-navigation is a segmented tab control.

Global actions at the bottom: **Reset Defaults**, **Export Config**,
**Import Config**, and **Save Changes**. Export writes a JSON file;
import overwrites your settings after a confirmation.

## General

| Setting | Default | What it does |
|---|---|---|
| **Theme** | Classic | The app theme |
| **Launch Desktop Assistant on system startup** | Off | Starts hidden in the tray on Windows/Linux; on macOS the window opens at login. Unavailable in dev builds |
| **Open on summon** | Launcher window | Which window the global summon hotkey opens (Launcher or Desktop) |
| **Auto-expand the launcher when a response overflows** | On | Grows the launcher past compact when the answer is long |
| **Notify when a turn finishes in the background** | On | Notification when a background turn completes |
| **Hide the launcher when it loses focus** | Off | Hides on blur; skips native file dialogs so attaching still works |
| **Transparent window (glass corners)** | On | Applies immediately. On Cinnamon/Mint a transparent always-on-top window may fail to render |
| **Show turn trace details** | Off | Detailed step timelines with tool calls under replies (all windows) |
| **Auto-scroll to the latest message** | Off | Keep streaming replies pinned to the newest message |
| **Let the assistant use memory** | On | Recall memories at turn start and allow saving new ones |
| **Let apps provide live context** | On | Inject a cached digest of enabled apps and authored skills into prompts |
| **Offer clipboard on summon** | Off | Offer a chip if the clipboard changed; nothing is read unless you click |
| **Show "insert selection" button** | Off | Adds an "insert my selection" button (X11 Linux only) |

## API Settings

Three sub-tabs: **Providers**, **Models**, **Tasks**.

### Providers

- A **Set up AI** card on first run (also reachable from the chat empty
  state and the tray menu) walks through connecting a provider with your
  own API key.
- **Add provider** opens the same wizard. A **Custom / manual** card
  covers any OpenAI-compatible endpoint.
- Each provider row has a **Test** connection action, a masked key hint,
  and a **Set up automatically** action that re-runs the wizard (with an
  editable review of what will change).
- Keys live in the OS keyring; the config stores only a masked hint.

### Models

Register models per provider — pull the remote catalog or add entries
manually. Per model you can set a **label**, **temperature**, **max
tokens**, and **capabilities** (Text, Vision, Tools, Transcription,
Speech, Embeddings). Capabilities gate which tasks a model can be assigned
to. Reasoning models expose a **Reasoning effort** control.

### Tasks

Choose which model serves each AI task:

| Task | Used for |
|---|---|
| **Default text model** | Text chats in both windows |
| **Default vision model** | Turns carrying images or screenshots (falls back to text) |
| **Conversation titles** | Auto-titling after the first exchange |
| **Transcription (voice input)** | Dictation; voice input is off until assigned |
| **Voice post-processing** | One call per phrase: completeness + cleanup; powers auto-send |
| **Speech (TTS)** | Reading finished replies aloud |
| **Internal plumbing** | Cheap helper for internal calls; falls back to chat |
| **Decisions (intent)** | The decision engine's structured-output model |
| **Translation (LLM engine)** | The LLM translation engine; never falls back to chat |

The chat model also answers for unassigned tasks (except translation).

## Voice

See [voice](voice.md) for the full picture. The tab has two sub-tabs:

- **Input** — the assigned transcription and post-processing models, then
  the input settings (enable, language, live transcript, phrase pause,
  send every, mic gain, auto-send with its judge selector, fix text,
  formatting, custom instructions, attach context).
- **Replies** — the spoken-reply settings (**Speak replies**, **Speak
  when I ask in my message**) and the assigned speech model.

Each sub-tab ends with its assigned task model and a **Configure models**
link into the API tab.

## Tools

Segmented sections: **Tools**, **Folders**, **Memories**, **Usage**,
**Web search**, **Translation**, **Decisions**.

- **Tools** — class-level **Default verification** with presets
  (Cautious, Trusted workspace *(default)*, Fully manual), then the native
  tool catalog with search, category and risk/status filters, and per-tool
  details. See [tools and approvals](tools-and-approvals.md).
- **Folders** — granted folders, the document index, and the folder
  picker.
- **Memories** — the memory manager and smart-merge controls. See
  [memory](memory.md).
- **Usage** — the tool audit dashboard.
- **Web search** — ordered search-provider instances (SearXNG, Brave,
  Tavily, Exa, Serper, Google PSE) with priority, enable toggles, timeouts
  and tests. Keys live in the keyring.
- **Translation** — engine mode, default target, custom languages, and
  service providers. See [translation](translation.md).
- **Decisions** — the engine (selector, readiness, confidence thresholds
  and engine-specific configuration grouped in one **Engine** card), then
  scope, route tools, custom rules, extra prompt, and the test runner. See
  [decisions](decisions.md).

## Apps (AI tools)

The Apps tab has **Apps** and **Settings** views.

- **Apps** — the app list with health chips, search and filters, and an
  **Add app** flow (preset or custom MCP server). Each card has Edit,
  Test, and Remove.
- **App details** — sub-tabs **Connection**, **Tools**, **Scope**, plus
  icon picker and standing directives.
- **Settings** — the master switch, tool budget, matching help, and the
  per-app usage card.

See [tool apps and MCP](apps-and-mcp.md).

## Commands

Cards for the palette, applications, web search, history, integrations,
and **My commands**. See [commands](commands.md).

## Hotkeys

- **Editable hotkeys** — summon/hide, open settings, start voice
  recording, expand/collapse, open desktop, open command palette, and
  **Stop Speaking / Interrupt** (default `Ctrl/Cmd+Shift+Space`; stops a
  spoken reply, then ends live mode — see
  [voice](voice.md#live-conversation-hands-free)).
- **Fixed hotkeys** — shown for reference.
- **Command hotkeys** — bind custom commands. See
  [automation](automation.md#command-hotkeys).

## Automation

Scheduled prompts. See [automation](automation.md).

## About

Version, creator, and project links.
