import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat, writeFile, mkdir, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { downloadFileTool, resolveCollision, sanitizeFilename, DOWNLOAD_TOOL_NAME } from '@main/ai/tools/native/download-file';
import { downloads, type DownloadProgress } from '@main/ai/tools/downloads';
import { extractArtifactMarker } from '@shared/artifacts';

const root = (): string => join(tmpdir(), `da-downloads-${Math.random().toString(36).slice(2)}`);

function chunkStream(chunks: Uint8Array[], hangOn?: AbortSignal): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]);
        index += 1;
        return;
      }
      if (hangOn) {
        return new Promise((_resolve, reject) => {
          hangOn.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      }
      controller.close();
    },
  });
}

function bodyResponse(body: ReadableStream<Uint8Array> | null, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(body, { status, headers });
}

let lastProgress: DownloadProgress[] = [];

beforeEach(() => {
  downloads.reset();
  lastProgress = [];
  downloads.subscribe((event) => lastProgress.push(event));
});

afterEach(() => {
  downloads.reset();
  vi.unstubAllGlobals();
});

describe('sanitizeFilename', () => {
  it('keeps the URL basename only', () => {
    expect(sanitizeFilename('https://example.com/files/report.pdf?token=1')).toBe('report.pdf');
    expect(sanitizeFilename('https://example.com/a/b/My Report v2.pdf')).toBe('My Report v2.pdf');
  });

  it('never produces traversal or hidden names', () => {
    expect(sanitizeFilename('https://example.com/..%2F..%2Fetc%2Fpasswd')).toBe('.._.._etc_passwd'.replace(/^\.+/, ''));
    expect(sanitizeFilename('https://example.com/%2e%2e/x')).not.toMatch(/^\.+/);
    expect(sanitizeFilename('https://example.com/')).toBe('download');
    expect(sanitizeFilename('https://example.com/../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('not a url')).toBe('download');
  });
});

describe('resolveCollision', () => {
  it('suffixes existing files as (2), (3), …', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-collide-'));
    try {
      const first = join(dir, 'a.txt');
      await writeFile(first, 'x');
      expect(await resolveCollision(first)).toBe(join(dir, 'a (2).txt'));
      await writeFile(join(dir, 'a (2).txt'), 'x');
      expect(await resolveCollision(first)).toBe(join(dir, 'a (3).txt'));
      expect(await resolveCollision(join(dir, 'missing.txt'))).toBe(join(dir, 'missing.txt'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('download_file tool', () => {
  it('registers as an editable state-changing files tool with path confinement', () => {
    expect(DOWNLOAD_TOOL_NAME).toBe('download_file');
    expect(downloadFileTool.risk).toBe('state-changing');
    expect(downloadFileTool.category).toBe('files');
    expect(downloadFileTool.editableArgs).toBe(true);
    expect(downloadFileTool.pathArgs).toEqual(['path']);
    expect(downloadFileTool.summarize({ url: 'https://x/a.zip' })).toContain('https://x/a.zip');
  });

  it('refuses to run without a granted folder', async () => {
    const text = await downloadFileTool.exec({ url: 'https://93.184.216.34/a.bin' }, { grantedRoots: [] });
    expect(text).toMatch(/no folder is granted/);
  });

  it('refuses paths outside the granted roots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-root-'));
    try {
      const text = await downloadFileTool.exec(
        { url: 'https://93.184.216.34/a.bin', path: '/etc/passwd' },
        { grantedRoots: [dir] }
      );
      expect(text).toMatch(/was not granted/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('blocks robots-disallowed paths before any transfer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-robots-'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *\nDisallow: /files', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const text = await downloadFileTool.exec(
        { url: 'https://93.184.216.34/files/a.pdf', path: join(dir, 'a.pdf') },
        { grantedRoots: [dir] }
      );
      expect(text).toMatch(/Blocked by robots\.txt/);
      await expect(stat(join(dir, 'a.pdf'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('saves into the granted folder with progress events and a done event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-save-'));
    const payload = new TextEncoder().encode('hello download');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *', { status: 200 }))
      .mockResolvedValueOnce(
        bodyResponse(chunkStream([payload]), { 'content-type': 'application/pdf', 'content-length': String(payload.length) })
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const text = await downloadFileTool.exec(
        { url: 'https://93.184.216.34/doc.pdf', path: join(dir, 'doc.pdf') },
        { grantedRoots: [dir] }
      );
      expect(text).toMatch(/Saved .*doc\.pdf/);
      expect((await stat(join(dir, 'doc.pdf'))).size).toBe(payload.length);
      expect(extractArtifactMarker(text)).toEqual({
        kind: 'file',
        path: join(dir, 'doc.pdf'),
        name: 'doc.pdf',
        sizeBytes: payload.length,
      });
      const statuses = lastProgress.map((event) => event.status);
      expect(statuses[0]).toBe('active');
      expect(statuses[statuses.length - 1]).toBe('done');
      expect(lastProgress[0].destination).toBe(join(dir, 'doc.pdf'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('defaults the destination to the first granted root + URL filename', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-default-'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *', { status: 200 }))
      .mockResolvedValueOnce(bodyResponse(chunkStream([new Uint8Array(10)]), { 'content-type': 'application/zip' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await downloadFileTool.exec({ url: 'https://93.184.216.34/pkg.zip' }, { grantedRoots: [dir] });
      expect((await stat(join(dir, 'pkg.zip'))).isFile()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('renames on collision instead of overwriting', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-coll-'));
    await writeFile(join(dir, 'doc.pdf'), 'existing');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *', { status: 200 }))
      .mockResolvedValueOnce(bodyResponse(chunkStream([new Uint8Array(4)]), { 'content-type': 'application/pdf' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const text = await downloadFileTool.exec(
        { url: 'https://93.184.216.34/doc.pdf', path: join(dir, 'doc.pdf') },
        { grantedRoots: [dir] }
      );
      expect(text).toMatch(/renamed to avoid overwriting/);
      expect((await stat(join(dir, 'doc (2).pdf'))).isFile()).toBe(true);
      expect((await stat(join(dir, 'doc.pdf'))).size).toBe(8);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('refuses files above the size cap before streaming', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-cap-'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *', { status: 200 }))
      .mockResolvedValueOnce(
        bodyResponse(chunkStream([]), { 'content-length': String(60 * 1024 * 1024) })
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const text = await downloadFileTool.exec(
        { url: 'https://93.184.216.34/huge.iso', path: join(dir, 'huge.iso') },
        { grantedRoots: [dir] }
      );
      expect(text).toMatch(/larger than the .* limit/);
      await expect(stat(join(dir, 'huge.iso'))).rejects.toThrow();
      expect(lastProgress.map((event) => event.status)).not.toContain('done');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('stops mid-stream and cleans up when the transfer exceeds the cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-over-'));
    const block = new Uint8Array(1024 * 1024);
    const chunks: Uint8Array[] = Array.from({ length: 60 }, () => block);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *', { status: 200 }))
      .mockResolvedValueOnce(bodyResponse(chunkStream(chunks), { 'content-type': 'application/octet-stream' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const text = await downloadFileTool.exec(
        { url: 'https://93.184.216.34/blob.bin', path: join(dir, 'blob.bin') },
        { grantedRoots: [dir] }
      );
      expect(text).toMatch(/exceeded the .* limit/);
      await expect(stat(join(dir, 'blob.bin'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('cancels an in-flight transfer via the tracker and removes the partial file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-cancel-'));
    const controller = new AbortController();
    const first = new Uint8Array(16);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *', { status: 200 }))
      .mockResolvedValueOnce(
        bodyResponse(chunkStream([first], controller.signal), { 'content-type': 'application/octet-stream' })
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const pending = downloadFileTool.exec(
        { url: 'https://93.184.216.34/slow.bin', path: join(dir, 'slow.bin') },
        { grantedRoots: [dir] }
      );
      await vi.waitFor(() => {
        expect(lastProgress.some((event) => event.status === 'active')).toBe(true);
      });
      const active = lastProgress.find((event) => event.status === 'active');
      expect(downloads.cancel(active.downloadId)).toBe(true);
      controller.abort();
      const text = await pending;
      expect(text).toMatch(/cancelled — the partial file was removed/);
      await expect(stat(join(dir, 'slow.bin'))).rejects.toThrow();
      expect(lastProgress.some((event) => event.status === 'cancelled')).toBe(true);
      expect(downloads.cancel(active.downloadId)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('warns when the URL returns a web page instead of a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-html-'));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *', { status: 200 }))
      .mockResolvedValueOnce(
        bodyResponse(chunkStream([new TextEncoder().encode('<html>login</html>')]), { 'content-type': 'text/html' })
      );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const text = await downloadFileTool.exec(
        { url: 'https://93.184.216.34/file', path: join(dir, 'file') },
        { grantedRoots: [dir] }
      );
      expect(text).toMatch(/web page, not a file/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fails gracefully — no uncaught stream error — when the destination is not writable', async function () {
    if (process.platform === 'win32' || typeof process.getuid === 'function' && process.getuid() === 0) {
      this.skip();
    }
    const dir = await mkdtemp(join(tmpdir(), 'da-eacces-'));
    const locked = join(dir, 'locked');
    await mkdir(locked, 0o555);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *', { status: 200 }))
      .mockResolvedValueOnce(bodyResponse(chunkStream([new Uint8Array(8)]), { 'content-type': 'application/pdf' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const text = await downloadFileTool.exec(
        { url: 'https://93.184.216.34/dummy.pdf', path: join(locked, 'dummy.pdf') },
        { grantedRoots: [dir] }
      );
      expect(text).toMatch(/cannot write to '.*dummy\.pdf'/);
      expect(text).toMatch(/permission denied|EACCES/i);
      expect(lastProgress.map((event) => event.status)).not.toContain('done');
    } finally {
      await chmod(locked, 0o755);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('creates missing destination folders but refuses a directory target', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'da-mkdir-'));
    const sub = join(dir, 'new', 'deep');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('User-agent: *', { status: 200 }))
      .mockResolvedValueOnce(bodyResponse(chunkStream([new Uint8Array(3)]), { 'content-type': 'application/pdf' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await downloadFileTool.exec(
        { url: 'https://93.184.216.34/a.pdf', path: join(sub, 'a.pdf') },
        { grantedRoots: [dir] }
      );
      expect((await stat(join(sub, 'a.pdf'))).isFile()).toBe(true);

      const folder = join(dir, 'folder');
      await mkdir(folder);
      const refused = await downloadFileTool.exec(
        { url: 'https://93.184.216.34/a.pdf', path: folder },
        { grantedRoots: [dir] }
      );
      expect(refused).toMatch(/is a folder/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
