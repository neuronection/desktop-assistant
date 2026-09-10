import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, stat, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { listDirTool } from '@main/ai/tools/native/list-dir';
import { readFileTool } from '@main/ai/tools/native/read-file';
import { fileWriteTool } from '@main/ai/tools/native/file-write';
import { fileCreateTool } from '@main/ai/tools/native/file-create';
import { fileMoveTool } from '@main/ai/tools/native/file-move';
import { openPathTool } from '@main/ai/tools/native/open-path';
import { openUrlTool } from '@main/ai/tools/native/open-url';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'da-tools-'));
  await mkdir(join(root, 'sub'), { recursive: true });
  await writeFile(join(root, 'notes.txt'), 'hello world', 'utf-8');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const ctx = (grantedRoots: string[]) => ({ grantedRoots });

describe('granted-root file tools', () => {
  it('list_dir lists inside a granted root and refuses outside paths', async () => {
    const inside = await listDirTool.exec({ path: root }, ctx([root]));
    expect(inside).toContain('notes.txt');
    expect(inside).toContain('d ');

    const outside = await listDirTool.exec({ path: '/etc' }, ctx([root]));
    expect(outside).toContain('Error:');
    expect(outside).toContain('was not granted');
  });

  it('list_dir supports depth', async () => {
    await writeFile(join(root, 'sub', 'deep.txt'), 'x', 'utf-8');
    const shallow = await listDirTool.exec({ path: root }, ctx([root]));
    expect(shallow).not.toContain('deep.txt');
    const deep = await listDirTool.exec({ path: root, depth: 2 }, ctx([root]));
    expect(deep).toContain('deep.txt');
  });

  it('read_file reads text inside roots and refuses outside/binary/missing', async () => {
    const text = await readFileTool.exec({ path: join(root, 'notes.txt') }, ctx([root]));
    expect(text).toContain('hello world');

    expect(await readFileTool.exec({ path: '/etc/passwd' }, ctx([root]))).toMatch(/^Error:/);
    expect(await readFileTool.exec({ path: join(root, 'missing.txt') }, ctx([root]))).toMatch(/^Error:/);

    const binaryPath = join(root, 'blob.bin');
    await writeFile(binaryPath, Buffer.from([0x00, 0x01, 0x02]));
    expect(await readFileTool.exec({ path: binaryPath }, ctx([root]))).toContain('binary');
  });

  it('file_write creates parents and appends within roots only', async () => {
    const target = join(root, 'sub', 'new.txt');
    const result = await fileWriteTool.exec({ path: target, content: 'a' }, ctx([root]));
    expect(result).toContain('Wrote');
    expect(await readFile(target, 'utf-8')).toBe('a');

    const appended = await fileWriteTool.exec({ path: target, content: 'b', append: true }, ctx([root]));
    expect(appended).toContain('Appended');
    expect(await readFile(target, 'utf-8')).toBe('ab');

    const outside = await fileWriteTool.exec({ path: '/tmp/da-escape.txt', content: 'x' }, ctx([root]));
    expect(outside).toMatch(/^Error:/);
    await expect(stat('/tmp/da-escape.txt')).rejects.toThrow();
  });

  it('file_create fails when the file exists', async () => {
    const target = join(root, 'created.txt');
    expect(await fileCreateTool.exec({ path: target, content: 'x' }, ctx([root]))).toContain('Created');
    expect(await fileCreateTool.exec({ path: target, content: 'y' }, ctx([root]))).toContain('already exists');
  });

  it('file_move moves within roots and refuses bad destinations', async () => {
    const from = join(root, 'created.txt');
    const to = join(root, 'sub', 'renamed.txt');
    expect(await fileMoveTool.exec({ from, to }, ctx([root]))).toContain('Moved');
    expect((await stat(to)).isFile()).toBe(true);

    expect(await fileMoveTool.exec({ from: to, to: '/tmp/da-move-escape' }, ctx([root]))).toMatch(/^Error:/);
    expect(await fileMoveTool.exec({ from: join(root, 'nope.txt'), to: join(root, 'x') }, ctx([root]))).toContain(
      'does not exist'
    );
  });

  it('open_path refuses files outside granted roots and executables', async () => {
    const script = join(root, 'run.sh');
    await writeFile(script, '#!/bin/sh\necho hi', 'utf-8');
    expect(await openPathTool.exec({ path: join(root, 'notes.txt') }, ctx([]))).toContain('was not granted');
    expect(await openPathTool.exec({ path: script }, ctx([root]))).toContain('executable');
    expect(await openPathTool.exec({ path: join(root, 'missing.txt') }, ctx([root]))).toContain('does not exist');
  });

  it('open_url rejects non-http protocols and invalid URLs', async () => {
    expect(await openUrlTool.exec({ url: 'file:///etc/passwd' }, {})).toContain('not allowed');
    expect(await openUrlTool.exec({ url: 'javascript:alert(1)' }, {})).toContain('not allowed');
    expect(await openUrlTool.exec({ url: 'not-a-url' }, {})).toContain('not a valid URL');
  });
});
