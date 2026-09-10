import { promises as fs } from 'fs';
import { join } from 'path';
import { Prisma, type PrismaClient, type ToolResult as PrismaToolResult } from 'generated/client';
import type { ToolResultView } from '@shared/turns';
import { ToolResultStore } from '@main/turns/tool-results';

export const TOOL_RESULT_TEXT_CAP = 20_000;
const DEFAULT_PRUNE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ToolResultStoreInput {
  callId: string;
  conversationId?: string | null;
  messageId?: string | null;
  tool: string;
  status: 'ok' | 'error';
  text: string;
  /** Data URLs (`data:image/…;base64,…`). */
  images: string[];
}

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function extForMime(mimeType: string): string {
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.png';
}

function parseDataUrl(url: string): { mimeType: string; data: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(url);
  if (!match) {
    return null;
  }
  return { mimeType: match[1], data: Buffer.from(match[2], 'base64') };
}

function safeFileStem(callId: string): string {
  return callId.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120);
}

function parseImagePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Durable store for full tool results (plan: tool-result viewer + recall).
 * Images live as files under `<userData>/tool-results/`, metadata in the
 * `ToolResult` table; a small L1 cache serves the hot path. Written
 * through on every tool result, read by the viewer IPC and the
 * `recall_screenshot` tool, pruned by age on boot.
 */
export class ToolResultService {
  private readonly getClient: () => PrismaClient | null;
  private readonly baseDir: string | null;
  private readonly cache = new ToolResultStore();

  constructor(getClient: () => PrismaClient | null, baseDir: string | null = null) {
    this.getClient = getClient;
    this.baseDir = baseDir;
  }

  private async dir(): Promise<string> {
    if (this.baseDir) {
      return this.baseDir;
    }
    const { app } = await import('electron');
    return join(app.getPath('userData'), 'tool-results');
  }

  private client(): PrismaClient | null {
    return this.getClient();
  }

  async store(entry: ToolResultStoreInput): Promise<void> {
    const text = entry.text.length > TOOL_RESULT_TEXT_CAP ? entry.text.slice(0, TOOL_RESULT_TEXT_CAP) : entry.text;
    const files: string[] = [];
    try {
      if (entry.images.length > 0) {
        const dir = await this.dir();
        await fs.mkdir(dir, { recursive: true });
        const stem = safeFileStem(entry.callId);
        for (let index = 0; index < entry.images.length; index += 1) {
          const parsed = parseDataUrl(entry.images[index]);
          if (!parsed) {
            continue;
          }
          const name = `${stem}_${index}${extForMime(parsed.mimeType)}`;
          await fs.writeFile(join(dir, name), parsed.data);
          files.push(name);
        }
      }
    } catch (error) {
      console.error('Tool-result image write failed (result stays memory-only):', error);
    }

    const client = this.client();
    if (client) {
      try {
        const data = {
          conversationId: entry.conversationId ?? null,
          messageId: entry.messageId ?? null,
          tool: entry.tool,
          status: entry.status,
          text,
          imagePaths: files.length > 0 ? files : Prisma.DbNull,
        };
        await client.toolResult.upsert({
          where: { id: entry.callId },
          create: { id: entry.callId, ...data },
          update: data,
        });
      } catch (error) {
        console.error('Tool-result audit write failed (result stays memory-only):', error);
      }
    }

    this.cache.put(entry.callId, { tool: entry.tool, status: entry.status, text, images: entry.images });
  }

  async get(callId: string): Promise<ToolResultView | null> {
    const cached = this.cache.get(callId);
    if (cached) {
      return cached;
    }

    const row = await this.readRow(callId);
    if (!row) {
      return null;
    }

    const images: string[] = [];
    for (const name of parseImagePaths(row.imagePaths)) {
      try {
        const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
        const mimeType = MIME_BY_EXT[ext] ?? 'image/png';
        const data = await fs.readFile(join(await this.dir(), name));
        images.push(`data:${mimeType};base64,${data.toString('base64')}`);
      } catch (error) {
        console.error(`Tool-result image read failed for '${name}':`, error);
      }
    }

    const view: ToolResultView = {
      callId,
      tool: row.tool,
      status: row.status === 'error' ? 'error' : 'ok',
      text: row.text,
      images,
    };
    this.cache.put(callId, { tool: view.tool, status: view.status, text: view.text, images: view.images });
    return view;
  }

  async has(callId: string): Promise<boolean> {
    if (this.cache.has(callId)) {
      return true;
    }
    const client = this.client();
    if (!client) {
      return false;
    }
    try {
      const count = await client.toolResult.count({ where: { id: callId } });
      return count > 0;
    } catch {
      return false;
    }
  }

  /** Recent image-bearing results for a conversation — the recall index. */
  async listForConversation(
    conversationId: string,
    limit = 10
  ): Promise<{ id: string; tool: string; createdAt: Date }[]> {
    const client = this.client();
    if (!client) {
      return [];
    }
    try {
      const rows = await client.toolResult.findMany({
        where: { conversationId, imagePaths: { not: Prisma.DbNull } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: { id: true, tool: true, createdAt: true },
      });
      return rows.map((row) => ({ id: row.id, tool: row.tool, createdAt: row.createdAt }));
    } catch (error) {
      console.error('Tool-result index read failed:', error);
      return [];
    }
  }

  async prune(maxAgeMs: number = DEFAULT_PRUNE_MAX_AGE_MS): Promise<void> {
    const client = this.client();
    if (!client) {
      return;
    }
    const cutoff = new Date(Date.now() - maxAgeMs);
    try {
      const stale = await client.toolResult.findMany({
        where: { createdAt: { lt: cutoff } },
        select: { id: true, imagePaths: true },
      });
      for (const row of stale) {
        for (const name of parseImagePaths(row.imagePaths)) {
          await fs.rm(join(await this.dir(), name), { force: true }).catch(() => undefined);
        }
        await client.toolResult.delete({ where: { id: row.id } }).catch(() => undefined);
      }
    } catch (error) {
      console.error('Tool-result prune failed:', error);
    }
  }

  private async readRow(callId: string): Promise<PrismaToolResult | null> {
    const client = this.client();
    if (!client) {
      return null;
    }
    try {
      return await client.toolResult.findUnique({ where: { id: callId } });
    } catch (error) {
      console.error('Tool-result read failed:', error);
      return null;
    }
  }
}

let clientProvider: (() => PrismaClient | null) | null = null;
let shared: ToolResultService | null = null;

/** Wired once at boot (ipc-handlers), mirroring the memory service provider. */
export function setToolResultClientProvider(provider: (() => PrismaClient | null) | null): void {
  clientProvider = provider;
  shared = null;
}

/**
 * Shared instance for tool/IPC call sites. Degrades to a memory-only
 * store (no DB, no files) when the database is not wired yet, so a
 * missing provider can never break a running turn.
 */
export function getToolResultService(): ToolResultService {
  if (!shared) {
    if (!clientProvider) {
      console.warn('Tool-result store is memory-only (database not wired yet).');
      shared = new ToolResultService(() => null);
    } else {
      shared = new ToolResultService(clientProvider);
    }
  }
  return shared;
}
