#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// Plan 23 S5 fixture: a minimal Home-Assistant-shaped MCP context server —
// one no-arg read-only tool whose payload the HA digest provider parses.

const server = new McpServer({ name: 'ha-context-fixture', version: '1.0.0' });

server.registerTool(
  'HassGetLiveContext',
  {
    description: 'Returns the live state context for the whole home.',
    inputSchema: {},
  },
  async () => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          states: [
            { entity_id: 'light.office', attributes: { friendly_name: 'Γραφείο' } },
            { entity_id: 'light.bedroom', friendly_name: 'Bedroom Light' },
            { entity_id: 'switch.plug', name: 'Desk plug' },
            { entity_id: 'climate.living_room', attributes: { friendly_name: 'Living room thermostat' } },
          ],
        }),
      },
    ],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
