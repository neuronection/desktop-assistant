# Security Policy

## Reporting a vulnerability

Report privately via GitHub Security Advisories on this repository. Do not
open a public issue for security reports. You can expect an initial
response within 7 days.

## Scope

- The Electron application (main process, preload, renderer)
- Packaged builds (AppImage, deb, NSIS, DMG)
- Build and release pipelines

## Baseline (enforced in CI where possible)

- Secrets never committed; `.env` gitignored; `.env.example` value-free.
- Provider API keys: OS-protected storage only (Electron `safeStorage`
  via `src/main/services/SecretService.ts`); encrypted at rest, never in
  `config.json`, the database, logs, or the renderer. Fails closed when
  the OS backend is unavailable.
- Renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
  sandboxed in production; the preload bridge is the only IPC surface;
  popups and out-of-origin navigation are denied; CSP on both entries.
- AI model output is untrusted input: sanitized before rendering
  (DOMPurify over all markdown).
- Dependencies: Dependabot; lockfiles committed.

## Threat model

Desktop Assistant is the family's **local product** (identity class L,
ADR-0013): the OS user is the identity — no accounts, no user tables,
no auth UI, no token minting, no sessions, and **no profiles, ever**
(identity-auth §3; adding any of these requires a new family ADR).
The §20 skeleton therefore collapses to the rows that still mean
something for an Electron app; the answers below are the repo's source
of truth and pair with [docs/dev/security-model.md](docs/dev/security-model.md).

| Surface | Answers for this repo |
|---|---|
| Auth surface | **None.** No login/register routes, no cookies, no tokens, no local HTTP listener — the renderer is loaded from bundled files and speaks only IPC. The OS login is the authentication; the OS user's file permissions are the access control. |
| Instance mode | **N/A.** No DB-stored modes and no `auth_mode`/`demo_mode` facts exist to change or restore. The only opt-in is the content-only demo launch (`--demo`, below) — a pure launch flag, never persisted state. |
| Session storage | **N/A.** No sessions, cookies, or refresh tokens exist. There is nothing to revoke besides quitting the app. |
| Trust boundaries | **Renderer ↔ main/IPC (ADR-0010/0011):** renderer processes are untrusted — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in production (`src/shared/constants/window.ts`); the preload bridge (`src/preload/preload.ts`) is the only channel, exposing a typed, enumerated API (`window.electronAPI`) with no raw channel strings and no ad-hoc channels (registry: [docs/dev/ipc.md](docs/dev/ipc.md)); handlers validate inputs and accept no arbitrary renderer paths without a dialog round-trip; popups are denied, out-of-origin navigation blocked, and both HTML entries carry a strict CSP meta (dev-only relaxation for HMR; production ships the strict policy). **User ↔ agent tools (ADR-0011):** model output is untrusted input (markdown sanitized with DOMPurify before rendering); tool execution is gated by the policy engine — risk classes, grants, kill switch, per-class defaults; file/shell tools resolve every path against granted roots and reject traversal; approvals default to deny after 60 s and resolve idempotently; `web_fetch`/`download_file` pass the SSRF guard (DNS-resolved targets + every redirect hop); MCP server tools are namespaced, default state-changing, and their output is treated as observation, never instruction; keystroke/SendInput automation is banned (the X11 selection-capture convenience is opt-in and passively reads the PRIMARY buffer). |
| Data isolation | Everything is local files under the OS user's `userData` dir (overridable via `DESKTOP_ASSISTANT_DATA_DIR`): the SQLite store (`conversations.db`), `config.json`, tool results, secrets — no accounts, no profiles, no tenants; the OS user *is* the isolation boundary, and a second OS user gets a second, separate workspace. |
| Secrets at rest | Provider/search/MCP keys live only in `SecretService` — Electron `safeStorage` (DPAPI / Keychain / libsecret) with encrypted blobs in `secrets.json` under `userData`; `config.json` and the database carry only a masked `apiKeyHint`. The renderer may **write** a key but never **read** one back (AI/STT calls run in main, so no secret crosses into the untrusted process). Without an OS backend the service fails closed: new keys are discarded with an error, never written in plaintext. A disk thief with the OS account gets the encrypted blobs behind the OS login; without it, `secrets.json` ciphertext is inert. |
| Audit | Local-only operational audit: every AI call is recorded (`AiCall` — task, provider, model, outcome, tokens, duration) and every tool call (`ToolCall` — tool, hashed args, outcome, approver); tool arguments are hashed, never stored. Audit data never leaves the machine. There is no identity/admin audit because there are no identity/admin actions. |
| Admin surface | **None.** Whoever can run the app owns it — there is no elevation, no roles, nothing to become admin *of*. The policy engine's grants and the keyring are the only "privilege", both editable only from the app's own settings UI by the OS user. |
| Deployment exposure | A local desktop app, not a server: no inbound network surface, outbound only to the AI/search/MCP endpoints the user configures. Distribution is packaged builds (AppImage, deb, NSIS, DMG) and their build/release pipelines — report packaging and update-path issues. **Demo mode is content-only** (identity-auth §13, Class L): launching with `--demo` redirects the entire workspace into an isolated `demo/` subdir of `userData` (`app.setPath('userData', …)` before any service resolves paths) and idempotently seeds a few sample conversations (`src/main/demo.ts`) — the user's real `conversations.db`, `config.json`, and `secrets.json` are never touched, and no users, profiles, or login concepts are involved (the schema has none). Removing the `demo/` dir resets it. |

## Supported versions

The latest `main` and the most recent release tag receive security fixes.
