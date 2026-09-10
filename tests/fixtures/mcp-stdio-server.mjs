#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'fixture', version: '1.0.0' });

server.registerTool(
  'echo_text',
  {
    description: 'Echoes the provided text back with a prefix.',
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({
    content: [{ type: 'text', text: `ECHO:${text}` }],
  })
);

server.registerTool(
  'reveal_env',
  {
    description: 'Reports whether the FIXTURE_TOKEN environment variable is set, never its value.',
    inputSchema: {},
  },
  async () => ({
    content: [{ type: 'text', text: process.env.FIXTURE_TOKEN ? 'token-present' : 'token-absent' }],
  })
);

server.registerTool(
  'slow_tool',
  {
    description: 'Sleeps for two seconds before responding (timeout fixture).',
    inputSchema: {},
  },
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return { content: [{ type: 'text', text: 'finally done' }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
