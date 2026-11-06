import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const artifact = join(root, 'dist', 'preload', 'preload.generated.js');

let source;
try {
  source = await readFile(artifact, 'utf8');
} catch {
  console.error(`missing preload artifact: ${artifact} — run \`npm run build:main\` first`);
  process.exit(1);
}

const code = source.replace(/^[ \t]*\/\/[^\n]*$/gm, '');
const specifiers = [...code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]);
const external = specifiers.filter((specifier) => specifier !== 'electron');
const dynamicImport = /\bimport\s*\(/.test(code);

if (external.length > 0) {
  console.error(`preload requires modules a sandboxed preload cannot load: ${external.join(', ')}`);
  console.error('keep src/preload single-file — only `electron` may be required (window.electronAPI dies otherwise)');
  process.exit(1);
}

if (dynamicImport) {
  console.error('preload uses a dynamic import — sandboxed preloads may not');
  process.exit(1);
}

if (!/exposeInMainWorld\(\s*['"]electronAPI['"]/.test(source)) {
  console.error('preload never exposes window.electronAPI');
  process.exit(1);
}

console.log(`preload is sandbox-safe: ${specifiers.length} require('electron') only`);
