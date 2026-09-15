import { createWriteStream, type WriteStream } from 'fs';
import { mkdir, stat, unlink } from 'fs/promises';
import { dirname, extname, join, resolve } from 'path';
import { z } from 'zod';
import type { NativeToolDefinition, ToolExecContext } from '../types';
import { describeRootBreach, resolveWithinGrantedRoots } from '../policy';
import { followPublicRedirects, isBlockedByRobots } from '../net-guard';
import { downloads } from '../downloads';
import { appendArtifactMarker } from '@shared/artifacts';

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 200;

export const DOWNLOAD_TOOL_NAME = 'download_file';

const schema = z.object({
  url: z.string().describe('The http(s) URL of the file to download.'),
  path: z
    .string()
    .optional()
    .describe(
      'Destination file path inside a folder the user granted. Omit to save into the first granted folder using the URL filename.'
    ),
});

type DownloadArgs = z.infer<typeof schema>;

const SAFE_NAME = /[^A-Za-z0-9._ ()[\]-]/g;

export function sanitizeFilename(url: string): string {
  try {
    const parsed = new URL(url);
    const base = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '');
    if (!base || base === '.' || base === '..') {
      return 'download';
    }
    const cleaned = base.replace(SAFE_NAME, '_').replace(/^\.+/, '').trim();
    return cleaned.length > 0 ? cleaned.slice(0, 120) : 'download';
  } catch {
    return 'download';
  }
}

export async function resolveCollision(path: string): Promise<string> {
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  let candidate = path;
  for (let n = 2; n < 1000; n += 1) {
    try {
      await stat(candidate);
    } catch {
      return candidate;
    }
    candidate = `${stem} (${n})${ext}`;
  }
  return `${stem}.tmp`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
}

export const downloadFileTool: NativeToolDefinition<DownloadArgs> = {
  name: DOWNLOAD_TOOL_NAME,
  description:
    'Download a public http(s) file into a folder the user granted. Respects robots.txt and refuses private/local addresses. Use to save files (PDFs, images, archives) the user asks to keep.',
  schema,
  risk: 'state-changing',
  category: 'files',
  editableArgs: true,
  pathArgs: ['path'],
  timeoutMs: 300_000,
  resultCharCap: 500,
  summarize: (args) => `Download ${args.url}${args.path ? ` → ${args.path}` : ''}`,
  async exec(args: DownloadArgs, ctx: ToolExecContext) {
    const roots = ctx.grantedRoots ?? [];
    if (roots.length === 0) {
      return 'Error: no folder is granted for downloads. Ask the user to grant one (Settings → Tools) or pick a destination inside an approved folder.';
    }
    const source = new URL(args.url);
    if (await isBlockedByRobots(source)) {
      return `Blocked by robots.txt for ${source.origin}.`;
    }
    const requested = args.path ?? join(resolve(roots[0]), sanitizeFilename(args.url));
    const destination = resolveWithinGrantedRoots(roots, requested);
    if (destination === null) {
      return `Error: ${describeRootBreach(requested)}`;
    }
    const existing = await stat(destination).catch(() => null);
    if (existing?.isDirectory()) {
      return `Error: '${destination}' is a folder — pick a file path.`;
    }
    const target = existing ? await resolveCollision(destination) : destination;
    await mkdir(dirname(target), { recursive: true });

    const handle = downloads.begin(target);
    const controller = new AbortController();
    const abortFetch = (): void => controller.abort();
    handle.signal.addEventListener('abort', abortFetch, { once: true });
    ctx.signal?.addEventListener('abort', abortFetch, { once: true });

    let lastReport = 0;
    let writerError: Error | null = null;
    let writer: WriteStream | null = null;
    try {
      const { response } = await followPublicRedirects(args.url, (hopUrl, init) =>
        fetch(hopUrl, { ...init, signal: controller.signal })
      );
      if (!response.ok || !response.body) {
        handle.finish('failed');
        return `The server responded with HTTP ${response.status} ${response.statusText}${response.ok ? ' and no content' : ''}.`;
      }
      const contentLength = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(contentLength) && contentLength > DEFAULT_MAX_BYTES) {
        await response.body.cancel().catch(() => undefined);
        handle.finish('failed');
        return `The file is ${formatBytes(contentLength)} — larger than the ${formatBytes(DEFAULT_MAX_BYTES)} download limit.`;
      }
      writer = createWriteStream(target);
      writer.on('error', (error: Error) => {
        writerError = error;
      });
      try {
        await new Promise<void>((open, fail) => {
          writer?.once('open', () => open());
          writer?.once('error', (error: Error) => fail(error));
        });
      } catch (error) {
        handle.finish('failed');
        return `Error (download_file): cannot write to '${target}': ${(error as Error).message ?? String(error)}`;
      }
      const contentType = response.headers.get('content-type') ?? '';
      const reader = response.body.getReader();
      let loaded = 0;
      let failure: 'size' | 'cancelled' | null = null;
      try {
        while (true) {
          if (controller.signal.aborted) {
            failure = 'cancelled';
            break;
          }
          if (writerError) {
            break;
          }
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          loaded += value.byteLength;
          if (loaded > DEFAULT_MAX_BYTES) {
            failure = 'size';
            break;
          }
          if (!writer.write(Buffer.from(value))) {
            await new Promise<void>((resume, reject) => {
              const onDrain = (): void => {
                writer?.off('error', onError);
                resume();
              };
              const onError = (error: Error): void => {
                writer?.off('drain', onDrain);
                reject(error);
              };
              writer?.once('drain', onDrain);
              writer?.once('error', onError);
            });
          }
          const now = Date.now();
          if (now - lastReport >= PROGRESS_INTERVAL_MS) {
            lastReport = now;
            handle.report(loaded, Number.isFinite(contentLength) ? contentLength : null);
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      await new Promise<void>((settle) => {
        if (failure || writerError) {
          writer?.destroy();
          writer?.once('close', () => settle());
          return;
        }
        writer?.end(() => settle());
        writer?.once('error', () => settle());
      });
      if (failure === 'cancelled') {
        await unlink(target).catch(() => undefined);
        handle.finish('cancelled');
        return 'Download cancelled — the partial file was removed.';
      }
      if (failure === 'size') {
        await unlink(target).catch(() => undefined);
        handle.finish('failed');
        return `The download exceeded the ${formatBytes(DEFAULT_MAX_BYTES)} limit and was stopped — the partial file was removed.`;
      }
      if (writerError) {
        await unlink(target).catch(() => undefined);
        handle.finish('failed');
        return `Error (download_file): cannot write to '${target}': ${writerError.message ?? String(writerError)}`;
      }
      handle.report(loaded, loaded);
      handle.finish('done');
      const warnings: string[] = [];
      if (/text\/html/i.test(contentType)) {
        warnings.push('warning: the URL returned a web page, not a file');
      }
      if (target !== destination) {
        warnings.push(`renamed to avoid overwriting (${destination} exists)`);
      }
      const suffix = warnings.length > 0 ? ` (${warnings.join('; ')})` : '';
      return appendArtifactMarker(`Saved ${target} (${formatBytes(loaded)})${suffix}.`, {
        kind: 'file',
        path: target,
        name: target.split(/[\\/]/).pop() ?? target,
        sizeBytes: loaded,
      });
    } catch (error) {
      await unlink(target).catch(() => undefined);
      const cancelled = controller.signal.aborted;
      handle.finish(cancelled ? 'cancelled' : 'failed');
      if (cancelled) {
        return 'Download cancelled — the partial file was removed.';
      }
      return `Error (download_file): ${(error as Error).message ?? String(error)}`;
    }
  },
};
