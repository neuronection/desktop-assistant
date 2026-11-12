# Commands and the palette

The command palette replaces the old fixed slash commands with one
catalog-driven surface. The muscle memory is the same: type `/` in the
composer, or press `Ctrl+K` / `Cmd+K`.

## The palette

- Type `/` to open it, or `Ctrl+K` anywhere in the launcher or desktop
  window. The prefix keys below open it on their own too.
- With **nothing typed** the palette is a launch pad: **Pinned** first,
  then up to four **Suggested** commands, then up to three **Recently
  used** tools — only ones you ran in the last six hours, newest first.
  Stale tools are left out rather than padding the list. Below that, every
  command the app has is listed by category, so `/` alone is also a complete
  browser (the list scrolls inside the palette).
- Typed results are grouped across categories **Applications**, **Tools**,
  **Web**, **Navigation**, **Custom**, **Integrations**, with recently
  and frequently used rows ranked higher inside the same match tier.
- The highlighted row explains itself: the exact syntax
  (`/remember <content> [tags…]`), the full description, and every argument
  with its required/optional state, type, default and what it means.
- Keyboard navigation: `↑`/`↓`, `Enter` to run, `Tab` to complete, `Esc`
  to close. Hovering only highlights a row; **a single click selects** it
  (the help pane follows the selection) and **double-click or `Enter`
  runs** it. When a command still needs an argument, `Enter` inserts it
  into the composer instead of running — type the argument after it, then
  `Enter` again.
- Right-click a row to **Pin**, **Configure**, or **Disable** it.
- A live **calculator** is built in as a suggestion.

### Snippets

**Settings → Commands → Snippets** stores literal text expanders. Each has a
keyword, an optional title and a body; typing the keyword in the palette (or
`/keyword`) inserts the body into the composer instead of starting a turn.
Placeholders: `{date}` (local date), `{clipboard}` (current clipboard text) and
`{cursor}` (removed; the caret lands where it was, otherwise at the end). Snippets are local config,
not model prompts, and are not callable by the agent.

### Prefixes

One input box, four narrowing prefixes (the palette opens as soon as you
type one):

| Prefix | What it does | Example |
|---|---|---|
| `>` | Search commands only (applications are hidden) | `>set` |
| `@` | Search applications only | `@fig` |
| `=` | Calculate as you type; `Enter` opens the calculator pad | `=2+2*8` |
| `g ` | Search the web with the rest of the line | `g cats photos` |

A bare `g` stays prose; only `g ` followed by a space is the web prefix.

Free-text commands take the **whole rest of the line** as their argument
(`/web τεχνητή νοημοσύνη`, `/remember my deploy user is admin`). Their
optional settings are passed as **inline flags** — `/web my query
--maxResults 5`, `/remember my fact --tags work,life` — or left to the
command's default (the help pane shows it and links "Set defaults…" to
Settings → Commands). Unknown flags and invalid values stay part of the text,
so a query may safely contain dashes. Commands with an optional *path*
argument keep both forms (`/find *.md ~/docs` and `/find *.md --root ~/docs`).

Commands run through the same path as a normal turn, so approvals still
apply. If a turn is already running, the palette refuses to start another
and shows a notice.

## Built-in commands

| Command | What it does |
|---|---|
| `/screenshot` | Capture the screen (through the screen picker) |
| `/shell <command>` | Run a shell command through the guarded shell tool |
| `/open <url \| path \| app>` | Open a URL, file/folder, or application |
| `/calc <expression or conversion>` | Evaluate math or convert units |
| `/files <pattern>` | Find files in your granted folders |
| `/web <query>` | Web search — inline results or open in the browser |
| `/research <topic>` | Multi-step web research ending in a cited report |
| `/tr [language] <text>` | Translate (see [translation](translation.md)) |
| `/clear` | Clear the current conversation (asks first) |
| `/delete` | Delete the current conversation and start a fresh one (asks first) |
| `/export` | Save the current conversation as Markdown |
| `/duplicate` | Copy the current conversation and open the copy |
| Navigation | New conversation, expand/collapse, open desktop, settings, hide, quit |

### Calculator mini app

Run `/calc` with no expression (or pick the Calculator command) to take
over the launcher input with a live calculator: the result updates as you
type, `Enter` copies it, and `Esc` or `/exit` exits. A mode bar shows the
active mini app.

Unit conversions use `to`, `in`, `as` or an arrow:

```text
=10 km to mi          → 6.21371192237 mi
=72 f in c            → 22.2222222222 °C
=2 * 3 m -> ft        → 19.6850393701 ft
=1 gib to mib         → 1024 MiB
```

Length, mass, temperature, volume, data (decimal and binary), speed,
area, time and angle are covered. Currency conversion is not included —
rates would need a network fetch; use web search for a live quote.

### Research

`/research <topic>` runs a bounded flow: plan, then repeated
search → read → assess rounds (up to three rounds, two fetches per round),
then synthesize a cited report. Node steps are narrated live in the
launcher status line and the desktop flow card. Web reads inside the flow
follow the normal approval gates.

### Web search

`/web` uses your configured search providers in priority order (SearXNG,
Brave, Tavily, Exa, Serper, Google PSE). Two modes:

- **Inline results** — clickable markdown links in the transcript.
- **Open in browser** — opens the search in your default browser.

With no provider configured it falls back to opening an engine URL in the
browser.

## System verbs

The palette also exposes four local system actions. They run from the
launcher/desktop without a model turn and are never proposed by the model
(the trash asks first):

| Command | What it does |
|---|---|
| `/lock` | Lock the current session |
| `/sleep` | Put the computer to sleep |
| `/trash` | Empty the system trash (asks for confirmation first; macOS asks for Finder Automation access) |
| `/theme` | Toggle the classic and dark themes |

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
