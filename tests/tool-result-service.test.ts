import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrismaClient } from 'generated/client';
import { ToolResultService } from '@main/services/ToolResultService';

let dataDir: string;
const clients: PrismaClient[] = [];

afterAll(async () => {
  await Promise.all(clients.map((client) => client.$disconnect()));
  await rm(dataDir, { recursive: true, force: true });
});

const CREATE_TOOL_RESULT = `CREATE TABLE IF NOT EXISTS "ToolResult" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "conversationId" TEXT,
  "messageId" TEXT,
  "tool" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "imagePaths" JSONB,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ToolResult_conversationId_idx" ON "ToolResult"("conversationId");
CREATE INDEX IF NOT EXISTS "ToolResult_createdAt_idx" ON "ToolResult"("createdAt");`;

const PNG_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function makeService(): Promise<{ service: ToolResultService; client: PrismaClient; dir: string }> {
  dataDir ??= await mkdtemp(join(tmpdir(), 'da-tool-results-'));
  const dbFile = join(dataDir, `${Math.random().toString(36).slice(2)}.db`);
  const client = new PrismaClient({ datasources: { db: { url: `file:${dbFile}` } } });
  clients.push(client);
  await client.$connect();
  for (const statement of CREATE_TOOL_RESULT.split(';').filter((part) => part.trim())) {
    await client.$executeRawUnsafe(statement);
  }
  const dir = await mkdtemp(join(dataDir, 'results-'));
  const service = new ToolResultService(() => client, dir);
  return { service, client, dir };
}

async function seedOldRow(client: PrismaClient, id: string, conversationId: string, file: string): Promise<void> {
  await client.$executeRawUnsafe(
    `INSERT INTO "ToolResult" ("id", "conversationId", "tool", "status", "text", "imagePaths", "createdAt")
     VALUES ('${id}', '${conversationId}', 'screen_capture', 'ok', 'old', '["${file}"]', 1577836800000);`
  );
}

describe('ToolResultService', () => {
  it('stores images as files and round-trips them through get()', async () => {
    const { service, dir } = await makeService();
    await service.store({
      callId: 'tool_call_1',
      conversationId: 'conv_1',
      messageId: 'msg_1',
      tool: 'screen_capture',
      status: 'ok',
      text: 'Screenshot captured.',
      images: [PNG_URL],
    });

    const files = await readdir(dir);
    expect(files).toEqual(['tool_call_1_0.png']);

    const view = await service.get('tool_call_1');
    expect(view).toMatchObject({
      callId: 'tool_call_1',
      tool: 'screen_capture',
      status: 'ok',
      text: 'Screenshot captured.',
    });
    expect(view?.images).toEqual([PNG_URL]);
  });

  it('persists across service instances (restart survival)', async () => {
    const { service, client, dir } = await makeService();
    await service.store({
      callId: 'tool_call_2',
      conversationId: 'conv_1',
      messageId: 'msg_2',
      tool: 'screen_capture',
      status: 'ok',
      text: 'shot',
      images: [PNG_URL],
    });

    const revived = new ToolResultService(() => client, dir);
    expect(await revived.has('tool_call_2')).toBe(true);
    const view = await revived.get('tool_call_2');
    expect(view?.images).toEqual([PNG_URL]);
    expect(await revived.get('missing')).toBeNull();
  });

  it('indexes only image-bearing rows of one conversation, newest first', async () => {
    const { service } = await makeService();
    await service.store({
      callId: 'tool_a',
      conversationId: 'conv_1',
      messageId: 'm1',
      tool: 'screen_capture',
      status: 'ok',
      text: 'a',
      images: [PNG_URL],
    });
    await service.store({
      callId: 'tool_b',
      conversationId: 'conv_1',
      messageId: 'm2',
      tool: 'screen_capture',
      status: 'ok',
      text: 'text only',
      images: [],
    });
    await service.store({
      callId: 'tool_c',
      conversationId: 'conv_2',
      messageId: 'm3',
      tool: 'screen_capture',
      status: 'ok',
      text: 'other conversation',
      images: [PNG_URL],
    });

    const index = await service.listForConversation('conv_1');
    expect(index.map((entry) => entry.id)).toEqual(['tool_a']);
  });

  it('prunes expired rows together with their image files', async () => {
    const { service, client, dir } = await makeService();
    await seedOldRow(client, 'tool_old', 'conv_1', 'tool_old_0.png');
    await service.store({
      callId: 'tool_new',
      conversationId: 'conv_1',
      messageId: 'm',
      tool: 'screen_capture',
      status: 'ok',
      text: 'fresh',
      images: [PNG_URL],
    });

    await service.prune(1000);

    expect(await service.has('tool_old')).toBe(false);
    expect(await service.has('tool_new')).toBe(true);
    const files = await readdir(dir);
    expect(files).toContain('tool_new_0.png');
    expect(files).not.toContain('tool_old_0.png');
  });
});
