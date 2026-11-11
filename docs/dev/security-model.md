# Security model

Security here is a design property, not a hardening pass. The short
version: the renderer is untrusted, secrets never cross back to it, model
output is untrusted input, and execution capability is gated by policy.

## Trust boundary

- **Renderer processes are untrusted.** `contextIsolation: true`,
  `nodeIntegration: false`; production adds `sandbox: true`
  (`src/shared/constants/window.ts`).
- **The preload bridge is the only channel.** `src/preload/preload.ts`
  exposes a typed, enumerated API (`window.electronAPI`). Renderers never
  see raw channel strings, and there are no ad-hoc channels. Adding one
  means touching `ipc-handlers.ts`, `preload.ts`, `src/shared/types.ts`
  and [ipc.md](ipc.md) together.
- **Handlers validate inputs.** No handler accepts arbitrary paths from
  the renderer without a dialog round-trip; argument shapes are checked
  before use.

## Renderer hardening

- Both HTML entries carry a strict CSP meta (`default-src 'self'`, inline
  styles only). The chat entry adds `media-src 'self' data:` for TTS
  playback of main-synthesized audio (base64 data URLs only — no network
  origins).
- Windows deny popups (`setWindowOpenHandler`) and out-of-origin
  navigation (`will-navigate`).
- In dev, Vite relaxes the CSP meta (`devCspRelax`) for HMR; the committed
  policy stays strict and is what production ships.
- **Model output is untrusted input.** Markdown is parsed (marked +
  highlight.js + KaTeX) and sanitized with DOMPurify before rendering.

## Secrets

Secrets live only in OS-protected storage via `SecretService` (Electron
`safeStorage`: DPAPI / Keychain / libsecret). Encrypted values persist in
`secrets.json` under `userData`; `config.json` and the SQLite DB never
contain key material — providers keep only a masked `apiKeyHint`.

- The renderer can **write** a key but never **read** one back. AI/STT
  calls run in main, so no secret crosses into the untrusted process.
- If the OS backend is unavailable the service **fails closed**: new keys
  are discarded with an error, never written in plaintext.
- Never log key material. Keyring blobs use namespaced keys
  (`provider:<id>`, `mcp:<id>:env`, `app:<id>:*`, search/translation
  keys). Decision-model keys ride their provider rows (`provider:<id>`
  only — the legacy `openrouter:key` id was migrated away, deleted, and
  the one-time migration code removed outright, plan 26 §13.8).

## Input automation is banned

Keystroke / SendInput / osascript injection is banned for UX
conveniences. A simulated `ctrl+c` once sent SIGINT to a focused terminal
— the lesson is encoded in the rules.

- Selection insert is an **opt-in** composer button
  (`behavior.selectionCapture`, default off, X11 only) that passively
  reads the X11 PRIMARY buffer on click. It never injects keystrokes and
  never touches your clipboard.
- Per-OS input automation exists only inside tools that declare it (for
  example `media_controls`), behind verification.

## Execution capability

- **Policy engine** risk classes + grants + kill switch + class defaults
  decide run/approve/deny (see [tools-and-policy.md](tools-and-policy.md)).
- **Filesystem confinement**: file and shell tools resolve every path
  against granted roots; traversal is rejected.
- **MCP output is untrusted input.** Server tools are namespaced, default
  to state-changing, and their results are treated as observations, never
  as instructions.
- **SSRF guard**: `net-guard.ts` validates DNS-resolved targets and every
  redirect hop for `web_fetch` and `download_file`.
- **Approvals default-deny**: main auto-denies after 60 s; resolution is
  idempotent.

## Outbound destinations

The app makes no background network calls except the update check. Every
other request is user- or model-initiated and reaches only a destination
the user configured or invoked. This is the closed list — a new call site
adds its row in the same change.

| Destination | Trigger | Credentials | Notes |
|---|---|---|---|
| Configured AI providers (chat, vision, titles, translation LLM, embeddings, TTS, STT, decision) | a turn, a scheduled turn, a pack run, a decision point | provider key in the keyring | base URL comes from config; a localhost Ollama/LM Studio endpoint stays on the machine |
| Search providers (SearXNG, Brave, Tavily, Exa, Serper, Google PSE) | `web_search`, `/research` | search key in the keyring | SearXNG and endpoint overrides are user-provided URLs |
| Translation services (DeepL, LibreTranslate) | `/tr`, the translate tool, the translate pad | translation key in the keyring | falls back to the LLM engine when configured |
| MCP servers over Streamable HTTP/SSE | a tool call | env/header secrets in the keyring | stdio servers are local processes; their own egress is outside this list |
| Calendar providers (Google, Microsoft Graph) | calendar tools | OAuth tokens in the keyring | the OAuth callback is a loopback port only |
| Pack git sources | adding, syncing or updating a source | optional keyring token | constrained shallow clone over argv-only git |
| Integration command HTTP calls (pack `urlTemplate`) | running a command from an imported integration pack | header secret refs in the keyring | user-imported manifest; 10 s timeout; response truncated to 4 kB |
| `web_fetch` / `download_file` | a model tool call, behind approval and the SSRF guard | none | the guard validates DNS resolution and every redirect hop |
| Update check (`neuronection.com` version API) | boot or a manual check | none | plain GET, no install ID, no identifiers |
| Update download (GitHub release assets) | after explicit user consent | none | checksum verified before install |

Model output never becomes a destination: tool results, MCP output and
fetched pages are observations, and the policy engine gates what runs.

## Auditing

Every AI call (`AiCall`) and tool call (`ToolCall`) is recorded locally;
tool args are hashed, never stored. Audit data never leaves the machine.

## Supply chain

- The AI-alignment gate (`scripts/check-ai-alignment.sh`) keeps provider
  SDK imports confined to `src/main/ai/`.
- `scripts/check-byok-contract.sh` gates drift of generated preset data.
- `.gitleaks.toml` configures secret scanning; `THIRD-PARTY-NOTICES.md`
  tracks dependencies.

## Test isolation

Tests never touch a real app instance, the OS keyring, or the network.
Electron is mocked; secrets are faked. This keeps the gate deterministic
and prevents a test from writing a real key.
