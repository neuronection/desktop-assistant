# Tools and policy

The assistant acts through tools. Every tool declares a risk class, and a
policy engine decides whether it runs silently or pauses for a
human-in-the-loop (HITL) approval. This page covers the catalog, the
policy engine, approvals, and the MCP/tool-app bridge.

## Native tools

A native tool is a `NativeToolDefinition` (`src/main/ai/tools/types.ts`):

```ts
{
  name, description,
  schema,              // zod; also the approval-card parameter source
  risk,                // 'read-only' | 'state-changing' | 'destructive'
  category,            // 'files' | 'system' | 'desktop' | 'network' | 'power' | 'memory' | ...
  editableArgs?,       // user may edit args on the desktop approval card
  pathArgs?,           // arg keys holding paths confined to granted roots
  summarize(args),     // one-line human summary
  exec(args, ctx),     // the actual work
  timeoutMs?, resultCharCap?
}
```

Tools live in `src/main/ai/tools/native/` and are registered in
`native/index.ts` (`NATIVE_TOOL_CATALOG`). `ToolRegistry` builds LangChain
tools from them, applying per-tool timeouts (`DEFAULT_TOOL_TIMEOUT_MS`) and
result char caps (`DEFAULT_RESULT_CHAR_CAP`), hashing args for the audit,
and shaping image blocks for the wire (`toWireBlocks`).

### Adding a native tool

1. Create `native/<name>.ts` exporting the definition.
2. Add it to `NATIVE_TOOL_CATALOG` in `native/index.ts`.
3. Pick the risk class carefully — read-only runs silently,
   state-changing asks unless approved, destructive confirms every call.
4. Use `pathArgs` for filesystem paths so the policy engine can raise a
   HITL access request for out-of-root paths.
5. Add tests (exec behavior + policy/risk expectations).
6. If it produces files, append the `[artifact]` marker line
   (`src/shared/artifacts.ts`) so the turn shows file chips.
7. Update the user [tools guide](../user/tools-and-approvals.md) if the
   tool is user-visible.

## The policy engine

`src/main/ai/tools/policy.ts`:

- `ToolPolicyEngine` takes a policy snapshot (grants, disabled tools,
  per-tool settings, class defaults, granted roots) and returns a
  `PolicyDecision`: `run` | `approve` | `deny`.
- `resolveVerification` resolves the effective mode for a tool:
  per-tool override (`standard` / `always_ask` / `conditions` / `never`)
  over the class default.
- `destructiveLocked` — destructive tools always approve, regardless of
  grants or class defaults.
- `conditionMatches` / `matchesAnyCondition` evaluate "ask only when…"
  argument rules.
- Path confinement: `resolveWithinRoot`, `resolveWithinGrantedRoots`,
  `describeRootBreach`, `extractPathArgs`, `deriveGrantRoot`.

### Risk classes and grants

- Read-only tools run by default.
- State-changing tools ask unless granted (`always`, `session`, `once`).
- Destructive tools confirm every call — grants never bypass the class.
- The per-tool kill switch (`disabledTools`) removes a tool from the
  model's toolset entirely.

## Approvals (HITL)

The agent interrupts before a call needing approval:

- The graph emits an `interrupt` event; `graphs/assistant.ts` maps it to
  the `interrupt` `AssistantEvent`.
- Both windows render an `ApprovalCard` (compact in the launcher, rich and
  arg-editable on desktop).
- The user resolves via `ai:turn-resume` with decisions aligned to the
  interrupt batch and an optional grant scope. It is **idempotent** — the
  second responder gets `false`.
- Main owns the **60-second auto-deny** (hidden Electron windows throttle
  renderer timers, so deadlines are never enforced renderer-side).
- Destructive calls serialize even when the model batches them.

Session grants live in memory; `always` grants persist via a config
write-back. Resuming replays the interrupted node without re-calling the
model (the middleware caches the review).

## Granted roots

File and shell tools resolve every path against user-granted roots. When
the model asks for a path outside them, the policy engine raises an access
request naming the folder; allowing it once/session/always adds the root.
Shell commands are batch-only, with a working directory confined to
granted roots, a scrubbed environment, a hard timeout and output caps.

## Downloads and artifacts

- `tools/downloads.ts` is a tracker singleton; the tool reports bytes and
  `TurnManager` mirrors progress onto the open trace step. Cancelling
  (`tools:cancel-download`) aborts the tracker and removes the partial
  file. Open write streams before the fetch with a persistent `error`
  handler — a lazily-opened failing stream with no listener crashes main.
- `src/shared/artifacts.ts` defines the `[artifact]` marker; producing
  tools append it and main extracts it from **tool results only** (never
  model prose) into message metadata and `finished` events.

## MCP and tool apps

Tool apps (plan 15) are the only way to configure MCP servers; the old
standalone `mcpServers` config migrates into custom apps.

- `ai/tools/mcp.ts` — one `MultiServerMCPClient` per server (isolation),
  lazy connect with backoff, per-server timeout/concurrency caps.
- `ai/tools/apps.ts` — the app bridge: attribution by `mcp__<server>__`
  prefix / native-group name / registry `appId`; entity-scope enforcement
  for MCP-backed apps.
- `ai/tools/app-selection.ts` — per-turn relevance middleware: matcher,
  sticky window, tool-budget guard, availability hints. `app_selection`
  becomes a trace step; unbound app tools are rejected at `wrapToolCall`
  and excluded from `interruptOn`.
- `ai/tools/mcp-direct.ts` — direct execution on the decision fast path
  with effective per-app risk and entity-scope guard.

MCP tools are namespaced `mcp__<server>__<tool>` and default to the
state-changing risk class. Server secrets (env/headers) live in the
keyring (`mcp:<id>:env` / `mcp:<id>:headers`), never in config. See the
user [tool apps guide](../user/apps-and-mcp.md).

## The direct-tool turn path

Short, confident commands can dispatch through the decision engine's
direct-tool turn instead of the full agent loop. It uses the same policy
and approval path; the confirm band forces the card. Provenance rides
message metadata, and the tool surface is projected (native zod → JSON,
plus app MCP) and capped. Refuse/multi/error always falls through to the
agent. See [ai-layer.md](ai-layer.md) and the user
[decisions guide](../user/decisions.md).

## Auditing

Every tool call records a `ToolCall` row: `tool`, `argsHash` (args are
hashed, never stored), `outcome`, `durationMs`, `approvedBy`
(`auto`/`once`/`session`/`always`/`policy`/`denied`/`timeout`), and
`mcpServer`. `audit.ts` also exposes the usage aggregations behind the
Usage dashboard and the per-app usage card.
