# AGENTS.md — Desktop Assistant

Desktop AI assistant (Electron) that lives in the system tray and is
summoned from anywhere via a global hotkey: streaming chat, voice input,
attachments (PDF, screen capture), local conversation history (SQLite).
Part of the Neuronection assistant family.

**Identity class L** (family ADR-0013): the OS user is the identity —
**no accounts, no user tables, no auth UI, and no profiles, ever**
(adding such concepts requires a new family ADR). Demo mode is
content-only: sample conversations seeded into an isolated data dir —
never demo users, never demo profiles.

## Non-negotiable rules

1. **Never commit untested code.** Run the verification gate (below)
   before every commit.
2. **Every unit of work updates documentation** in the same commit
   (`docs/`, `CHANGELOG.md` under `## [Unreleased]`).
3. **No comments in code** unless requested. Mimic existing style.
4. **Never commit secrets**: `.env` is gitignored, `.env.example`
   documents variables value-free.
5. **Never push to a remote unless explicitly asked.**
6. **Canonical architecture and behavior live in the tracked `docs/`.**
7. **A shipped feature updates `docs/capabilities.json`** (family
   contract: `contracts/product-capabilities.schema.json`) in the same
   change.

## Repo map

```
src/
├── main/           Electron main process (the backend layer)
│   ├── DesktopAssistant.ts   orchestrator
│   ├── window.ts / tray.ts   frameless overlay + settings windows, tray
│   ├── ipc-handlers.ts       the IPC surface (only path renderer → main)
│   ├── db/         schema boot (fresh = schema.sql + user_version; existing
│   │                head only), runtime PRAGMAs, retention prune
│   ├── ai/         LangChain gateway, agent graph, decision registry,
│   │                tools (native/MCP), STT/TTS/catalog exceptions
│   ├── apps/       mini-app packs: registry, composition, runner, run
│   │                stores, capabilities, windows, sources (git/local),
│   │                sandbox (T2 utilityProcess seam), docs
│   └── services/   Config, Database (open/boot/lifecycle), Conversation,
│                   Message, Schedule, Memory, Command, Attachment, STT,
│                   Hotkey, Residency (per-OS autostart)
├── preload/        contextBridge API exposed to renderer (preload.ts)
├── managers/ → renderer/managers/  app glue reused by both UIs
│   (ConversationManager, RecordingManager, ThemeManager)
├── renderer/       four entries, React 19 + Tailwind v4 +
│   │               @neuronection/assistant-ui:
│   ├── index.html + chat-react/       launcher + desktop chat
│   ├── settings.html + settings-react/  settings window
│   ├── pack-window.html + pack-window-react/  constrained pack window
│   ├── result-viewer.html + result-viewer-react/  tool-result viewer
│   └── styles/     shared styles (tailwind entries + theme)
└── shared/         types, config + schema envelopes, constants;
                    app-pack/ = mini-app pack SDK (pure: validator,
                    builders, generated contract vocabularies)
prisma/             schema (generated client in src/generated/, ignored)
contracts/          vendored family contracts (extension charter/schemas,
                    mini-app pack contract + manifest schema, fixtures)
docs/               tracked documentation — docs/user/ + docs/dev/ (incl.
                    the chaptered docs/dev/sdk/ pack-authoring set) with
                    docs-tree.json as the navigation source of truth
scripts/            maintenance scripts; scripts/app-pack/ = the pack CLI
```

## Build & test

```bash
./scripts/run-dev.sh      # bootstrap + dev group (vite + tsc watch + electron)
npm run verify            # prisma generate + lint + typecheck + named contract gates + vitest + conformance + build
```

Tests live in `tests/` (Vitest; jsdom via per-file pragma where a DOM is
needed). New behavior ships with its tests in the same commit; suites that
need Electron are mocked (`vi.mock('electron')`) — tests never touch a
real app instance, keyring, or network.

## Conventions

- **Renderer ↔ main only via the preload bridge** — enumerate new IPC
  channels in `ipc-handlers.ts` and expose them through `preload.ts`;
  never open ad-hoc channels. Full registry and rules: `docs/dev/ipc.md`.
- **Model access goes through `src/main/ai/`** (family ADR-0008):
  `chat-models.ts` is the only file that may import `@langchain/openai`;
  `gateway.ts` is the only invocation path (every call audited to the
  `AiCall` table); `stt.ts` is the sanctioned transcription exception.
  Enforced by `scripts/check-ai-alignment.sh --self --mode strict` —
  never add provider-SDK imports elsewhere.
- **Secrets:** provider API keys live ONLY in `SecretService`
  (Electron safeStorage; encrypted `secrets.json` under userData).
  Config carries just `apiKeyHint`. STT has no dedicated key: the `stt`
  task assignment resolves to a registry provider whose keyring secret
  and endpoint are used at call time. On Linux without a keyring
  backend the service fails closed (keys are discarded, error logged) —
  by design. Never log key material.
- **Prisma/schema:** generated client is never committed
  (`src/generated/`); schema changes update `prisma/schema.prisma`, run
  `npm run prisma:gensql` for `src/main/resources/schema.sql`, and
  re-baseline the schema head (`SCHEMA_VERSION` in
  `src/main/db/migrations/index.ts` — no backwards compatibility:
  databases below the head are refused at boot with the typed message;
  the ladder stays empty unless the owner explicitly asks for one).
- Window look: frameless + rounded is a hard product trait; transparency
  is progressive enhancement — don't regress rounded corners.
- **Strings:** every user-facing string routes through
  `src/shared/constants/text.ts` (`TEXT` + `interpolate`/`pluralize`);
  no display literals in components — i18n adoption stays mechanical
  (`src/shared/constants/text.ts` is the single source; the
  `scripts/translations/` tooling enforces completeness).
- **A11y:** the axe scans (`tests/a11y-*.test.tsx`) are the family bar —
  keep them violation- and exclusion-free; new surfaces ship with a scan
  in the same commit.
