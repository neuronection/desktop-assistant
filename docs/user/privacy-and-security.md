# Privacy and security

Desktop Assistant is local-first. There are no accounts and no telemetry.
The only traffic that leaves your machine is the AI calls you configure
yourself.

## Where your data lives

Everything is under Electron's `userData` directory. On Linux that is
typically `~/.config/<app-name>/`:

| File | Contents |
|---|---|
| `conversations.db` | SQLite: conversations, messages, audits, checkpoints, memories, schedules, command history, document chunks |
| `config.json` | App and provider configuration (no secrets) |
| `window-state.json` | Window geometry |
| `secrets.json` | Encrypted secret blobs (only when a keyring backend is available) |

Deleting the directory resets the app to first-run state.

## Secrets

Provider, speech, search, translation, MCP and decision API keys live only
in `SecretService` (Electron `safeStorage`), stored in an encrypted
`secrets.json` under `userData`. The config file carries only a masked
hint. Keys are resolved in the main process at call time and never cross
back to the renderer; they are never written to logs.

On Linux without a keyring backend the service fails closed: keys are
discarded and an error is logged, by design.

## The trust boundary

- **Renderer is untrusted.** The renderer never touches the OS, the
  database, or provider SDKs. A typed preload bridge is the only
  renderer→main channel.
- **Production renderer is sandboxed** with context isolation and a
  strict Content Security Policy.
- **No input injection.** Keystroke/SendInput/osascript injection is
  banned for UX conveniences. Selection capture is an opt-in, passive
  read of the X11 PRIMARY buffer on click — it never injects keystrokes
  and never touches your clipboard. Per-OS input automation exists only
  inside tools that declare it (for example media controls), behind
  verification.
- **MCP output is untrusted input.** Server tools are namespaced, default
  to the state-changing risk class (they always ask), and their results
  are treated as observations, never as instructions.
- **Filesystem confinement.** File and shell tools resolve every path
  against folders you granted; traversal is rejected.
- **SSRF protection.** Web fetch and download validate DNS-resolved
  targets and every redirect hop.

## Approvals are default-deny

Unanswered approval requests auto-deny after 60 seconds. Cancelling a turn
during an approval counts as a denial. Destructive tools confirm every
single call, with no setting to bypass it.

## Audit

Every AI call is recorded to the `ai_calls` table and every tool call to
`tool_calls` — arguments are hashed, never stored — with outcome,
duration and how it was approved. The Usage dashboard renders this data.
It never leaves your machine.

## What leaves your machine

Only the requests you cause:

- Chat/agent calls to the provider(s) you configured.
- Speech-to-text and text-to-speech calls to the assigned models.
- Search, translation, and decision-engine calls, when configured.
- MCP server calls, to the servers you added.
- With the **cloud decision engine** enabled, the command and candidate
  tool list are sent to the configured endpoint.
- With **Smart merge** enabled, memory text is sent to the assigned
  provider for dedupe arbitration.

Everything else — history, memory, audits, settings — stays local.
