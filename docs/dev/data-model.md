# Data model

Desktop Assistant stores everything in one local SQLite database,
`<userData>/conversations.db`, accessed through Prisma 7 in
driver-adapter mode (`@prisma/adapter-libsql`). The datasource URL is set
at runtime by `DatabaseService`; the app never depends on `.env` at
runtime (that file only serves Prisma CLI commands).

## One source, one boot path

`prisma/schema.prisma` is the **only** schema source. Two generated
artifacts derive from it:

- `src/generated/prisma` — the Prisma client (never committed).
- `src/main/resources/schema.sql` — the flattened fresh-boot DDL
  (`npm run prisma:gensql`, never edited by hand).

`src/main/db/` owns boot:

| Path | What happens |
|---|---|
| **Fresh boot** (`Conversation` absent) | `schema.sql` runs in one transaction, then `PRAGMA user_version = <head>` |
| **Existing head** (`user_version == head`) | Opens; the schema is already at head |
| **Older database** (`user_version < head`) | Refused with `TEXT.DB_SCHEMA_UNSUPPORTED` (no compatibility path) |
| **Newer database** (`user_version > head`) | Refused with `TEXT.DB_SCHEMA_TOO_NEW` (never downgrade) |

A migration module (when the ladder has entries) is a `Migration`
(`version`, `name`, `statements`, optional `notes`). The ladder is
**forward-only**: exactly-once, additive, no down migrations. Additive
means `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD COLUMN`; never
rename, re-type or drop outside a flatten.

**Flatten policy:** the plan-36 ladder was folded into `schema.sql`,
`user_version` was re-baselined to head `1`, and
`001-roadmap-union.ts` was deleted. History lives in git. The same drill
runs at every release (and whenever the ladder exceeds 5 entries).
`tests/fixtures/schema-before-plan36.sql` is a historical snapshot used
only to prove the v0 refusal.

**Convergence guarantee:** `tests/database-migration.test.ts` boots a
fresh DB and an existing head DB and asserts identical table, column and
index sets, plus data survival. The schema drift wall separately compares
the parsed `schema.sql` against runtime `PRAGMA` introspection.

## SQLite runtime (D5)

`openDatabase` applies the runtime contract once at open:

```
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

The app never writes raw `PRAGMA` statements elsewhere; runtime
behaviour belongs to the open path.

## Conventions law

### D1 — IDs and timestamps

- Every `id` is `String @id @default(cuid())` except join/identity tables
  whose natural key is the primary key (`AppInstanceStatus(appId, kind)`,
  `MiniAppSandboxState(packId, key)`, the checkpoint tables).
- Timestamps are `DateTime @default(now())` (a UTC instant). `updatedAt`
  exists only on mutable rows (`@updatedAt`).
- No string dates. Never compare a Prisma `DateTime` against SQLite
  `datetime()` TEXT output in raw SQL — Prisma binds it as an epoch
  integer.

### D2 — Closed vocabularies

Every new `status`/`kind` column is `String` plus a zod enum exported
from `src/shared/schema/vocab.ts`. Never introduce a new Prisma enum
(SQLite charges nothing for the string; the vocab module is the gate).
The existing `MessageRole` and `MemorySource` Prisma enums stay as they
are.

| Column | Vocabulary |
|---|---|
| `Embedding.kind` | `message`, `memory`, `doc-chunk` |
| `Notification.kind` | `system`, `schedule`, `pack-run`, `download`, `memory`, `tool` |
| `Notification.severity` | `info`, `success`, `warn`, `error` |
| `Notification.clickAction` | `none`, `open-conversation`, `open-settings`, `open-pack-report`, `open-path` |
| `AppInstanceStatus.kind` | `tool`, `mcp`, `pack` |
| `AppInstanceStatus.status`, `ConnectorAccount.status` | `ok`, `degraded`, `failing`, `stale` |
| `Automation.lastOutcome` | `ok`, `failed`, `skipped` |
| `ConnectorAccount.connectorKind` | `google-calendar`, `nextcloud`, `email`, `generic` |
| `ConnectorAccount.authKind` | `oauth2`, `app-password`, `token` |

`Schedule.kind` (`prompt` / `mini-app`) is a pre-plan-36 column; its
vocabulary is owned by the schedule model in `src/shared/schedules.ts`.

### D3 — JSON envelope registry

Every `Json` column has a zod schema in `src/shared/schema/<name>.ts`
with a matching exported type (`src/shared/schema/index.ts` is the
registry barrel), and the write path validates before storing. Rules:

- `passthrough()` — unknown fields round-trip, never crash.
- Fields are added additively; no shape-breaking edits.
- A `v: number` field only on envelopes expected to revolve
  (`MiniAppProposal.payload` already qualifies).
- Read paths parse leniently with defaults; a malformed row degrades, it
  never bricks a surface.

The columns covered by the convention:

| Column | Envelope |
|---|---|
| `Message.metadata` | `turnMetadata` (turn trace, artifacts, node timeline, provenance) |
| `Message.attachments` | `attachmentList` |
| `Conversation.metadata` | `conversationMetadata` (model override, per-conversation speak) |
| `Schedule.spec` | `scheduleSpec` |
| `Memory.tags`, `Memory.mergedFrom` | `memoryTags`, `memoryProvenance` |
| `MiniAppRun.totals` | `miniAppRunTotals` |
| `MiniAppRunItem.evidence` | `miniAppItemEvidence` |
| `MiniAppProposal.payload` / `outcome` | `miniAppProposalPayload` (v1) / `miniAppProposalOutcome` |
| `Notification.payload` | `notificationPayload` |
| `Automation.trigger` / `action` | `automationTrigger` / `automationAction` |
| `ConnectorAccount.scopes` | `connectorScopes` |
| `ToolResult.imagePaths` | `imagePathList` |
| `CommandInvocation.args` | `commandArgs` (`{ argv: string[] }`) |
| `MiniAppSandboxState.value` | `sandboxStateValue` |

`TurnMetadata` is defined in
`src/shared/schema/turnMetadata.ts` (re-exported by
`src/shared/turns.ts` for turn-layer imports); all other envelope types
stay with their domain modules and their schemas are typed against
them. `MiniAppProposal.payload` carries `v` (currently `1`); every other
envelope is additive-only without a version field. Writers validate
(`validate*` / `validateX`), readers parse leniently
(`parse*` / `parseX`, defaults on malformed rows).

### D4 — Config versioning

`config.json` carries `schemaVersion` (currently `1`,
`src/shared/config/configVersion.ts`). Load = parse → run pending
upgrade functions (transient) → strip unknown keys → serve → persist the
normalized config. Save = `sanitizeConfigForSave` (zod envelope parse +
shape strip) only; unknown keys never reach disk. Upgrade functions live
in `CONFIG_UPGRADES` and are deleted at each flatten, exactly like the
DB ladder.

### D6 — Retention is explicit

One boot prune pass owns every table that can grow:
`runRetentionPrune` (`src/main/db/retention.ts`) reads
`AppConfig.behavior.retention`. Every window is explicit; `null` means
**keep all**, never silent deletion. Each table fails soft so one bad
query cannot block boot.

| What | Default |
|---|---|
| LangGraph checkpoints + writes | 7 days |
| `GraphNodeRun` rows | 7 days |
| `Notification` rows | 30 days |
| `ToolResult` rows + image files | 7 days |
| `AiCall` rows | keep all (`null`) |
| `ToolCall` rows | keep all (`null`) |
| `CommandInvocation` rows | keep all (`null`) |
| `MiniAppRun` rows | newest 50 finished per pack (paused/interrupted kept) — separate run-retention domain |
| `MiniAppQuarantine` | 30 days, plus the user-armed empty — separate quarantine domain |

The drift wall (`tests/schema-drift.test.ts`) parses `schema.sql` and
compares tables, columns/types and indexes against a booted database with
`PRAGMA` introspection.

### D7 — Indexes are query-backed

Every index names the query it serves in the migration's `notes` (or the
schema comment for pre-plan-36 indexes). No speculative indexes.

| Index | Query |
|---|---|
| `Message(conversationId)` | transcript load for one conversation |
| `Message(conversationId, parentId)` | branch tree: children of a message (plan 40) |
| `Message(createdAt)` | recency scans |
| `Embedding(kind, refId, model)` unique | embedding upsert/lookup for one subject (plan 41) |
| `Notification.dedupeKey` unique | dedupe upsert by stable event key (plan 42) |
| `Notification(createdAt)` | inbox list newest-first (plan 42) |
| `AppInstanceStatus(appId, kind)` PK | instance status lookup (plan 38) |
| `Automation(enabled)` | enabled-rule scan by the automation runner (plan 48) |
| `Schedule(enabled)` | timer-wheel load |
| `DocChunk(path, chunkIndex)` unique, `DocChunk(root)` | docs re-index and per-root search |
| `MiniAppRun(packId, updatedAt)` | per-pack run history + retention |
| `MiniAppRunItem(runId)` / cache key | report load / fingerprint checkpoint lookup |
| `MiniAppProposal(packId, updatedAt)` | proposal list + retention |
| `MiniAppQuarantine(packId, movedAt)` / `(runId)` | quarantine manager / run-scoped restore |

## Conversation branching (plan 40)

The family branching contract is pointer-based (ai-features §8):

- `Message.parentId` — the branch parent (`NULL` = root).
- `Message.activeChildId` — the selected child at this level.
- `Conversation.activeRootId` — the root of the visible path.

Creation writes the invariant: the first message in a conversation becomes
`activeRootId`; every later message is created under the current active
tip and the tip's `activeChildId` points at it. Edit creates a new USER
sibling under the edited message's parent and flips that level; regenerate
creates a new assistant sibling under the target USER and flips that
parent; select flips exactly one pointer. The old subtree is retained and
switchable. A late assistant write activates only when its parent is still
the childless active tip (or, for regenerate, the explicitly selected
target), so an edit/select made during a turn never gets overwritten.
Existing pre-plan-36 rows are roots (`parentId = NULL`); there is no
legacy back-chain.

The **visible conversation is the active-path walk** from
`activeRootId` following `activeChildId` (newest-sibling fallback,
cycle-safe). `MessageService.getMessagesByConversation` returns that path;
`getMessageTree` returns every node. Every returned message is decorated
with `parentId`, `activeChildId`, `childIds`, `variantIndex` (0-based
sibling position), `variantCount` and `siblingIds` (oldest first). Branch
subtrees stay persisted and out of the visible list/context until selected.
`ConversationService` applies the same active-path walk, so the renderer's
conversation payload never carries hidden variants.

Branch writes carry `metadata.branchedFrom` (the source USER for an edit;
the replaced assistant or target USER for a regenerate).

### Per-branch LangGraph threads (health H2 ruling)

A turn's checkpoint thread is derived from its anchor before the model
runs (`src/main/turns/branchThreads.ts`):

- original spine → bare `conversationId`;
- deepest non-first-born USER variant on the anchor chain → `conversationId:editedUserId`;
- otherwise root-most non-first-born assistant variant → `conversationId:parentUserId`;
- a regenerate under a user that already has replies → `conversationId:userId`.

A fresh turn deletes any abandoned pause on its derived thread before
running (a stray send supersedes it); an approval that is still open keeps
running on its own branch. Checkpoint retention (`runRetentionPrune` and
`PrismaCheckpointSaver.prune`) derives the owning conversation from both
thread forms (`id` and `id:branchTip`) and treats owner-less threads as
orphans; row age remains a fallback.

### Single-flight

`TurnManager` locks one streaming turn per conversation. A second send on
the same conversation (including a branch intent) is queued and returns
`{ queued: true }`; it starts after the active turn settles. A turn for a
different conversation is still rejected while one is active (the existing
cross-conversation behavior is unchanged).

## Tables

| Model | Purpose | Notes |
|---|---|---|
| `Conversation` | Chat sessions | `title`, `isArchived`, `metadata` (model override, per-conversation speak), `activeRootId` (branching pointer) |
| `Message` | Messages | `role` (user/assistant/system), `attachments`, `metadata` (turn trace, artifacts, node timeline), `error`, `parentId`/`activeChildId` (branch tree) |
| `AiCall` | AI audit | `task`, `providerId`, `model`, `resolvedModel`, `durationMs`, `outcome`, optional `inputTokens`/`outputTokens` |
| `ToolCall` | Tool audit | `tool`, `argsHash` (args are hashed, never stored), `outcome`, `durationMs`, `approvedBy`, `mcpServer` |
| `ToolResult` | Durable tool results | Full `text` + `imagePaths`; survives restarts until age-pruned |
| `Checkpoint` / `CheckpointWrite` | LangGraph checkpoints | `threadId` = bare `conversationId` on the spine or `<conversationId>:<branchTipId>` on a branch; schema-locked to LangGraph's contract |
| `Memory` | Persistent memory | `source` (user/assistant), `tags`, `mergedFrom` provenance |
| `GraphNodeRun` | Node telemetry | `flow`, `threadId`, `node`, `outcome`, `durationMs`, `resumed` |
| `CommandInvocation` | Command history | `commandId`, `kind`, `source`, `outcome`; args for read-only builtins only |
| `Schedule` | Scheduled prompts + scheduled mini-app runs | `spec` JSON, IANA `timezone`, `lastRunAt`/`lastOutcome`, dedicated `conversationId`; `kind` (`prompt` / `mini-app` with `packId` + `rootPath`) |
| `DocChunk` | Local docs index | `root`, `path`, `mtimeMs` (float), `chunkIndex`, `text`; unique on `(path, chunkIndex)` |
| `MiniAppRun` | Mini-app assessment runs | `packId`/`packVersion`/`rootPath`/`configHash`/`engineId` fingerprint, `status`, `totals` JSON, token/call counters; `disallowArm` marks scheduled report-only runs |
| `MiniAppRunItem` | Per-item verdict checkpoints + cache | cache key `(packId, packVersion, configHash, engineId, fingerprint)`; `decidedBy`, `evidence` JSON |
| `MiniAppFeedback` | User overrides | unique per `(packId, rootPath, relPath)` |
| `MiniAppProposal` | HITL Class-B arming | `pending → approved/rejected → executed/failed/aborted`; payload/outcome JSON |
| `MiniAppQuarantine` | Quarantine records | origin/quarantine paths, `movedAt`/`restoredAt`; the only automatic deletion |
| `MiniAppWindow` | Declarative report windows | one per pack, closed by disable/remove/kill-switch/quit |
| `MiniAppSandboxRun` / `MiniAppSandboxCall` | T2 sandbox audit | process lifecycle + one row per capability call |
| `MiniAppSandboxState` | T2 pack state | `(packId, key)` → JSON value |
| `Embedding` | Semantic ranking store (plan 41) | `kind`/`refId`/`model`, `dims`, `contentHash`, `vector` bytes; unique per `(kind, refId, model)` |
| `Notification` | Persisted notification inbox (plan 42) | `kind`, `severity`, `title`, `body`, `payload` (carries `count` for dedupe bumps), `sourceRef`, closed `clickAction`, unique `dedupeKey`, `readAt`; written only by `NotificationService` and pruned by the boot retention pass |
| `AppInstanceStatus` | Per-instance health (plan 38) | PK `(appId, kind)`, shared status vocabulary, last success/failure + consecutive failures + `lastError`; written by `AppInstanceStatusService` from MCP health, pack reconcile/self-disable and run outcomes. `needs-config` / `needs-secret` are derived at read time, never stored. |
| `Automation` | Event automations (plan 48) | `trigger`/`action` JSON envelopes, `enabled`, `lastFiredAt`, `lastOutcome` |
| `ConnectorAccount` | Connector metadata (plan 48) | `connectorKind`, `label`, `authKind`, `keyringRef` (a reference, never a token), `expiresAt`, `scopes` JSON, `status` |

## Full-text search

Two external-content FTS5 indexes are bootstrapped outside Prisma (they
are not in the schema file):

- **`Memory_fts`** — over `Memory`, porter/unicode61, kept in sync by
  insert/update/delete triggers created in `MemoryService.setup()`. A
  `rebuild` runs on first use each boot, because rows written before the
  triggers existed would otherwise be invisible. Search prefers FTS5
  MATCH with bm25 ranking and exact-match boost, and falls back to `LIKE`
  when the index is unavailable. The shared MATCH-query builder is
  `src/main/services/fts.ts`.
- **Docs index** — `DocChunk` gets an external-content FTS5 index in
  `DocsIndexService`, same trigger-sync pattern.

New full-text needs must reuse this external-content pattern; never add a
parallel design.

## Do not break

- `Checkpoint`/`CheckpointWrite` are LangGraph's contract — additive
  columns only.
- `MiniAppRun*` fingerprint identity (`packId, packVersion, configHash,
  engineId, fingerprint`) — run resume depends on it byte-identically.
- The `Memory_fts` / `DocChunk_fts` external-content + trigger pattern.
- Keyring is the ONLY secret store: no schema column ever holds secret
  material (`ConnectorAccount.keyringRef` holds a reference).

## Adapter notes

- SQLite runs through `@prisma/adapter-libsql` (N-API). One prebuilt
  binary serves both Node/vitest and the Electron runtime — do not swap in
  `better-sqlite3`, whose V8-ABI builds cannot serve both runtimes.
- There are no query-engine binaries in Prisma 7; the old
  `PRISMA_QUERY_ENGINE_LIBRARY` discovery is gone.
- The CLI config is `prisma.config.ts` (loads `.env` via dotenv).
