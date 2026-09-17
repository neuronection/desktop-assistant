#!/usr/bin/env node
import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildHaServer } from './mcp-ha-server.mjs';

const port = Number(process.env.HA_FIXTURE_PORT ?? 0);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID().replace(/-/g, ''),
  enableJsonResponse: true,
});
await buildHaServer().connect(transport);

let queue = Promise.resolve();

const server = createServer(async (req, res) => {
  if (!req.url?.startsWith('/mcp')) {
    res.writeHead(404).end();
    return;
  }
  if (req.method === 'GET' || req.method === 'DELETE') {
    await transport.handleRequest(req, res);
    return;
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  const message = JSON.parse(body);
  queue = queue
    .then(async () => {
      await transport.handleRequest(req, res, message);
    })
    .catch((error) => {
      console.error('fixture error:', error);
      if (!res.headersSent) {
        res.writeHead(400).end();
      }
    });
  await queue;
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`HA fixture listening on ${JSON.stringify(server.address())}\n`);
});
