#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
export function buildGitlabServer() {
  const server = new McpServer({ name: 'gitlab', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({ content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }] }));
  register('search_projects', 'Search projects.', { query: z.string() });
  register('get_file', 'Read a file.', { path: z.string() });
  register('list_issues', 'List issues.');
  register('list_merge_requests', 'List merge requests.');
  register('create_issue', 'Create an issue.', { title: z.string() });
  register('add_comment', 'Comment.', { body: z.string() });
  return server;
}
if (import.meta.url === `file://${process.argv[1]}`) await buildGitlabServer().connect(new StdioServerTransport());
