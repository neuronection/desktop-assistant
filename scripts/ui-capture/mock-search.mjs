#!/usr/bin/env node
// Demo search service (family demo-tour standard) — a tiny local
// SearXNG-compatible JSON endpoint so the web_search tool returns
// deterministic demo results without a search provider or key.
//
// Started by scripts/ui-capture/run-demo-capture.sh; the demo instance's
// config provisions the `demo-search` searxng provider at this port.
//
//   node scripts/ui-capture/mock-search.mjs              # port 8335
//   MOCK_SEARCH_PORT=9001 node scripts/ui-capture/mock-search.mjs

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_SEARCH_PORT ?? 8335);

const RESULTS = {
  'gnome 49 release notes': [
    {
      title: 'GNOME 49 release notes',
      url: 'https://release.gnome.org/49/',
      content: 'Highlights from the GNOME 49 release: accessibility, performance and settings work.',
    },
    {
      title: 'GNOME 49 announcement',
      url: 'https://www.gnome.org/news/',
      content: 'The GNOME project announces version 49 and a refreshed set of core apps.',
    },
    {
      title: 'GNOME 49 on Flathub',
      url: 'https://flathub.org/',
      content: 'Install the GNOME 49 apps from Flathub — sandboxed and updated independently.',
    },
  ],
};

const FALLBACK = [
  {
    title: 'Demo search result',
    url: 'https://example.org/demo-result',
    content: 'Synthetic demo content served by the local mock search service.',
  },
];

function resultsFor(query) {
  const normalized = query.trim().toLowerCase();
  for (const [key, results] of Object.entries(RESULTS)) {
    if (normalized.includes(key.split(' ').slice(0, 2).join(' '))) {
      return results;
    }
  }
  return FALLBACK;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (req.method !== 'GET' || url.pathname !== '/search') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  const query = url.searchParams.get('q') ?? '';
  // A small delay keeps the tool step visible in the storyboard.
  setTimeout(() => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ query, results: resultsFor(query) }));
  }, 500);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`demo search service on http://127.0.0.1:${PORT}`);
});
