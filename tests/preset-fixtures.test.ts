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
  { id: 'nextcloud', file: 'mcp-nextcloud-server.mjs' },
  { id: 'jellyfin', file: 'mcp-jellyfin-server.mjs' },
  { id: 'qbittorrent', file: 'mcp-qbittorrent-server.mjs' },
  { id: 'pihole', file: 'mcp-pihole-server.mjs' },
  { id: 'frigate', file: 'mcp-frigate-server.mjs' },
  { id: 'slack', file: 'mcp-slack-server.mjs' },
  { id: 'discord', file: 'mcp-discord-server.mjs' },
  { id: 'gitlab', file: 'mcp-gitlab-server.mjs' },
  { id: 'postgres-insights', file: 'mcp-postgres-server.mjs' },
  { id: 'prometheus', file: 'mcp-prometheus-server.mjs' },
  { id: 'todoist', file: 'mcp-todoist-server.mjs' },
  { id: 'browser-pilot', file: 'mcp-browser-pilot-server.mjs' },
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

  it('returns Frigate snapshot image content for the vision-task path', async () => {
    const client = new Client({ name: 'preset-fixture-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(__dirname, 'fixtures', 'mcp-frigate-server.mjs')],
    });
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: 'get_snapshot', arguments: { camera: 'driveway' } });
      const content = result.content as Array<{ type: string; data?: string; mimeType?: string }>;
      expect(content.some((entry) => entry.type === 'image' && entry.mimeType === 'image/jpeg' && entry.data === 'QUJD')).toBe(true);
    } finally {
      await client.close();
    }
  }, 20_000);
});
