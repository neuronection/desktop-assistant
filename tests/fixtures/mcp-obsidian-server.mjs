#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function buildObsidianServer() {
  const server = new McpServer({ name: 'obsidian', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('list_notes', 'List notes.');
  register('search_notes', 'Search notes.', { query: z.string() });
  register('read_note', 'Read a note.', { path: z.string() });
  register('create_note', 'Create a note.', { path: z.string(), content: z.string() });
  register('append_to_note', 'Append to a note.', { path: z.string(), content: z.string() });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildObsidianServer().connect(new StdioServerTransport());
}
