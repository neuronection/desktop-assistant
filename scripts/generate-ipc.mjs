import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'node_modules', '.tmp', 'ipc-codegen');

async function transpile(sourcePath, outName, rewrite = []) {
  let source = await readFile(sourcePath, 'utf8');
  for (const [from, to] of rewrite) {
    source = source.replaceAll(from, to);
  }
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: sourcePath,
  }).outputText;
  const outPath = join(outDir, outName);
  await writeFile(outPath, output);
  return outPath;
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await transpile(join(root, 'src/shared/ipc/registry.ts'), 'registry.mjs');
const docsPath = await transpile(join(root, 'src/shared/ipc/docs.ts'), 'docs.mjs', [
  ["from './registry'", "from './registry.mjs'"],
]);
const { renderIpcDocs } = await import(pathToFileURL(docsPath).href);
await writeFile(join(root, 'docs/dev/ipc.md'), renderIpcDocs());
console.log('generated docs/dev/ipc.md');
