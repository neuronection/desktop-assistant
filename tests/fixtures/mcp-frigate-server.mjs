#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function buildFrigateServer() {
  const server = new McpServer({ name: 'frigate', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('list_cameras', 'List cameras.');
  register('get_events', 'Read detection events.');
  server.registerTool(
    'get_snapshot',
    { description: 'Return the latest camera snapshot as image content.', inputSchema: { camera: z.string() } },
    async (args) => ({
      content: [
        { type: 'text', text: 'Snapshot captured.' },
        { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' },
      ],
    })
  );
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildFrigateServer().connect(new StdioServerTransport());
}
