# Tools and approvals

The assistant can act on your computer through **tools**. Every tool
declares a risk class. By default (**Trusted workspace**) read-only and
built-in state-changing tools run without asking; clipboard reads and
destructive tools still confirm. This page explains what exists and how to
stay in control.

## Risk classes

| Class | Meaning | Default behavior |
|---|---|---|
| **read-only** | Observes, never changes anything | Runs silently |
| **state-changing** | Changes something on your machine | Runs by default (Trusted workspace); asks under Cautious / Fully manual |
| **destructive** | Can lose data or power down | Confirms **every single call** |

Destructive tools are locked: no setting and no grant can auto-approve
them.

## The native tool catalog

**Settings → Tools → Native tools** lists every built-in tool with its
description, parameters, risk class, and verification settings. Tools are
grouped by category: **Files**, **System**, **Desktop**, **Network**,
**Power**, **Integrations**, **Memory**.

Representative tools:

- **Files** — `list_dir`, `read_file`, `find_files`, `grep_files`,
  `file_create`, `file_write`, `file_move`, `file_delete`,
  `download_file`, `docs_search`
- **System** — `system_info`, `process_list`, `list_apps`,
  `kill_process`, `run_shell`, `datetime`
- **Desktop** — `screen_capture`, `recall_screenshot`, `window_list`,
  `active_window`, `clipboard_read`, `clipboard_write`, `media_controls`,
  `volume_set`, `brightness_set`, `notify`, `open_url`, `open_path`,
  `open_app`
- **Network** — `web_search`, `web_fetch`
- **Power** — `power` (lock, suspend, restart, shutdown)
- **Memory** — `memory_save`, `memory_list`, `memory_search`,
  `memory_forget`

### Files are confined to granted folders

File and shell tools may only touch folders you grant. Add one with
**Settings → Tools → Folders → Add folder** (an OS folder picker). Every
path is resolved against a granted root; traversal is rejected. If the
model tries a path outside your roots, the app raises an approval naming
the folder — you can allow it **once**, for **this session**, or
**always** (which adds it to granted roots).

### Shell guardrails

`run_shell` runs batch-only commands with a working directory confined to
granted folders, a scrubbed environment, a hard timeout, and output caps.

### Downloads

`download_file` saves into granted folders with a sanitized basename, a
` (2)` collision suffix, a size cap, robots.txt awareness, and SSRF
protection. A live progress card appears in both windows with a
**Cancel download** action; cancelling removes the partial file.

### File artifacts

Tools that produce files append an artifact marker; the finished turn
shows **Files from this turn** chips to **open** a file or **show it in
the folder**.

### Tool results

Every tool result is stored durably. Open the result viewer from a trace
step to see the full text, copy it, or view returned images (with zoom
and paging). Results survive restarts until age-pruned.

## Approvals

When a tool needs approval, a card appears in both windows:

- **Launcher** — a compact card in flow.
- **Desktop** — a rich card with **editable arguments** (edit the JSON
  before allowing).

Buttons: **Deny**, **Allow once**, **This session**, **Always**. A
destructive call shows "confirmed every time". An unanswered request
**auto-denies after 60 seconds**; cancelling a turn during an approval
counts as a denial. Resolution is idempotent across windows.

Everything is audited locally, including denials.

## Verification settings

Three layers decide when a tool asks.

### 1. Class defaults (presets)

**Settings → Tools → Default verification** sets the behavior for each
risk class. Presets:

| Preset | Behavior |
|---|---|
| **Cautious** | Read-only runs silently; state-changing tools ask until approved |
| **Trusted workspace** *(default)* | Built-in state-changing tools run without asking; clipboard reads and destructive actions still ask |
| **Fully manual** | Every call asks, including read-only |
| **Custom** | The defaults were changed by hand |

Class defaults apply to built-in tools only — MCP/app tools keep their own
settings. Destructive tools confirm every call regardless of preset.

### 2. Per-tool override

Open a tool's **Details** to set **Standard** (follow the class default),
**Always ask**, **Never ask**, or **Ask only when…** with rules on
arguments. You can also set an **always allow** grant, re-classify a risk
(MCP tools default to state-changing — only re-classify if you trust the
server), or disable the tool entirely.

### 3. Kill switches

- **Per-tool**: a disabled tool is never offered to the model.
- **MCP/app**: master, per-app and per-tool kill switches (see
  [tool apps](apps-and-mcp.md)).

## Usage dashboard

**Settings → Tools → Usage** renders the local tool audit: a 7/30/all
window, per-tool call counts, approval ratios, average durations, and
recent failures. Arguments are hashed, never stored. A per-app usage card
lives in the Apps tab.

## Memories manager

**Settings → Tools → Memories** lists stored memories with search, delete
and undo. See [memory](memory.md).

## Document index

**Settings → Tools → Folders** shows a document index section. Index a
granted folder so `docs_search` can find passages in its markdown, text
and PDF files. Indexing is local-only; see [memory](memory.md#document-search).
