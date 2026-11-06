#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function buildJellyfinServer() {
  const server = new McpServer({ name: 'jellyfin', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('list_libraries', 'List libraries.');
  register('search_media', 'Search media.', { query: z.string() });
  register('get_item', 'Read an item.', { item_id: z.string() });
  register('mark_played', 'Mark played.', { item_id: z.string() });
  register('mark_unplayed', 'Mark unplayed.', { item_id: z.string() });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildJellyfinServer().connect(new StdioServerTransport());
}
