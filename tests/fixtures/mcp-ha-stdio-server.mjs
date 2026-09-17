#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildHaServer } from './mcp-ha-server.mjs';

const transport = new StdioServerTransport();
await buildHaServer().connect(transport);
