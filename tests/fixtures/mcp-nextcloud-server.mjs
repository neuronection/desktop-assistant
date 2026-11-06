#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function buildNextcloudServer() {
  const server = new McpServer({ name: 'nextcloud', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('list_files', 'List a folder.', { path: z.string() });
  register('read_file', 'Read a file.', { path: z.string() });
  register('search_files', 'Search files.', { query: z.string() });
  register('upload_file', 'Upload a file.', { path: z.string(), content: z.string() });
  register('create_folder', 'Create a folder.', { path: z.string() });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildNextcloudServer().connect(new StdioServerTransport());
}
