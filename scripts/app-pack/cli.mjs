#!/usr/bin/env node
// app-pack CLI runner (plan 26 S1): `npm run app-pack -- init | validate`.
// Bundles the shared validator with esbuild first — ONE validator, same
// code the runtime uses (ADR-0029 clause 11); this file never re-implements it.

import { build } from 'vite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = resolve(import.meta.dirname, '..', '..');

async function loadCore() {
  const dir = mkdtempSync(join(tmpdir(), 'app-pack-cli-'));
  const outfile = join(dir, 'cli-core.mjs');
  try {
    await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: true,
        outDir: dir,
        lib: {
          entry: join(repo, 'src/shared/app-pack/cli-core.ts'),
          formats: ['es'],
          fileName: () => 'cli-core.mjs',
        },
        rollupOptions: { output: { codeSplitting: false } },
      },
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function usage() {
  console.log(`usage:
  app-pack init [dir] [--id <pack-id>] [--title <title>]   scaffold mini-app-pack.json
  app-pack validate <file> [--bundled]                     validate a pack manifest`);
}

const [command, ...rest] = process.argv.slice(2);
if (!command) {
  usage();
  process.exit(2);
}

const core = await loadCore();

if (command === 'init') {
  const dir = rest[0] && !rest[0].startsWith('--') ? rest[0] : '.';
  const idIndex = rest.indexOf('--id');
  const titleIndex = rest.indexOf('--title');
  const id = idIndex >= 0 ? rest[idIndex + 1] : 'my-mini-app';
  const title = titleIndex >= 0 ? rest[titleIndex + 1] : undefined;
  const target = resolve(process.cwd(), dir, 'mini-app-pack.json');
  writeFileSync(target, core.initTemplate({ id, title }), 'utf8');
  console.log(`app-pack: wrote ${target} (validate it: npm run app-pack -- validate ${target})`);
  process.exit(0);
}

if (command === 'validate') {
  const file = rest[0];
  if (!file) {
    usage();
    process.exit(2);
  }
  const bundled = rest.includes('--bundled');
  let content;
  try {
    content = readFileSync(resolve(process.cwd(), file), 'utf8');
  } catch {
    console.error(`app-pack: cannot read ${file}`);
    process.exit(2);
  }
  const result = core.validatePackFileContent(content, { bundled });
  if (result.ok) {
    const { manifest } = result.pack;
    console.log(`OK ${manifest.id}@${manifest.version} (${manifest.kind}; capabilities: ${manifest.capabilities.join(', ')})`);
    process.exit(0);
  }
  console.error(`INVALID — ${result.issues.length} issue(s):`);
  for (const issue of result.issues) {
    console.error(`  ${issue.path}: ${issue.message} [${issue.code}]`);
  }
  process.exit(1);
}

usage();
process.exit(2);
