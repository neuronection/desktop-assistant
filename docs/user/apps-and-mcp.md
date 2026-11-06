# MCP servers

**MCP servers** bring external tools into the assistant through the Model
Context Protocol (MCP). Once connected, their tools join the agent with
the same approval gates as native tools.

Manage them in **Settings → MCP servers**.

## Adding an app

**Add app** offers two paths:

- **From preset** — bundled, reviewed integrations: **Home Assistant**,
  **GitHub**, **Google Calendar**, **Obsidian**, **Notion** and
  **Spotify**.
- **Custom MCP server** — connect any MCP-compatible server yourself.

A **master switch** disables all apps at once; disabled apps never bind to
the agent or the palette.

## Connection types

| Transport | Fields |
|---|---|
| **stdio (local command)** | Command, arguments, environment JSON |
| **HTTP (streamable)** | Server URL, optional bearer token |
| **SSE** | Server URL, optional bearer token |

Advanced server options: environment and headers as JSON, a tool
allowlist (comma-separated, empty = all tools), a tool timeout, and a max
concurrent-calls cap.

Secrets — env values, headers, bearer tokens — are stored in the OS
keyring, never in the config file. The UI shows secret key names only.
Removing an app removes its keyring entries too.

### The Home Assistant preset

The preset pre-fills the endpoint and ships authored risk mappings,
keyword tags, usage guidance and a permission preview. You supply the Home
Assistant URL and a long-lived access token. Its tools are handled by the
app (never by shell commands), and its device scope is enforced as
described below.

### GitHub

- **Endpoint**: stdio, `npx -y @modelcontextprotocol/server-github`.
- **Auth**: a GitHub personal access token with repo + read:org scopes;
  stored in the OS keyring and passed as
  `GITHUB_PERSONAL_ACCESS_TOKEN`.
- **Scoping**: no stable entity id, so writes rely on approval. Search,
  files, commits, issues and PRs are read-only; create issue/comment/PR
  always ask.
- **Try**: "Summarize the open PRs in neuronection/desktop-assistant",
  "What changed in the last five commits?", "Open an issue for the flaky
  test."

### Google Calendar

- **Endpoint**: stdio, `npx -y @modelcontextprotocol/server-google-calendar`.
- **Auth**: an OAuth refresh token; stored in the OS keyring and passed as
  `GOOGLE_OAUTH_REFRESH_TOKEN`.
- **Scoping**: reads are read-only; create/move events ask for approval.
  Deletes are not exposed by this preset.
- **Try**: "What's on my calendar tomorrow?", "Move the 3pm sync to 4pm",
  "Create a 30-minute review event on Friday."

### Obsidian

- **Endpoint**: the Local REST API community plugin, default
  `https://127.0.0.1:27124/mcp/`.
- **Auth**: the plugin API key; stored in the OS keyring as a bearer
  token.
- **Scoping**: note paths are the entity. Use the app's Scope tab (for
  example `allow journal/*`) to bound writes; create/append still ask.
- **Try**: "What did I write in my journal last week?", "Append this idea
  to journal/today", "Search my vault for the deployment checklist."

### Notion

- **Endpoint**: stdio, `npx -y @notionhq/notion-mcp-server`.
- **Auth**: a Notion internal integration token; stored in the OS keyring
  and passed as `NOTION_API_TOKEN`.
- **Scoping**: share only the pages/databases the integration should see —
  that is the scoping surface. Block updates append rather than rewrite.
- **Try**: "Find the Q3 planning page", "What's in the reading list
  database?", "Append these notes to the meeting page."

### Spotify

- **Endpoint**: stdio, `npx -y @modelcontextprotocol/server-spotify`.
- **Auth**: a Spotify refresh token; stored in the OS keyring and passed
  as `SPOTIFY_REFRESH_TOKEN`.
- **Scoping**: catalog reads are read-only; play/pause/queue ask for
  approval. Native media controls still handle this machine's playback.
- **Try**: "Find the new album by …", "Queue three jazz tracks", "What's
  playing right now?"

## Health and testing

Each app card shows a health chip — **Healthy**, **Unavailable**,
**Error**, or **Disabled**. **Test connection** forces a connection and
reports latency and tool count. Tool snapshots refresh automatically when
stale.

## Curating tools

The app's **Edit → Tools** tab lists every tool it exposes. Per tool you
can:

- **Enable/disable** it,
- set **keyword tags** (used by app matching),
- set a **risk override** — *tighten-only*: you can make a tool stricter,
  never looser than its default,
- see the server-provided description.

Changes apply immediately; no save needed. A **new** badge marks tools
seen for the first time.

## Exposure

Per app, choose how its tools reach the model:

| Exposure | Meaning |
|---|---|
| **Always available** | Bound every turn |
| **When relevant to the message** | Bound when keyword matching finds the app relevant |
| **Deferred behind provider tool search** | Bound only on models with server-side tool search (Claude Sonnet 4+/Opus 4+/Haiku 4.5+, or gpt-5.4+ on OpenAI). Budget-exempt |

App matching compares English keywords in your message against tool tags,
tool names and the app name — mention the app by name to use it. A **Tool
budget** warns above a total number of agent tools across all apps; over
budget, apps are dropped per the exposure order until the toolset fits.

## Device scope

For MCP-backed apps, **Edit → Scope** defines ordered **allow/deny
rules** over entity ids, as globs (`light.*`, `lock.*`, `*.`). Last match
wins. **Preview against discovered devices** shows which devices are
allowed or blocked before you save.

Scope is enforced at the app bridge: an action tool's entity argument is
validated against the rules, and discovery results are filtered. A
guessed or out-of-scope entity is refused locally.

## Standing directives

**Edit → Connection → Standing directives** are always injected while the
app is enabled — for example, "For all Home Assistant tools use the app
tools — never shell commands." Capped and fenced.

## Live context

With **Settings → General → Let apps provide live context** on, enabled
apps publish a compact cached digest (for example, your Home Assistant
device list) that is injected into prompts so commands skip discovery and
memory lookups. The Apps tab shows entity counts and digest age. The
digest is also used to ground the decision engine's entity arguments (see
[decisions](decisions.md)).

## App usage

A per-app usage card aggregates the local tool audit per app, over the
same 7/30/all window as the native usage dashboard.
