# Changelog

All notable changes to this project are documented here. User-visible
changes land under `## [Unreleased]` in the same commit that introduces
them.

## [Unreleased]
### Added
- Scheduled prompts (plan 12 §4): Settings → Automation lets you create
  schedules — every-N-minutes, daily-at, weekdays-at, or an advanced
  5-field cron — each with an explicit IANA timezone. A main-process
  scheduler (single timer wheel, injectable clock) fires prompts as
  normal assistant turns into a dedicated per-schedule conversation,
  runs once on boot when a run was missed (no catch-up burst), and
  queues behind an in-flight turn. DST boundaries are handled in the
  conversion math: fall-back overlaps fire on the first occurrence,
  spring-forward gaps fire at the shifted instant. The model cannot
  create or edit schedules (D4 — no schedule tools exist; a test pins
  it).
- File-artifact convention + renderer: tools that produce a file or
  folder append a machine-readable `[artifact]` marker line to their
  result; `TurnManager` extracts it main-side (never from model
  prose), persists it in the message metadata and ships it on the
  `finished` turn event. Both windows render animated artifact chips
  under the response — click opens the file via the new
  `system:open-path` IPC (exists + non-executable + files confined to
  granted roots, same rails as the `open_path` tool), folder icon
  reveals it in the file manager. `download_file` emits the marker.
- `download_file` tool (plan 12 §3 download loop): downloads a public
  http(s) file into a granted folder — optional destination path
  (editable on the approval card, missing path = first granted root +
  sanitized URL filename), collision-safe ` (2)` renaming, 50 MB cap
  (pre-checked via content-length, aborted mid-stream otherwise with
  partial-file cleanup), robots.txt respected, and an html
  content-type warning when the URL is a web page rather than a file.
- Live download progress: a main-process `DownloadTracker` mirrors
  byte progress onto the open `download_file` trace step over the
  turn envelope; both windows render an animated progress card
  (percent, speed, destination, cancel) reusing the shared motion
  tokens, and the cancel button aborts the transfer via the new
  `tools:cancel-download` IPC (partial file removed). Turn-level
  cancel aborts in-flight downloads too.
- Bind-time schema guard for Gemini: when the active provider is
  `google`, tool parameter schemas are scanned for keywords the native
  function-calling API rejects (`exclusiveMinimum`/`exclusiveMaximum`)
  and a warning names the offending tool + schema path — covers native
  zod tools and third-party MCP tools alike
  (`src/main/ai/tool-schema-guard.ts`).
### Changed
- `web_fetch` now shares the hardened SSRF guard with `download_file`
  (`src/main/ai/tools/net-guard.ts`): DNS-resolved pre-request checks
  (loopback/RFC1918/CGNAT/link-local/ULA/6to4 — not just literal
  hostnames), and redirects are followed manually so every hop is
  re-validated against the same rule (5-hop cap).
### Changed
- *(nothing yet)*
### Fixed
- `kill_process` tool schema no longer serializes as
  `exclusiveMinimum` (zod `.positive()` → `.min(1)`), which the Gemini
  native API rejected with a 400 "Unknown name" for the whole request.

## [v0.2.1] - 2026-09-10
### Added
- `.gitleaks.toml` allowlisting the two secrets-handling test fixtures,
  whose synthetic API keys (fake by design) tripped the default
  generic-api-key rule.
- Stable-name release download aliases (checksummed via
  `SHA256SUMS.txt`) so download links survive version bumps, plus
  `FUNDING.yml` (BMC-only).
### Changed
- README template rollout: direct download links, family wordmark
  colophon, community/security sections.
### Fixed
- Stable-name release aliases: globs now match electron-builder's raw
  space-bearing artifact names (dots only appear once action-gh-release
  sanitizes release asset names), unblocking the publish job.
