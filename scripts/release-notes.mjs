#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const version = process.argv[2];
if (!version) {
  console.error('usage: release-notes.mjs <version> [--file CHANGELOG.md]');
  process.exit(2);
}
const fileIndex = process.argv.indexOf('--file');
const file = fileIndex === -1 ? 'CHANGELOG.md' : process.argv[fileIndex + 1];
const base = version.split('-rc.')[0];

const lines = readFileSync(file, 'utf8').split('\n');
const start = [version, base]
  .map((candidate) => lines.findIndex((line) => line.startsWith(`## [${candidate}]`)))
  .find((index) => index !== undefined && index !== -1);

if (start === undefined) {
  console.error(`${file} has no "## [${version}]" (or "## [${base}]") section`);
  process.exit(1);
}

let end = lines.length;
for (let index = start + 1; index < lines.length; index += 1) {
  if (lines[index].startsWith('## [')) {
    end = index;
    break;
  }
}

const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) {
  console.error(`the ${version} section of ${file} is empty`);
  process.exit(1);
}
process.stdout.write(`${body}\n`);
