-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "metadata" JSONB,
    "error" TEXT,
    "role" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task" TEXT NOT NULL,
    "providerId" TEXT,
    "model" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ToolCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT,
    "messageId" TEXT,
    "tool" TEXT NOT NULL,
    "argsHash" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "approvedBy" TEXT NOT NULL,
    "mcpServer" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ToolResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT,
    "messageId" TEXT,
    "tool" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "imagePaths" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Checkpoint" (
    "threadId" TEXT NOT NULL,
    "checkpointNs" TEXT NOT NULL DEFAULT '',
    "checkpointId" TEXT NOT NULL,
    "parentCheckpointId" TEXT,
    "type" TEXT,
    "checkpoint" BLOB NOT NULL,
    "metadata" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("threadId", "checkpointNs", "checkpointId")
);

-- CreateTable
CREATE TABLE "CheckpointWrite" (
    "threadId" TEXT NOT NULL,
    "checkpointNs" TEXT NOT NULL DEFAULT '',
    "checkpointId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskPath" TEXT NOT NULL DEFAULT '',
    "idx" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT,
    "blob" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("threadId", "checkpointNs", "checkpointId", "taskId", "idx")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "tags" JSONB,
    "source" TEXT NOT NULL,
    "conversationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommandInvocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "commandId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "args" JSONB,
    "outcome" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Message_conversationId_idx" ON "Message"("conversationId");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "ToolCall_conversationId_idx" ON "ToolCall"("conversationId");

-- CreateIndex
CREATE INDEX "ToolCall_tool_idx" ON "ToolCall"("tool");

-- CreateIndex
CREATE INDEX "ToolResult_conversationId_idx" ON "ToolResult"("conversationId");

-- CreateIndex
CREATE INDEX "ToolResult_createdAt_idx" ON "ToolResult"("createdAt");

-- CreateIndex
CREATE INDEX "Memory_updatedAt_idx" ON "Memory"("updatedAt");

-- CreateIndex
CREATE INDEX "CommandInvocation_commandId_idx" ON "CommandInvocation"("commandId");

-- CreateIndex
CREATE INDEX "CommandInvocation_createdAt_idx" ON "CommandInvocation"("createdAt");

