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
| **Text** | Text chats in both windows |
| **Vision** | Turns carrying images or screenshots (falls back to text) |
| **Conversation titles** | Auto-titling after the first exchange |
| **Transcription** | Dictation; voice input is off until assigned |
| **Voice post-processing** | One call per phrase: completeness + cleanup; powers auto-send |
| **Speech** | Reading finished replies aloud |
| **Internal plumbing** | Cheap helper for internal calls; falls back to chat |
| **Translation (LLM engine)** | The LLM translation engine; never falls back to chat |
| **Decision** + **Decision kinds** | Fast non-chat decisions (tool dispatch, gates, choice, score) — the Decision default plus one slot per kind, assigned from transport-declaring models in [Decision models](decision-models.md) |

The chat model also answers for unassigned tasks (except translation).

## Voice

See [voice](voice.md) for the full picture. The tab has four sub-tabs:

- **Input** — the assigned transcription and post-processing models, then
  the input settings (enable, language, live transcript, phrase pause,
  send every, mic gain, auto-send with its judge selector, fix text,
  formatting, custom instructions, attach context).
- **Replies** — the spoken-reply settings (**Speak replies**, **Speak
  when I ask in my message**) and the assigned speech model.
- **Live** — barge-in on speakers, ignored-utterance hints, the live
  phrase pause, the idle timeout, the spoken-reply limit and the session
  turn limit.
- **Selection speech** — the audio cache (toggle, usage, **Clear
  cache**), the HUD posture and corner, HUD content protection, speaking
  speed (disabled with a reason for Gemini-flavoured speech models, which
  ignore it) and the maximum selection length. See
  [speech from your desktop](voice.md#speech-from-your-desktop-selection-speech).

Each sub-tab ends with its assigned task model and a **Configure models**
link into the API tab.

## Hub

Appearance and behavior of the always-available HUD (the edge dock, card,
mini bar and orb). See [the hub](hub.md) for the full picture.

- **Appearance** — HUD shape (card, edge or dot), dock side, the
  dock-text options, and **Hide the HUD from screen capture**.
- **Studio** — the Pulse, Aurora, Minimal, Snake and Terminal presets plus
  the Motion toggle. Presets change tokens only, never behavior.
- **HUD size** — Compact, Comfort (default) and Large, or **Custom**
  face width/control size/text size applied once.
- **Quick actions** — the popover action list and its ordering.
- **Dot buttons** — the dot orb's hover actions (Speak selection, Dictate,
  Live) and their order; shown while the dot is the active shape.
- **Results** — how long a result preview stays on the dock.

The HUD's right-click menu mirrors the useful parts: **HUD settings**
(this tab), **Speech settings** (Voice tab), the same Look/Size presets,
quick actions, hide and keep-on-screen.

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
- **Web search** — search-provider cards (SearXNG, Brave, Tavily, Exa,
  Serper, Google PSE) in the AI-providers pattern: priority badges mark
  the fallback order, every management action (enable/disable, reorder,
  test, edit, delete) lives in each card's `⋯` menu, **Add provider**
  runs a choose-a-provider → configure wizard, and the catalog (key and
  base-URL rules per type) comes from the family contract. Keys live in
  the keyring.
- **Translation** — engine mode, default target, custom languages, and
  service providers in the AI-providers pattern (engine cards with a `⋯`
  management menu, an engine-tiles → settings wizard, and a detail-page
  editor; the catalog — key and base-URL rules per engine — comes from
  `translation-catalog.ts`). See [translation](translation.md).
- **Decisions** — behavior only: confidence thresholds, then scope, route
  tools, custom rules, extra prompt, and the test runner, plus a deep-link
  card into API settings where decision models are assigned. See
  [decisions](decisions.md).

## Integrations

**Integrations** is the umbrella for everything the assistant can invoke
at run time:

- **MCP apps** — the app list with status, search and filters, and an
  **Add app** catalog (bundled preset or custom MCP server). Each row has
  Edit, Test, and Remove; the settings section below it holds the master
  switch, tool budget, matching help and the per-app usage card.
- **Packs** — mini-app packs and their Sources block.
- **Commands** — the palette, applications, web search, history,
  integrations and **My commands**.

App details keep the **Connection**, **Tools** and **Scope** sub-tabs,
the icon picker and standing directives.

See [tool apps and MCP](apps-and-mcp.md) and [commands](commands.md).

## Hotkeys

- **Editable hotkeys** — summon/hide, open settings, start voice
  recording, expand/collapse, open desktop, open command palette,
  **Start Live Conversation** (default `Ctrl/Cmd+Alt+Space`), and
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

### Updates

The update channel (stable or beta) and a manual "Check for updates"
button. Checks run against the family version API on neuronection.com —
a plain, anonymous GET of static release metadata (no install ID, no
usage reporting). Stable tracks official releases only; beta offers
release candidates as they ship. Applying an update is always explicit:
AppImage installs update in place (download, then restart-to-update);
Windows, macOS and deb installs download the official installer
(checksum-verified), open it, and you click through the familiar wizard.
Nothing runs without your explicit consent.
