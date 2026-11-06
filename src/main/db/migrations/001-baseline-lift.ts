import type { PrismaClient } from 'generated/prisma/client';
import { addColumnIfMissing } from './columns';

const TABLES = [
  `CREATE TABLE IF NOT EXISTS "MiniAppRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totals" JSONB,
    "estimateCalls" INTEGER NOT NULL DEFAULT 0,
    "actualCalls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "conversationId" TEXT,
    "disallowArm" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
)`,
  `CREATE TABLE IF NOT EXISTS "MiniAppRunItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "packVersion" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "confidence" REAL,
    "decidedBy" TEXT NOT NULL,
    "evidence" JSONB,
    "updatedAt" DATETIME NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "MiniAppFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "MiniAppProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "verb" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "outcome" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME
)`,
  `CREATE TABLE IF NOT EXISTS "MiniAppQuarantine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proposalId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "relPath" TEXT NOT NULL,
    "originPath" TEXT NOT NULL,
    "quarantinePath" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "movedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" DATETIME
)`,
  `CREATE TABLE IF NOT EXISTS "MiniAppWindow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "closeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "closedAt" DATETIME
)`,
  `CREATE TABLE IF NOT EXISTS "MiniAppSandboxRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "op" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
)`,
  `CREATE TABLE IF NOT EXISTS "MiniAppSandboxCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "packId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "argsHash" TEXT NOT NULL,
    "callNumber" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS "MiniAppSandboxState" (
    "packId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("packId", "key")
)`,
  `CREATE TABLE IF NOT EXISTS "Embedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "vector" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceRef" TEXT,
    "clickAction" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`,
  `CREATE TABLE IF NOT EXISTS "AppInstanceStatus" (
    "appId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastSuccessAt" DATETIME,
    "lastFailureAt" DATETIME,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("appId", "kind")
)`,
  `CREATE TABLE IF NOT EXISTS "Automation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" JSONB NOT NULL,
    "action" JSONB NOT NULL,
    "lastFiredAt" DATETIME,
    "lastOutcome" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS "ConnectorAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectorKind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "authKind" TEXT NOT NULL,
    "keyringRef" TEXT NOT NULL,
    "expiresAt" DATETIME,
    "scopes" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
)`,
] as const;

const COLUMNS: ReadonlyArray<readonly [table: string, column: string, definition: string]> = [
  ['Conversation', 'activeRootId', 'TEXT'],
  ['Message', 'parentId', 'TEXT'],
  ['Message', 'activeChildId', 'TEXT'],
  ['AiCall', 'resolvedModel', 'TEXT'],
  ['Schedule', 'kind', "TEXT NOT NULL DEFAULT 'prompt'"],
  ['Schedule', 'packId', 'TEXT'],
  ['Schedule', 'rootPath', 'TEXT'],
];

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS "Message_conversationId_idx" ON "Message"("conversationId")`,
  `CREATE INDEX IF NOT EXISTS "Message_conversationId_parentId_idx" ON "Message"("conversationId", "parentId")`,
  `CREATE INDEX IF NOT EXISTS "Message_createdAt_idx" ON "Message"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "ToolCall_conversationId_idx" ON "ToolCall"("conversationId")`,
  `CREATE INDEX IF NOT EXISTS "ToolCall_tool_idx" ON "ToolCall"("tool")`,
  `CREATE INDEX IF NOT EXISTS "ToolResult_conversationId_idx" ON "ToolResult"("conversationId")`,
  `CREATE INDEX IF NOT EXISTS "ToolResult_createdAt_idx" ON "ToolResult"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Memory_updatedAt_idx" ON "Memory"("updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "GraphNodeRun_flow_createdAt_idx" ON "GraphNodeRun"("flow", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "GraphNodeRun_threadId_idx" ON "GraphNodeRun"("threadId")`,
  `CREATE INDEX IF NOT EXISTS "CommandInvocation_commandId_idx" ON "CommandInvocation"("commandId")`,
  `CREATE INDEX IF NOT EXISTS "CommandInvocation_createdAt_idx" ON "CommandInvocation"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Schedule_enabled_idx" ON "Schedule"("enabled")`,
  `CREATE INDEX IF NOT EXISTS "DocChunk_root_idx" ON "DocChunk"("root")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DocChunk_path_chunkIndex_key" ON "DocChunk"("path", "chunkIndex")`,
  `CREATE INDEX IF NOT EXISTS "MiniAppRun_packId_updatedAt_idx" ON "MiniAppRun"("packId", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "MiniAppRunItem_runId_idx" ON "MiniAppRunItem"("runId")`,
  `CREATE INDEX IF NOT EXISTS "MiniAppRunItem_packId_packVersion_configHash_engineId_fingerprint_idx" ON "MiniAppRunItem"("packId", "packVersion", "configHash", "engineId", "fingerprint")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "MiniAppFeedback_packId_rootPath_relPath_key" ON "MiniAppFeedback"("packId", "rootPath", "relPath")`,
  `CREATE INDEX IF NOT EXISTS "MiniAppProposal_packId_updatedAt_idx" ON "MiniAppProposal"("packId", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "MiniAppQuarantine_packId_movedAt_idx" ON "MiniAppQuarantine"("packId", "movedAt")`,
  `CREATE INDEX IF NOT EXISTS "MiniAppQuarantine_runId_idx" ON "MiniAppQuarantine"("runId")`,
  `CREATE INDEX IF NOT EXISTS "MiniAppWindow_packId_updatedAt_idx" ON "MiniAppWindow"("packId", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "MiniAppSandboxRun_packId_updatedAt_idx" ON "MiniAppSandboxRun"("packId", "updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "MiniAppSandboxCall_packId_createdAt_idx" ON "MiniAppSandboxCall"("packId", "createdAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Embedding_kind_refId_model_key" ON "Embedding"("kind", "refId", "model")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Notification_dedupeKey_key" ON "Notification"("dedupeKey")`,
  `CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Automation_enabled_idx" ON "Automation"("enabled")`,
] as const;

export const migration001 = {
  version: 1,
  name: 'baseline-lift-v0.9',
  async run(prisma: PrismaClient): Promise<void> {
    for (const statement of TABLES) {
      await prisma.$executeRawUnsafe(statement);
    }
    for (const [table, column, definition] of COLUMNS) {
      await addColumnIfMissing(prisma, table, column, definition);
    }
    for (const statement of INDEXES) {
      await prisma.$executeRawUnsafe(statement);
    }
  },
};
