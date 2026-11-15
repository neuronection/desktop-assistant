#!/usr/bin/env node
// Assert a packed Electron artifact carries the native modules its target
// needs. `@libsql/*` ships one prebuilt binary per OS/CPU and is installed
// only for the build HOST, so a cross-built arch silently loses its binary
// and dies at the first database open (never at build time).
//
// Usage: node scripts/assert-packed-arch.mjs <app.asar> <path>... [--search <needle>]
import { readFileSync } from 'node:fs';

const [asarPath, ...rest] = process.argv.slice(2);
const searchIndex = rest.indexOf('--search');
const needles = (searchIndex === -1 ? rest : rest.slice(0, searchIndex)).filter(Boolean);
const extra = searchIndex === -1 ? [] : rest.slice(searchIndex + 1);

if (!asarPath || needles.length === 0) {
  console.error('usage: assert-packed-arch.mjs <app.asar> <path>... [--search <needle>]');
  process.exit(2);
}

const bytes = readFileSync(asarPath);

function packedPaths() {
  try {
    const jsonSize = bytes.readUInt32LE(12);
    const header = JSON.parse(bytes.subarray(16, 16 + jsonSize).toString('utf8'));
    const found = new Set();
    const walk = (node, prefix) => {
      for (const [name, child] of Object.entries(node.files ?? {})) {
        const path = prefix ? `${prefix}/${name}` : name;
        found.add(path);
        if (child.files) {
          walk(child, path);
        }
      }
    };
    walk(header, '');
    return found;
  } catch {
    return null;
  }
}

const paths = packedPaths();

function present(needle) {
  const normalised = needle.replace(/^\/+/, '');
  if (paths && paths.size > 0) {
    if (paths.has(normalised)) {
      return true;
    }
    return [...paths].some((path) => path.startsWith(`${normalised}/`));
  }
  return bytes.includes(normalised);
}

const missing = needles.filter((needle) => !present(needle));
const extraMissing = extra.filter((needle) => !present(needle));

for (const needle of needles) {
  console.log(`${missing.includes(needle) ? 'MISSING' : 'ok     '} ${needle}`);
}
for (const needle of extra) {
  console.log(`${extraMissing.includes(needle) ? 'MISSING' : 'ok     '} ${needle} (search)`);
}

if (missing.length > 0 || extraMissing.length > 0) {
  console.error(
    `assert-packed-arch: ${asarPath} is missing ${[...missing, ...extraMissing].join(', ')} ` +
      `— install that arch's prebuilt module before packaging`
  );
  process.exit(1);
}
