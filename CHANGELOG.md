# Changelog

All notable changes to this project are documented here. User-visible
changes land under `## [Unreleased]` in the same commit that introduces
them.

## [Unreleased]
### Added
- Bind-time schema guard for Gemini: when the active provider is
  `google`, tool parameter schemas are scanned for keywords the native
  function-calling API rejects (`exclusiveMinimum`/`exclusiveMaximum`)
  and a warning names the offending tool + schema path — covers native
  zod tools and third-party MCP tools alike
  (`src/main/ai/tool-schema-guard.ts`).
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
