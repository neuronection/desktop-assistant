#!/usr/bin/env node
// Demo translate service (family demo-tour standard) — a tiny local
// LibreTranslate-compatible endpoint so the launcher's translate pad
// shows deterministic demo output without any external service or key.
//
// Started by the capture recipe (docs/dev/visual-tour.md); the demo
// instance's config points `translation.providers` at it.
//
//   node scripts/ui-capture/mock-translate.mjs            # port 8333
//   MOCK_TRANSLATE_PORT=9000 node scripts/ui-capture/mock-translate.mjs

import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_TRANSLATE_PORT ?? 8333);

/** Small deterministic phrasebook; unknown text falls back to a marked
 *  pseudo-translation so the demo never pretends to be a real engine. */
const PHRASES = {
  'where is the nearest train station?': {
    es: '¿Dónde está la estación de tren más cercana?',
    fr: 'Où est la gare la plus proche ?',
    de: 'Wo ist der nächste Bahnhof?',
    el: 'Πού είναι ο πλησιέστερος σιδηροδρομικός σταθμός;',
    it: 'Dov\'è la stazione ferroviaria più vicina?',
    tr: 'En yakın tren istasyonu nerede?',
  },
  'thank you for your help': {
    es: 'Gracias por tu ayuda',
    fr: 'Merci pour votre aide',
    de: 'Danke für deine Hilfe',
    el: 'Ευχαριστώ για τη βοήθειά σου',
    it: 'Grazie per il tuo aiuto',
    tr: 'Yardımın için teşekkürler',
  },
};

function translate(q, target) {
  const phrase = PHRASES[q.trim().toLowerCase()];
  const out = phrase?.[target];
  return out ?? `[${target}] ${q}`;
}

createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.endsWith('/translate')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    const q = String(payload.q ?? '');
    const target = String(payload.target ?? 'es').toLowerCase();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        translatedText: translate(q, target),
        detectedLanguage: { language: String(payload.source ?? 'auto') === 'auto' ? 'en' : payload.source },
      }),
    );
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`demo translate service on http://127.0.0.1:${PORT}`);
});
