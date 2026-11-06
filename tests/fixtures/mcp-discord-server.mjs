#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
export function buildDiscordServer() {
  const server = new McpServer({ name: 'discord', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({ content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }] }));
  register('list_guilds', 'List guilds.');
  register('read_messages', 'Read messages.', { channel: z.string() });
  register('search_messages', 'Search messages.', { query: z.string() });
  register('send_message', 'Send a message.', { channel: z.string(), text: z.string() });
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) await buildDiscordServer().connect(new StdioServerTransport());
