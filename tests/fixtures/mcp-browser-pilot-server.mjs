#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
export function buildBrowserPilotServer() {
  const server = new McpServer({ name: 'browser-pilot', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({ content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }] }));
  register('snapshot', 'Page snapshot.');
  register('get_text', 'Read page text.');
  register('get_url', 'Read the URL.');
  register('screenshot', 'Take a screenshot.');
  register('navigate', 'Navigate.', { url: z.string() });
  register('click', 'Click an element.', { selector: z.string() });
  register('fill', 'Fill an input.', { selector: z.string(), value: z.string() });
  register('type', 'Type text.', { text: z.string() });
  register('press', 'Press a key.', { key: z.string() });
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) await buildBrowserPilotServer().connect(new StdioServerTransport());
