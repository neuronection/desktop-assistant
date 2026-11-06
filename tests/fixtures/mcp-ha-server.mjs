#!/usr/bin/env node
/**
 * Home-Assistant-shaped MCP fixture (plan 15 S4): the same surface served
 * over stdio (`mcp-ha-stdio-server.mjs`) and streamable HTTP
 * (`mcp-ha-http-server.mjs`). Kept separate from the plan-11 fixture —
 * its tool-name tables are asserted verbatim.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const DEVICES = {
  'light.kitchen': { state: 'on', brightness: 80 },
  'light.bedroom': { state: 'off' },
  'lock.front_door': { state: 'locked' },
};

export function buildHaServer() {
  const server = new McpServer({ name: 'homeassistant', version: '1.0.0' });

  server.registerTool(
    'get_status',
    {
      description: 'Gets the current state of one device by entity id.',
      inputSchema: { entity_id: z.string() },
    },
    async ({ entity_id }) => ({
      content: [{ type: 'text', text: JSON.stringify({ entity_id, ...(DEVICES[entity_id] ?? { state: 'unknown' }) }) }],
    })
  );

  server.registerTool(
    'list_devices',
    {
      description: 'Lists every device entity id visible to this connection.',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(Object.keys(DEVICES)) }],
    })
  );

  server.registerTool(
    'get_available_devices',
    {
      description: 'Lists device entities grouped by domain.',
      inputSchema: {},
    },
    async () => ({
      content: [{ type: 'text', text: JSON.stringify({ devices: Object.keys(DEVICES) }) }],
    })
  );

  server.registerTool(
    'filter_devices',
    {
      description: 'Lists device entity ids under one domain prefix.',
      inputSchema: { domain: z.string() },
    },
    async ({ domain }) => ({
      content: [
        { type: 'text', text: JSON.stringify(Object.keys(DEVICES).filter((id) => id.startsWith(`${domain}.`))) },
      ],
    })
  );

  server.registerTool(
    'control',
    {
      description: 'Controls a device: turn_on, turn_off or toggle.',
      inputSchema: { entity_id: z.string(), action: z.string() },
    },
    async ({ entity_id, action }) => {
      if (!DEVICES[entity_id]) {
        return { content: [{ type: 'text', text: `unknown entity: ${entity_id}` }] };
      }
      if (action === 'turn_on') {
        DEVICES[entity_id].state = 'on';
      } else if (action === 'turn_off') {
        DEVICES[entity_id].state = 'off';
      }
      return { content: [{ type: 'text', text: `${entity_id} → ${DEVICES[entity_id].state}` }] };
    }
  );

  server.registerResource(
    'automation-docs',
    'ha://docs/automation',
    { title: 'Automation guide', description: 'How automations work in this fixture.', mimeType: 'text/markdown' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: '# Automations\n\nA fixture document about automations.' }],
    })
  );

  server.registerResource(
    'device-schema',
    'ha://schema/device',
    { title: 'Device schema', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify({ entity_id: 'string', state: 'string' }) }],
    })
  );

  server.registerPrompt(
    'summarize_device',
    {
      title: 'Summarize a device',
      description: 'Summarizes the current state of one device.',
      argsSchema: { entity: z.string().describe('Entity id to summarize') },
    },
    ({ entity }) => ({
      messages: [
        { role: 'user', content: { type: 'text', text: `Summarize the current state of ${entity}.` } },
      ],
    })
  );

  return server;
}
