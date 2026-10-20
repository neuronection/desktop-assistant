#!/usr/bin/env node
// Demo assistant service (family demo-tour standard) — a tiny local
// OpenAI-compatible chat endpoint so demo turns stream real UI states
// (thinking, tool call, answer) without a provider, key or network.
//
// Started by scripts/ui-capture/run-demo-capture.sh; the demo instance's
// config provisions the `demo-local` provider at this port. Scripted
// answers are synthetic demo content: one plain reply, one title reply,
// and a web_search tool call answered from the mock SearXNG service.
//
//   node scripts/ui-capture/mock-assistant.mjs              # port 8334
//   MOCK_ASSISTANT_PORT=9000 node scripts/ui-capture/mock-assistant.mjs

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_ASSISTANT_PORT ?? 8334);
const MODEL = 'demo-assistant';
const TITLE_HINT = 'generate a concise conversation title';
const SEARCH_HINT = /gnome|release notes|what.s new|latest/i;

const ANSWERS = {
  screenshot:
    'Use the Share screen button next to the microphone.\n\n' +
    'Pick a window, a region or the whole screen — the capture is attached to your next message, ' +
    'so you can ask about it right away.',
  search:
    'GNOME 49 is out.\n\n' +
    'The release notes cover accessibility, performance and settings work, plus a refreshed set of ' +
    'core apps.\n\n' +
    'Sources:\n' +
    '1. [GNOME 49 release notes](https://release.gnome.org/49/)\n' +
    '2. [GNOME 49 announcement](https://www.gnome.org/news/)\n' +
    '3. [GNOME 49 on Flathub](https://flathub.org/)',
  fallback: 'This is the local demo model. I can chat, search the web, and use the tools you approve.',
  title: 'Screenshot help',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function lastUserText(messages) {
  return [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
}

function plan(body) {
  const messages = body.messages ?? [];
  const system = messages.map((m) => (m.role === 'system' ? String(m.content) : '')).join(' \n ');
  const text = String(lastUserText(messages));
  const hasWebSearch = (body.tools ?? []).some((tool) => tool?.function?.name === 'web_search');
  const sawToolResult = messages.some((message) => message.role === 'tool');

  if (system.toLowerCase().includes(TITLE_HINT)) {
    return { kind: 'text', text: ANSWERS.title };
  }
  if (sawToolResult) {
    return { kind: 'text', text: ANSWERS.search, slow: true };
  }
  if (hasWebSearch && SEARCH_HINT.test(text)) {
    return { kind: 'tool', name: 'web_search', args: { query: 'GNOME 49 release notes' } };
  }
  if (/screenshot/i.test(text)) {
    return { kind: 'text', text: ANSWERS.screenshot };
  }
  return { kind: 'text', text: ANSWERS.fallback };
}

function chunk(delta, finish = null) {
  return {
    id: 'chatcmpl-demo',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  };
}

function writeChunk(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function streamCompletion(res, planValue) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  await sleep(planValue.slow ? 800 : 1200);
  if (planValue.kind === 'tool') {
    writeChunk(res, chunk({
      role: 'assistant',
      tool_calls: [{
        index: 0,
        id: 'call_demo_search',
        type: 'function',
        function: { name: planValue.name, arguments: JSON.stringify(planValue.args) },
      }],
    }));
    writeChunk(res, chunk({}, 'tool_calls'));
    res.end('data: [DONE]\n\n');
    return;
  }
  const parts = String(planValue.text).split(/(\s+)/);
  const pauseAt = planValue.slow ? -1 : String(planValue.text).indexOf('\n\n');
  let chars = 0;
  let paused = false;
  for (let index = 0; index < parts.length; index += 1) {
    if (index > 0) await sleep(18);
    writeChunk(res, chunk(index === 0 ? { role: 'assistant', content: parts[index] } : { content: parts[index] }));
    chars += parts[index].length;
    // Storyboard pause: let the launcher finish growing for the partial
    // answer so a mid-stream frame is captured cleanly, then continue.
    if (!paused && pauseAt > 0 && chars >= pauseAt) {
      paused = true;
      await sleep(1600);
    }
  }
  writeChunk(res, {
    ...chunk({}, 'stop'),
    usage: { prompt_tokens: 42, completion_tokens: 27, total_tokens: 69 },
  });
  res.end('data: [DONE]\n\n');
}

async function completion(res, planValue) {
  await sleep(300);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (planValue.kind === 'tool') {
    res.end(JSON.stringify({
      id: 'chatcmpl-demo',
      object: 'chat.completion',
      created: 1_700_000_000,
      model: MODEL,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_demo_search',
            type: 'function',
            function: { name: planValue.name, arguments: JSON.stringify(planValue.args) },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
    return;
  }
  res.end(JSON.stringify({
    id: 'chatcmpl-demo',
    object: 'chat.completion',
    created: 1_700_000_000,
    model: MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content: planValue.text }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }));
}

createServer((req, res) => {
  if (req.method === 'GET' && req.url?.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: [{ id: MODEL, object: 'model', owned_by: 'demo', created: 1_700_000_000 }],
    }));
    return;
  }
  if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  let raw = '';
  req.on('data', (part) => {
    raw += part;
  });
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    const planValue = plan(body);
    if (body.stream) {
      void streamCompletion(res, planValue);
      return;
    }
    void completion(res, planValue);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`demo assistant service on http://127.0.0.1:${PORT}`);
});
