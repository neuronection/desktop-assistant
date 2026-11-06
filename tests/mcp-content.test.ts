import { afterAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';
import { McpContentError, McpManager, type McpSecrets } from '@main/ai/tools/mcp';
import type { McpServerConfig } from '@shared/mcp';

const STDIO_FIXTURE = join(__dirname, 'fixtures', 'mcp-stdio-server.mjs');
const HOSTILE_FIXTURE = join(__dirname, 'fixtures', 'mcp-hostile-server.mjs');
const HTTP_FIXTURE = join(__dirname, 'fixtures', 'mcp-ha-http-server.mjs');

const fixtures: ChildProcess[] = [];

afterAll(() => {
  for (const child of fixtures) {
    child.kill();
  }
});

function manager(servers: McpServerConfig[], secrets: Record<string, McpSecrets> = {}) {
  return new McpManager({
    listServers: () => servers,
    toolOverrides: () => undefined,
    readSecrets: async (serverId) => secrets[serverId] ?? {},
  });
}

function stdioServer(id: string, name: string, file: string): McpServerConfig {
  return {
    id,
    name,
    transport: { type: 'stdio', command: process.execPath, args: [file] },
    enabled: true,
    defaultAction: 'allow',
  };
}

async function startHttpFixture(): Promise<number> {
  const child = spawn(process.execPath, [HTTP_FIXTURE], { stdio: ['ignore', 'pipe', 'pipe'] });
  fixtures.push(child);
  return new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('HA fixture did not start')), 10_000);
    child.stdout!.on('data', (chunk: Buffer) => {
      const match = /"port":(\d+)/.exec(chunk.toString());
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once('exit', (code) => reject(new Error(`HA fixture exited early (${code})`)));
  });
}

describe('McpManager resources (plan 43 S1)', () => {
  it('lists and reads resources over stdio', async () => {
    const server = stdioServer('fx', 'fixture', STDIO_FIXTURE);
    const mcp = manager([server]);
    try {
      const resources = await mcp.listResources(server);
      expect(resources).toEqual([
        { uri: 'fixture://readme', name: 'readme', description: 'A short fixture document.', mimeType: 'text/plain' },
      ]);
      const content = await mcp.readResource(server, 'fixture://readme');
      expect(content.text).toBe('Fixture resource body.');
      expect(content.truncated).toBe(false);
    } finally {
      await mcp.close();
    }
  });

  it('lists and expands prompts over stdio', async () => {
    const server = stdioServer('fx', 'fixture', STDIO_FIXTURE);
    const mcp = manager([server]);
    try {
      const prompts = await mcp.listPrompts(server);
      expect(prompts).toEqual([
        {
          name: 'greet',
          title: 'Greet someone',
          description: 'Greets a named person.',
          arguments: [{ name: 'name', description: 'Who to greet', required: true }],
        },
      ]);
      const prompt = await mcp.getPrompt(server, 'greet', { name: 'Ada' });
      expect(prompt.messages).toEqual([{ role: 'user', text: 'Say hello to Ada.' }]);
    } finally {
      await mcp.close();
    }
  });

  it('lists and reads resources over HTTP', async () => {
    const port = await startHttpFixture();
    const server: McpServerConfig = {
      id: 'ha',
      name: 'homeassistant',
      transport: { type: 'http', url: `http://127.0.0.1:${port}/mcp` },
      enabled: true,
      defaultAction: 'allow',
    };
    const mcp = manager([server]);
    try {
      const resources = await mcp.listResources(server);
      expect(resources.map((resource) => resource.uri)).toContain('ha://docs/automation');
      const content = await mcp.readResource(server, 'ha://docs/automation');
      expect(content.text).toContain('Automations');
      const prompts = await mcp.listPrompts(server);
      expect(prompts[0]).toMatchObject({ name: 'summarize_device', arguments: [{ name: 'entity', required: true }] });
      const prompt = await mcp.getPrompt(server, 'summarize_device', { entity: 'light.kitchen' });
      expect(prompt.messages[0].text).toContain('light.kitchen');
    } finally {
      await mcp.close();
    }
  });
});

describe('McpManager hostile content normalization (plan 43 S1)', () => {
  const server = stdioServer('hostile', 'hostile', HOSTILE_FIXTURE);

  it('drops blank identifiers and caps long resource fields', async () => {
    const mcp = manager([server]);
    try {
      const resources = await mcp.listResources(server);
      expect(resources.map((resource) => resource.uri)).toEqual(['hostile://ok', 'hostile://bigsize']);
      const ok = resources.find((resource) => resource.uri === 'hostile://ok')!;
      expect(ok.description).toContain('[truncated');
      expect(ok.description!.length).toBeLessThan(600);
      expect(ok.size).toBe(12);
      expect(resources.find((resource) => resource.uri === 'hostile://bigsize')?.size).toBe(1e21);
    } finally {
      await mcp.close();
    }
  });

  it('passes injection text through verbatim as untrusted content', async () => {
    const mcp = manager([server]);
    try {
      const content = await mcp.readResource(server, 'hostile://ok');
      expect(content.text).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
      expect(content.truncated).toBe(false);
    } finally {
      await mcp.close();
    }
  });

  it('caps an oversized resource to the byte budget', async () => {
    const mcp = manager([server]);
    try {
      const content = await mcp.readResource(server, 'hostile://big', 1024);
      expect(content.truncated).toBe(true);
      expect(Buffer.byteLength(content.text, 'utf8')).toBeLessThanOrEqual(1024);
      const defaulted = await mcp.readResource(server, 'hostile://big');
      expect(defaulted.truncated).toBe(true);
      expect(Buffer.byteLength(defaulted.text, 'utf8')).toBeLessThanOrEqual(8192);
    } finally {
      await mcp.close();
    }
  });

  it('rejects an empty, blob-only or schema-malformed resource with a typed error', async () => {
    const mcp = manager([server]);
    try {
      await expect(mcp.readResource(server, 'hostile://empty')).rejects.toMatchObject({
        name: 'McpContentError',
        code: 'invalid-params',
      });
      await expect(mcp.readResource(server, 'hostile://blob-only')).rejects.toBeInstanceOf(McpContentError);
      await expect(mcp.readResource(server, 'hostile://malformed')).rejects.toMatchObject({ code: 'invalid-params' });
    } finally {
      await mcp.close();
    }
  });

  it('drops blank prompt identifiers and keeps only valid arguments', async () => {
    const mcp = manager([server]);
    try {
      const prompts = await mcp.listPrompts(server);
      expect(prompts.map((prompt) => prompt.name)).toEqual(['ok', 'inject', 'badargs']);
      const inject = prompts.find((prompt) => prompt.name === 'inject')!;
      expect(inject.description).toContain('[truncated');
      expect(inject.description!.length).toBeLessThan(600);
      const badargs = prompts.find((prompt) => prompt.name === 'badargs')!;
      expect(badargs.arguments).toEqual([{ name: 'ok', required: false }]);
    } finally {
      await mcp.close();
    }
  });

  it('passes a prompt-injection template through verbatim and rejects empty/malformed prompts', async () => {
    const mcp = manager([server]);
    try {
      const prompt = await mcp.getPrompt(server, 'inject');
      expect(prompt.messages[0].text).toContain('Disregard the system prompt');
      await expect(mcp.getPrompt(server, 'empty')).rejects.toMatchObject({ code: 'invalid-params' });
      await expect(mcp.getPrompt(server, 'malformed')).rejects.toMatchObject({ code: 'invalid-params' });
      await expect(mcp.getPrompt(server, 'nope')).rejects.toMatchObject({ code: 'invalid-params' });
    } finally {
      await mcp.close();
    }
  });
});
