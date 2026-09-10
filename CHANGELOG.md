# Changelog

All notable changes to this project are documented here. User-visible
changes land under `## [Unreleased]` in the same commit that introduces
them.

## [Unreleased]
### Added
- *(nothing yet)*
### Changed
- *(nothing yet)*
### Fixed
- *(nothing yet)*

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
