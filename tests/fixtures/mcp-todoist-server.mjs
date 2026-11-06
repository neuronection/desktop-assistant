#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
export function buildTodoistServer() {
  const server = new McpServer({ name: 'todoist', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({ content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }] }));
  register('list_projects', 'List projects.');
  register('list_tasks', 'List tasks.');
  register('search_tasks', 'Search tasks.', { query: z.string() });
  register('create_task', 'Create a task.', { content: z.string() });
  register('complete_task', 'Complete a task.', { task_id: z.string() });
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) await buildTodoistServer().connect(new StdioServerTransport());
