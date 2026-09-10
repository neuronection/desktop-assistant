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

## Supported versions

The latest `main` and the most recent release tag receive security fixes.
