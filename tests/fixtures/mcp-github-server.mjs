#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export function buildGithubServer() {
  const server = new McpServer({ name: 'github', version: '1.0.0' });
  const register = (name, description, schema = {}) =>
    server.registerTool(name, { description, inputSchema: schema }, async (args) => ({
      content: [{ type: 'text', text: JSON.stringify({ tool: name, args }) }],
    }));
  register('search_repositories', 'Search repositories.', { query: z.string() });
  register('search_issues', 'Search issues and PRs.', { query: z.string() });
  register('get_file_contents', 'Read a repository file.', { path: z.string() });
  register('list_commits', 'List commits.', { repo: z.string() });
  register('get_issue', 'Read an issue.', { issue: z.string() });
  register('get_pull_request', 'Read a pull request.', { pull: z.string() });
  register('create_issue', 'Open an issue.', { title: z.string() });
  register('add_issue_comment', 'Comment on an issue.', { issue: z.string(), body: z.string() });
  register('create_pull_request', 'Open a pull request.', { title: z.string() });
  register('list_notifications', 'List notifications.');
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildGithubServer().connect(new StdioServerTransport());
}
