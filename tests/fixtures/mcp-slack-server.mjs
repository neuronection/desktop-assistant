#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
export function buildSlackServer() {
  const server = new McpServer({ name: 'slack', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({ content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }] }));
  register('list_channels', 'List channels.');
  register('get_channel_history', 'Read channel history.', { channel: z.string() });
  register('search_messages', 'Search messages.', { query: z.string() });
  register('post_message', 'Post a message.', { channel: z.string(), text: z.string() });
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) await buildSlackServer().connect(new StdioServerTransport());
