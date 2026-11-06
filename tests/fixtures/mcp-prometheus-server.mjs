#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
export function buildPrometheusServer() {
  const server = new McpServer({ name: 'prometheus', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({ content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }] }));
  register('query', 'Instant query.', { query: z.string() });
  register('query_range', 'Range query.', { query: z.string() });
  register('list_alerts', 'List alerts.');
  register('list_targets', 'List targets.');
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) await buildPrometheusServer().connect(new StdioServerTransport());
