# AI layer

All model I/O goes through `src/main/ai/`. This is a family standard
(ADR-0008) enforced by CI, not a convention: **nothing outside
`src/main/ai/` may import a provider SDK or a LangChain chat class**, and
`chat-models.ts` is the only file that may import `@langchain/openai`.

The gate is `scripts/check-ai-alignment.sh --self --mode strict`. Run it
after touching anything here.

## Layout

```
src/main/ai/
├── chat-models.ts      the model factory — the ONLY @langchain/openai importer
├── gateway.ts          the ONLY invocation path; audits every call
├── audit.ts            AiCall / ToolCall / GraphNodeRun sinks + usage stats
├── catalog.ts          provider model-catalog fetching (ADR-0018)
├── stt.ts              sanctioned transcription exception
├── tts.ts              sanctioned speech synthesis
├── translate.ts        translation engines
├── utterance.ts        voice-endpoint verdict (auto-send judge; selectable vs the decision engine)
├── checkpointer.ts     PrismaCheckpointSaver (app-DB LangGraph checkpoints)
├── tool-schema-guard.ts
├── providers/setup.ts  one-click BYOK setup orchestration
├── graphs/
│   ├── assistant.ts    the createAgent tool agent + HITL middleware
│   └── research.ts     the one custom StateGraph (plan → search/fetch/assess → synthesize)
├── decide/             the decision engines
│   ├── index.ts, registry.ts, settings-controller.ts, tool-surface.ts, prompt.ts
│   ├── llm.ts          structured-output engine
│   ├── needle/         local engine (utilityProcess + wasm runtime)
│   └── jev/            TypeSafe Jev cloud engine (SDK behind a seam)
└── tools/              native catalog, policy, MCP bridge, downloads (see tools-and-policy.md)
```

## The gateway

`AiGateway` (`gateway.ts`) is the only path to a model for chat and
streaming:

- `chat(request)` — one-shot completion.
- `chatStream(request)` — async generator of tokens.

Every call records an `AiCall` row (task, provider, model, duration,
outcome, error, optional token usage). The gateway takes the model factory
and the audit sink as constructor dependencies, so tests inject a
`ScriptedChatModel` and a captured sink.

Do not call `model.invoke`/`stream` directly in feature code — route
through the gateway so the audit stays complete.

## The factory

`chat-models.ts` exports:

- `createChatModel` / `createAgentModel` — build a `ChatOpenAI`-compatible
  model for a provider + model id + key, with overrides.
- `createStructuredChatModel` — structured output via
  `withStructuredOutput`, with `wireSafeResponseSchema` pruning
  provider-incompatible JSON Schema keywords first.
- `supportsProviderToolSearch` — capability check used by tool-app
  deferred exposure.
- `wireSafeResponseSchema` — the schema pruner.

Provider quirks are handled here, not in callers: reasoning models
(`/^(o\d|gpt-5)/`) omit `temperature`; Gemini rejects union types in
function schemas (the tool-schema guard warns at bind time).

## Tasks

`AiTask` (`src/shared/types.ts`) is the audit/task vocabulary:

`chat`, `titles`, `stt`, `voiceEndpoint`, `tts`, `translate`,
`plumbing`, `intent`, `vision`.

`taskAssignments` in config maps each task to a registered model id.
Resolution rules:

- Most tasks fall back to the chat model when unassigned.
- `translate` **never** falls back — unassigned means the LLM translation
  engine is off.
- `vision` is resolved first for image/screen-capture turns, then falls
  back to `chat`.
- `plumbing` is the cheap internal helper (`resolveInternalModel`).

## Provider setup

`providers/setup.ts` orchestrates the BYOK wizard: fetch-first validation
(`AbortController` under the provider timeout), error classification via
`classifyProviderError`, append-only catalog writes (never replaces),
gap-filling of empty task slots, and idempotent `presetKey` adoption.
Preset **data** is generated: `contracts/ai-presets.json` (family
canonical) → `src/shared/ai/providerPresets.generated.ts` via
`scripts/sync-ai-presets.mjs`. Never hand-edit the generated file;
`scripts/check-byok-contract.sh` gates drift.

## Decision engines

`ai/decide/` resolves → invokes → zod-validates → audits → bands
(act/confirm/refuse). Every non-decided status falls through to the agent
path. The engines are pluggable behind a registry: `llm.ts` (structured
chat), `needle/` (local wasm via a `utilityProcess`), `jev/` (TypeSafe SDK
behind a `JevClient` seam). See [tools-and-policy.md](tools-and-policy.md)
and the user's [decisions guide](../user/decisions.md).

Decision points (`ai/decide/points/`) reuse an engine for non-dispatch
decisions: `tool-dispatch.ts` (the fast path), `speak-intent.ts`
(prompt-armed auto-speak — non-blocking, the model reply can never arm
it), and `utterance-gate.ts` (voice auto-send — fail-closed). The
auto-send gate's judge is selectable via `config.voice.autoSendEngine`:
the decision engine, or `task` mode which skips the engine and uses the
assigned `voiceEndpoint` model (chat fallback).

## Graphs

- `graphs/assistant.ts` — `createAgent` with tool-calling, token/step/
  wall-clock caps, HITL approval middleware, and node telemetry derived
  from the LangGraph stream. Node names are stream keys, never hardcoded.
- `graphs/research.ts` — the only custom `StateGraph`:
  `plan → (search → fetch → assess)* → synthesize`, bounded, with explicit
  policy consults and batched `interrupt()` for approvals.

Graphs live under `ai/graphs/` (enforced by the gate, R3).

## Checkpointing

`checkpointer.ts` is a custom `PrismaCheckpointSaver` (LangGraph
`BaseCheckpointSaver` over the app DB — deliberately not
`@langchain/langgraph-checkpoint-sqlite`, which would drag in
better-sqlite3). `setup()` creates the tables, `prune()` removes rows
older than 7 days at boot. Resume replays the interrupted node without
re-calling the model; everything replayed is marked `resumed: true`.

## Debugging the wire

Run with `DA_AI_DEBUG=1` to log each agent model call: `[ai-debug] llm
start` (resolved model + bound tool names) and `[ai-debug] llm end`
(whether the response carried tool calls, plus a text preview). This
separates "the model never asked for tools" from "tool calls were lost in
the stack".
