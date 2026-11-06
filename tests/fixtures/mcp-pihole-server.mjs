#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export function buildPiholeServer() {
  const server = new McpServer({ name: 'pihole', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('get_stats', 'Read blocking stats.');
  register('list_blocked', 'List blocked domains.');
  register('query_log', 'Read the query log.');
  register('enable_blocking', 'Enable blocking.');
  register('disable_blocking', 'Disable blocking.');
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildPiholeServer().connect(new StdioServerTransport());
}
