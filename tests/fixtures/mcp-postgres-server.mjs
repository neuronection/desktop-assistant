#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
export function buildPostgresServer() {
  const server = new McpServer({ name: 'postgres-insights', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({ content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }] }));
  register('list_schemas', 'List schemas.');
  register('list_tables', 'List tables.');
  register('describe_table', 'Describe a table.', { table: z.string() });
  register('query', 'Run a SELECT query.', { sql: z.string() });
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) await buildPostgresServer().connect(new StdioServerTransport());
