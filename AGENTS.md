# AGENTS.md — Desktop Assistant

Desktop AI assistant (Electron) that lives in the system tray and is
summoned from anywhere via a global hotkey: streaming chat, voice input,
attachments (PDF, screen capture), local conversation history (SQLite).
Part of the Neuronection assistant family.

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

## Repo map

```
src/
├── main/           Electron main process (the backend layer)
│   ├── DesktopAssistant.ts   orchestrator
│   ├── window.ts / tray.ts   frameless overlay + settings windows, tray
│   ├── ipc-handlers.ts       the IPC surface (only path renderer → main)
│   └── services/   Config, Database (Prisma), Conversation, Message,
│                   AI (chat/streaming), STT, Attachment, Hotkey
├── preload/        contextBridge API exposed to renderer (preload.ts)
├── managers/ → renderer/managers/  app glue reused by both UIs
│   (ConversationManager, RecordingManager, ThemeManager)
├── renderer/       two entries, both React 19 + Tailwind v4 +
│   │               @neuronection/assistant-ui:
│   ├── index.html + chat-react/     chat overlay (ChatPanel bubble variant,
│   │                                chat-core useChatStream over IPC)
│   ├── settings.html + settings-react/  settings window (SettingsShell,
│   │                                ProviderForm)
│   └── styles/     shared styles (tailwind entries + theme)
└── shared/         types, config defaults, constants (both processes)
prisma/             schema (generated client in src/generated/, ignored)
docs/               tracked documentation (architecture, development,
                    ipc surface, packaging)
scripts/            maintenance scripts
```

## Build & test

```bash
./scripts/run-dev.sh      # bootstrap + dev group (vite + tsc watch + electron)
npm run verify            # prisma generate + lint + typecheck + vitest + build
```

Tests live in `tests/` (Vitest; jsdom via per-file pragma where a DOM is
needed). New behavior ships with its tests in the same commit; suites that
need Electron are mocked (`vi.mock('electron')`) — tests never touch a
real app instance, keyring, or network.

## Conventions

- **Renderer ↔ main only via the preload bridge** — enumerate new IPC
  channels in `ipc-handlers.ts` and expose them through `preload.ts`;
  never open ad-hoc channels. Full registry and rules: `docs/ipc.md`.
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
- **Prisma:** generated client is never committed (`src/generated/`);
  schema changes update `prisma/schema.prisma` and regenerate
  `src/main/resources/schema.sql` (`npm run prisma:gensql`).
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
