#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function buildQbittorrentServer() {
  const server = new McpServer({ name: 'qbittorrent', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('list_torrents', 'List torrents.');
  register('get_torrent', 'Read a torrent.', { hash: z.string() });
  register('get_transfer_info', 'Read transfer state.');
  register('add_torrent', 'Add a torrent.', { url: z.string() });
  register('pause_torrent', 'Pause a torrent.', { hash: z.string() });
  register('resume_torrent', 'Resume a torrent.', { hash: z.string() });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildQbittorrentServer().connect(new StdioServerTransport());
}
