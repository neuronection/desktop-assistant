# Data model

Desktop Assistant stores everything in one local SQLite database,
`<userData>/conversations.db`, accessed through Prisma 7 in
driver-adapter mode (`@prisma/adapter-libsql`). The datasource URL is set
at runtime by `DatabaseService`; the app never depends on `.env` at
runtime (that file only serves Prisma CLI commands).

## Schema changes — the workflow

1. Edit `prisma/schema.prisma`.
2. Regenerate the flattened runtime bootstrap:
   `npm run prisma:gensql` (writes `src/main/resources/schema.sql`).
3. If the change is additive, add the matching `ensureTable` /
   `ensureColumn` bootstrap in `DatabaseService.setup()` so existing
   installs upgrade in place.
4. Regenerate the client: `npm run prisma:generate` (or let
   `npm run verify` do it).
5. Update this page in the same commit.

The generated client lives in `src/generated/prisma` and is **never
committed**. Three artifacts must stay in sync: `prisma/schema.prisma`,
`src/main/resources/schema.sql`, and the `ensureTable`/`ensureColumn`
statements.

### Bootstrap for existing installs

`DatabaseService.setup()`:

- Creates the DB from `schema.sql` when the `Conversation` table is
  missing (fresh install).
- Otherwise runs `ensureTable` for every newer table and `ensureColumn`
  for additive columns — both are idempotent existence checks. This is how
  older databases gain new tables/columns without a migration tool.

`ensureTable` splits its SQL on `;`, so a table plus its indexes is safe
in one call. Keep multi-statement bootstrap SQL in that shape.

## Tables

| Model | Purpose | Notes |
|---|---|---|
| `Conversation` | Chat sessions | `title`, `isArchived`, `metadata` (model override, per-conversation speak) |
| `Message` | Messages | `role` (user/assistant/system), `attachments`, `metadata` (turn trace, artifacts, node timeline), `error` |
| `AiCall` | AI audit | `task`, `providerId`, `model`, `durationMs`, `outcome`, optional `inputTokens`/`outputTokens` |
| `ToolCall` | Tool audit | `tool`, `argsHash` (args are hashed, never stored), `outcome`, `durationMs`, `approvedBy`, `mcpServer` |
| `ToolResult` | Durable tool results | Full `text` + `imagePaths`; survives restarts until age-pruned |
| `Checkpoint` / `CheckpointWrite` | LangGraph checkpoints | `threadId = <conversationId>:<tempMessageId>`; resumed turns replay from here |
| `Memory` | Persistent memory | `source` (user/assistant), `tags`, `mergedFrom` provenance |
| `GraphNodeRun` | Node telemetry | `flow`, `threadId`, `node`, `outcome`, `durationMs`, `resumed` |
| `CommandInvocation` | Command history | `commandId`, `kind`, `source`, `outcome`; args for read-only builtins only |
| `Schedule` | Scheduled prompts | `spec` JSON, IANA `timezone`, `lastRunAt`/`lastOutcome`, dedicated `conversationId` |
| `DocChunk` | Local docs index | `root`, `path`, `mtimeMs`, `chunkIndex`, `text`; unique on `(path, chunkIndex)` |

Enums: `MessageRole` (`user`/`assistant`/`system`) and `MemorySource`
(`user`/`assistant`).

## Full-text search

Two external-content FTS5 indexes are bootstrapped outside Prisma (they
are not in the schema file):

- **`Memory_fts`** — over `Memory`, porter/unicode61, kept in sync by
  insert/update/delete triggers created in `MemoryService.setup()`. A
  `rebuild` runs on first use each boot, because rows written before the
  triggers existed would otherwise be invisible. Search prefers FTS5 MATCH
  with bm25 ranking and exact-match boost, and falls back to `LIKE` when
  the index is unavailable. The shared MATCH-query builder is
  `src/main/services/fts.ts`.
- **Docs index** — `DocChunk` gets an external-content FTS5 index in
  `DocsIndexService`, same trigger-sync pattern.

## Retention and pruning

Pruning runs on boot in `ipc-handlers.ts`, each fail-soft:

| What | Default |
|---|---|
| LangGraph checkpoints | 7 days (`checkpointer.prune()`) |
| `GraphNodeRun` rows | 7 days (`pruneGraphNodeRuns()`) |
| `ToolResult` rows | age-pruned (`ToolResultService.prune()`) |
| `CommandInvocation` rows | `commands.history.retentionDays` (default 90) |

## Timestamp gotchas

- Prisma binds `DateTime` as an **epoch integer** on SQLite. Never compare
  a Prisma `DateTime` against SQLite `datetime()` TEXT output in raw SQL —
  they will not match.
- `mtimeMs` on `DocChunk` is a float for mtime-delta re-indexing.

## Adapter notes

- SQLite runs through `@prisma/adapter-libsql` (N-API). One prebuilt
  binary serves both Node/vitest and the Electron runtime — do not swap in
  `better-sqlite3`, whose V8-ABI builds cannot serve both runtimes.
- There are no query-engine binaries in Prisma 7; the old
  `PRISMA_QUERY_ENGINE_LIBRARY` discovery is gone.
- The CLI config is `prisma.config.ts` (loads `.env` via dotenv).
