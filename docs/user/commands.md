# Commands and the palette

The command palette replaces the old fixed slash commands with one
catalog-driven surface. The muscle memory is the same: type `/` in the
composer, or press `Ctrl+K` / `Cmd+K`.

## The palette

- Type `/` to open it, or `Ctrl+K` anywhere in the launcher or desktop
  window.
- Results are grouped: **Pinned**, **Recent**, **Suggested**, then
  **Results**, across categories **Applications**, **Tools**, **Web**,
  **Navigation**, **Custom**, **Integrations**.
- Keyboard navigation: `↑`/`↓`, `Enter` to run, `Tab` to complete, `Esc`
  to close.
- Right-click a row to **Pin**, **Configure**, or **Disable** it.
- A live **calculator** and the **clipboard** are built in as suggestions.

Commands run through the same path as a normal turn, so approvals still
apply. If a turn is already running, the palette refuses to start another
and shows a notice.

## Built-in commands

| Command | What it does |
|---|---|
| `/screenshot` | Capture the screen (through the screen picker) |
| `/shell <command>` | Run a shell command through the guarded shell tool |
| `/open <url \| path \| app>` | Open a URL, file/folder, or application |
| `/calc <expression>` | Evaluate a math expression |
| `/files <pattern>` | Find files in your granted folders |
| `/web <query>` | Web search — inline results or open in the browser |
| `/research <topic>` | Multi-step web research ending in a cited report |
| `/tr [language] <text>` | Translate (see [translation](translation.md)) |
| Navigation | New conversation, expand/collapse, open desktop, settings, hide, quit |

### Calculator mini app

Run `/calc` with no expression (or pick the Calculator command) to take
over the launcher input with a live calculator: the result updates as you
type, `Enter` copies it, and `Esc` or `/exit` exits. A mode bar shows the
active mini app.

### Research

`/research <topic>` runs a bounded flow: plan, then repeated
search → read → assess rounds (up to three rounds, two fetches per round),
then synthesize a cited report. Node steps are narrated live in the
launcher trace strip and the desktop flow card. Web reads inside the flow
follow the normal approval gates.

### Web search

`/web` uses your configured search providers in priority order (SearXNG,
Brave, Tavily, Exa, Serper, Google PSE). Two modes:

- **Inline results** — clickable markdown links in the transcript.
- **Open in browser** — opens the search in your default browser.

With no provider configured it falls back to opening an engine URL in the
browser.

## Custom commands

**Settings → Commands → My commands** lets you add two kinds:

- **Tool command** — wraps a native tool with argument templates. Use
  `{{1}}`, `{{2}}` … for palette arguments.
- **Prompt** — sends a prompt template as a normal turn.

Each custom command can have **aliases**, **argument defaults**, **extra
aliases**, be **pinned**, **hidden**, or marked **agent-invocable** (so
the assistant can call it as a tool). You can also create **instances** —
bound copies of a command with their own arguments and alias.

> Alias-less native tools are settings-only unless you give them an alias.

## Integration packs

**Settings → Commands → Integrations** imports a declarative
`integration.json` manifest. Packs can define HTTP, tool or prompt
commands, with `${secret:name}` header references whose values are stored
in the OS keyring (only the reference is kept in config). A pack that no
longer validates at boot self-disables with an error.

## Applications

**Settings → Commands → Applications** controls app discovery and
launching:

- **Allow app launching** — master switch for app entries (palette and
  agent).
- **Discover installed apps** — scans XDG/Flatpak/Snap, macOS bundles, or
  the Windows Start Menu.
- **Rescan apps**, hidden apps list, and **Restore**.
- Apps appear in the palette under **Applications**, with lazily loaded
  icons (monogram fallback).

## Command history

**Settings → Commands → History**:

- **Remember command usage** — enables the `CommandInvocation` log.
- **Keep history for N days** — retention.
- **Clear history** and a recent-commands list.

## Command hotkeys

Bind any custom command to a spare global key combination in
**Settings → Hotkeys → Command Hotkeys**. The command runs as a normal
turn, in its own dedicated conversation, with all approvals intact. See
[automation](automation.md#command-hotkeys).
