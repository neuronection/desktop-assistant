#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function buildNotionServer() {
  const server = new McpServer({ name: 'notion', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('search_pages', 'Search pages.', { query: z.string() });
  register('read_page', 'Read a page.', { page: z.string() });
  register('read_database', 'Read a database.', { database: z.string() });
  register('create_page', 'Create a page.', { title: z.string() });
  register('update_page_blocks', 'Append blocks to a page.', { page: z.string(), blocks: z.array(z.string()) });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildNotionServer().connect(new StdioServerTransport());
}
