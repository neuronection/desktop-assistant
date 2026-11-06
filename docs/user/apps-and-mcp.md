# MCP servers

**MCP servers** bring external tools into the assistant through the Model
Context Protocol (MCP). Once connected, their tools join the agent with
the same approval gates as native tools.

Manage them in **Settings → Integrations → MCP apps**.

## Adding an app

**Add app** offers two paths:

- **From preset** — bundled, reviewed integrations: **Home Assistant**,
  **GitHub**, **Google Calendar**, **Obsidian**, **Notion**, **Spotify**,
  **Nextcloud**, **Jellyfin**, **qBittorrent**, **Pi-hole**, **Frigate**,
  **Slack**, **Discord**, **GitLab**, **PostgreSQL insights**,
  **Prometheus**, **Todoist** and **Browser pilot**.
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

### Nextcloud

- **Endpoint**: HTTP, your Nextcloud MCP endpoint (default
  `https://cloud.example.com/mcp`).
- **Auth**: a Nextcloud app password; stored in the OS keyring as a
  bearer token.
- **Scoping**: paths are entities. Reads are read-only; uploads and
  folder creation ask for approval. Deletes are not exposed.
- **Try**: "List my Documents folder", "Search Nextcloud for the budget
  sheet", "Upload this draft to /Documents."

### Jellyfin

- **Endpoint**: HTTP, your Jellyfin MCP endpoint.
- **Auth**: a Jellyfin API key; stored in the OS keyring as a bearer
  token.
- **Scoping**: library/media reads are read-only; marking played or
  unplayed asks for approval. Deletes and library administration are not
  exposed.
- **Try**: "What movies are in my library?", "Find the latest sci-fi
  series", "Mark that episode as played."

### qBittorrent

- **Endpoint**: HTTP, your qBittorrent MCP endpoint.
- **Auth**: the Web UI token; stored in the OS keyring as a bearer token.
- **Scoping**: torrent status and transfer reads are read-only;
  add/pause/resume ask for approval. Deletion is not exposed.
- **Try**: "What's downloading right now?", "Pause the Ubuntu ISO",
  "Add this magnet link."

### Pi-hole

- **Endpoint**: HTTP, your Pi-hole MCP endpoint.
- **Auth**: a Pi-hole app password; stored in the OS keyring as a bearer
  token.
- **Scoping**: stats and query logs are read-only. Enabling or disabling
  blocking is the approval showcase — **every call asks**, with no
  standing grant.
- **Try**: "How many queries were blocked today?", "Show recent DNS
  queries", "Disable blocking for five minutes."

### Frigate

- **Endpoint**: HTTP, your Frigate MCP endpoint.
- **Auth**: a Frigate API key; stored in the OS keyring as a bearer
  token.
- **Scoping**: camera/event reads are read-only. `get_snapshot` returns
  image content — the host routes it through the **vision** task, so a
  vision-capable model must be assigned. No camera or recording changes
  are exposed.
- **Try**: "List my cameras", "What happened at the driveway today?",
  "Show me the latest snapshot from the front door."

### Slack

- **Endpoint**: stdio, `npx -y @modelcontextprotocol/server-slack`.
- **Auth**: a Slack bot token; stored in the OS keyring as
  `SLACK_BOT_TOKEN`.
- **Scoping**: channel reads and search are read-only; `post_message`
  asks for approval on every call.
- **Try**: "Search Slack for the release thread", "What happened in
  #general today?", "Post this update to #team."

### Discord

- **Endpoint**: stdio, `npx -y @modelcontextprotocol/server-discord`.
- **Auth**: a Discord bot token; stored in the OS keyring as
  `DISCORD_BOT_TOKEN`.
- **Scoping**: reads and search are read-only; `send_message` asks for
  approval.
- **Try**: "List my guilds", "What's in #dev today?", "Send this note to
  #ops."

### GitLab

- **Endpoint**: stdio, `npx -y @modelcontextprotocol/server-gitlab`.
- **Auth**: a GitLab personal access token; stored in the OS keyring as
  `GITLAB_PERSONAL_ACCESS_TOKEN`.
- **Scoping**: project/file/issue/MR reads are read-only;
  `create_issue`/`add_comment` ask for approval. Deletes are not
  exposed.
- **Try**: "Search GitLab for the API project", "List open issues",
  "Open an issue for the flaky pipeline."

### PostgreSQL insights

- **Endpoint**: stdio, `npx -y @modelcontextprotocol/server-postgres`.
- **Auth**: a read-only connection string; stored in the OS keyring as
  `POSTGRES_CONNECTION_STRING`.
- **Scoping**: **the role is the scope.** Every exposed tool is
  SELECT/schema-read only; no writes, DDL or destructive SQL.
- **Try**: "List the schemas", "Describe the orders table", "How many
  rows are in users?"

### Prometheus

- **Endpoint**: HTTP, your Prometheus MCP endpoint.
- **Auth**: an API token; stored in the OS keyring as a bearer token.
- **Scoping**: instant/range queries, alerts and targets are read-only.
- **Try**: "What's the request rate right now?", "Show firing alerts",
  "Which targets are down?"

### Todoist

- **Endpoint**: stdio, `npx -y @modelcontextprotocol/server-todoist`.
- **Auth**: a Todoist API token; stored in the OS keyring as
  `TODOIST_API_TOKEN`.
- **Scoping**: project/task reads and search are read-only;
  `create_task`/`complete_task` ask for approval. Deletes are not
  exposed.
- **Try**: "What's due today?", "Find the shopping list tasks", "Add a
  task to call the dentist."

### Browser pilot

- **Endpoint**: stdio, `npx -y @modelcontextprotocol/server-playwright`.
- **Auth**: none — a local Playwright browser.
- **Scoping**: `snapshot`/`get_text`/`get_url`/`screenshot` are
  read-only; `navigate`/`click`/`fill`/`type`/`press` are
  **state-changing and ask for approval on every call**. The preset
  exposes no destructive tool. Use a disposable profile and do not sign
  in to accounts you would not want an approval card to reach.
- **Try**: "Open example.com and summarize it", "Fill the search box",
  "Take a screenshot of the current page."

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

When an **embedding model is assigned** on the API settings tab, matching
apps are also ranked by meaning before the budget drop, so the app that
fits your message best is the one that stays. Leave the embedding task
unassigned to keep the plain keyword order.

## Device scope

For MCP-backed apps, **Edit → Scope** defines ordered **allow/deny
rules** over entity ids, as globs (`light.*`, `lock.*`, `*.`). Last match
wins. **Preview against discovered devices** shows which devices are
allowed or blocked before you save.

Scope is enforced at the app bridge: an action tool's entity argument is
validated against the rules, and discovery results are filtered. A
guessed or out-of-scope entity is refused locally.

## Resources and prompts

A well-behaved MCP server can also offer **resources** (documents, schemas,
tickets) and **prompt templates** (for example "summarize PR"). Open an
app's **Edit** dialog and use the **Resources** and **Prompts** tabs to see
what it offers.

- **Resources** are listed read-only. To let the assistant read them,
  turn on **Expose resources to the assistant** (off by default). When on,
  the model can read one resource at a time through the bounded
  `mcp_resource` tool — a single read per resource, capped at the byte
  budget (8 KB by default). Reads are logged like tool calls; the content
  itself is never written to the audit log.
- **Prompts** become palette rows under **Integrations**. Picking one asks
  for its arguments, expands the template into a normal message, and sends
  it as a regular turn. The full expanded text is what gets sent — the
  template is never injected raw.

**Server content is untrusted.** Resource text and prompt templates come
from an external server: they are shown for reference and treated like any
other external text, never executed. A prompt template cannot smuggle a
tool action past approval — if the expanded message asks the assistant to
act, that action goes through the normal approval flow.

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
