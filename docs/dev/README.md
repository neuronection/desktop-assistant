# Desktop Assistant — developer guide

Desktop Assistant is an Electron application: a privileged Node **main**
process, one or two sandboxed **renderer** windows, and a typed **preload**
bridge between them, backed by local SQLite. Read this page for the map,
then jump into the page you need.

## Where to start

| If you are… | Read |
|---|---|
| New to the codebase | [architecture.md](architecture.md), then [development.md](development.md) |
| Adding a renderer↔main operation | [ipc.md](ipc.md) and [adding-features.md](adding-features.md) |
| Touching models, providers or prompts | [ai-layer.md](ai-layer.md) |
| Touching tools, approvals or policy | [tools-and-policy.md](tools-and-policy.md) |
| Changing the database | [data-model.md](data-model.md) |
| Building UI | [renderer-and-windows.md](renderer-and-windows.md) |
| Writing or fixing tests | [testing.md](testing.md) |
| Thinking about secrets or the trust boundary | [security-model.md](security-model.md) |
| Packaging or releasing | [packaging.md](packaging.md) |

## The pages

| Page | Covers |
|---|---|
| [architecture.md](architecture.md) | Process model, security model, persistence, AI access, agentic execution, windows, build system — the canonical deep dive |
| [development.md](development.md) | Bootstrap, commands, verification gate, data locations, conventions, debugging |
| [ipc.md](ipc.md) | The full renderer↔main channel registry and the rules for changing it |
| [packaging.md](packaging.md) | electron-builder configs, tag-driven release workflow, data-dir conventions |
| [testing.md](testing.md) | Vitest setup, what to mock, the streaming/a11y test templates, verification gate |
| [data-model.md](data-model.md) | The Prisma schema, runtime bootstrap, retention/pruning, FTS tables |
| [ai-layer.md](ai-layer.md) | Gateway + factory, task assignments, audits, provider setup, STT/TTS/translation/decisions, the alignment gate |
| [tools-and-policy.md](tools-and-policy.md) | Native catalog, risk classes, policy engine, HITL approvals, MCP and tool apps |
| [renderer-and-windows.md](renderer-and-windows.md) | The two renderers, window geometry, drag/resize, themes, assistant-ui |
| [security-model.md](security-model.md) | Trust boundary, keyring secrets, CSP, input-automation ban, SSRF guard, test isolation |
| [adding-features.md](adding-features.md) | End-to-end recipes: a new IPC channel, native tool, setting, AI task, UI surface |

## Ground rules (short version)

1. **Never commit untested code** — run `npm run verify` before every commit.
2. **Docs ship with the change** — behavior, schema and IPC changes update
   the matching page here and `CHANGELOG.md` under `## [Unreleased]` in the
   same commit.
3. **Renderer talks to main only through the preload bridge** — enumerate
   the channel in `ipc-handlers.ts` and `preload.ts`, type it in
   `src/shared/types.ts`, update `ipc.md`.
4. **Model I/O goes through `src/main/ai/`** — `chat-models.ts` is the only
   file that may import `@langchain/openai`; the gateway is the only
   invocation path. Enforced by `scripts/check-ai-alignment.sh`.
5. **No comments in code** unless requested; mimic existing style.
6. **User-facing strings route through** `src/shared/constants/text.ts`.

The tracked `AGENTS.md` at the repo root is the authoritative rule list;
the internal agent routing lives in the machine-local companion.
