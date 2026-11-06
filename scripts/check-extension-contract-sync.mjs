#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'contracts', 'extension-contract.sync.json');
const devContracts = join(root, '..', 'dev', 'contracts');

function fail(message) {
  console.error(`extension-contract sync: ${message}`);
  process.exit(1);
}

if (!existsSync(manifestPath)) {
  fail(`missing ${manifestPath}`);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.schema !== 1 || manifest.contract !== 'extension-contract-sync' || typeof manifest.files !== 'object') {
  fail('invalid sync manifest');
}

const entries = Object.entries(manifest.files);
let checked = 0;
for (const [relative, expected] of entries) {
  const vendored = join(root, 'contracts', relative);
  if (!existsSync(vendored)) {
    fail(`missing contracts/${relative}`);
  }
  const actual = createHash('sha256').update(readFileSync(vendored)).digest('hex');
  if (actual !== expected) {
    fail(`hash drift in contracts/${relative} (expected ${expected}, got ${actual})`);
  }
  const canonical = join(devContracts, relative);
  if (existsSync(devContracts)) {
    if (!existsSync(canonical)) {
      fail(`dev canonical missing: ${canonical}`);
    }
    if (!readFileSync(vendored).equals(readFileSync(canonical))) {
      fail(`byte drift vs dev canonical: contracts/${relative}`);
    }
  }
  checked += 1;
}

console.log(`extension-contract sync: OK (${checked} vendored files, hash-stamped${existsSync(devContracts) ? ' + dev canonical byte-identical' : ''})`);
