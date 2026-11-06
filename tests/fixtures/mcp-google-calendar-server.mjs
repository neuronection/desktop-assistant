#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function buildGoogleCalendarServer() {
  const server = new McpServer({ name: 'google-calendar', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('list_upcoming', 'List upcoming events.', { days: z.number().optional() });
  register('search_events', 'Search events.', { query: z.string() });
  register('create_event', 'Create an event.', { event_id: z.string(), title: z.string() });
  register('move_event', 'Move an event.', { event_id: z.string(), start: z.string() });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildGoogleCalendarServer().connect(new StdioServerTransport());
}
