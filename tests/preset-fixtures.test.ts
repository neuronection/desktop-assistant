import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bundledPresetById } from '@shared/app-presets';

const FIXTURES: Array<{ id: string; file: string }> = [
  { id: 'github', file: 'mcp-github-server.mjs' },
  { id: 'google-calendar', file: 'mcp-google-calendar-server.mjs' },
  { id: 'obsidian', file: 'mcp-obsidian-server.mjs' },
  { id: 'notion', file: 'mcp-notion-server.mjs' },
  { id: 'spotify', file: 'mcp-spotify-server.mjs' },
];

describe('Tier-1 preset fixture servers (plan 39 W1)', () => {
  it.each(FIXTURES)('serves the preset tool surface for $id', async ({ id, file }) => {
    const client = new Client({ name: 'preset-fixture-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(__dirname, 'fixtures', file)],
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const names = new Set(listed.tools.map((tool) => tool.name));
      const preset = bundledPresetById(id)!;
      for (const domain of preset.toolDomains) {
        expect(names.has(domain.tool), `${id}: ${domain.tool}`).toBe(true);
      }
      expect(listed.tools.some((tool) => tool.name === 'rm_rf')).toBe(false);
    } finally {
      await client.close();
    }
  }, 20_000);
});
