import { createHash } from 'node:crypto';
import { open, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import {
  NEEDLE_MODEL_ID,
  NEEDLE_WEIGHTS_BYTES,
  NEEDLE_WEIGHTS_SHA256,
  NEEDLE_WEIGHTS_URL,
} from './pins';

export { NEEDLE_MODEL_ID, NEEDLE_WEIGHTS_URL, NEEDLE_WEIGHTS_SHA256, NEEDLE_WEIGHTS_BYTES } from './pins';

export interface WeightsDeps {
  fetchImpl?: typeof fetch;
}

export interface WeightsProgress {
  receivedBytes: number;
  totalBytes: number;
}

export function needleWeightsPath(userDataDir: string): string {
  return path.join(userDataDir, 'needle', `${NEEDLE_MODEL_ID}.cact`);
}

async function sha256File(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

export async function verifyWeights(
  filePath: string,
  expectedBytes: number = NEEDLE_WEIGHTS_BYTES,
  expectedSha256: string = NEEDLE_WEIGHTS_SHA256
): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (info.size !== expectedBytes) {
      return false;
    }
    return (await sha256File(filePath)) === expectedSha256;
  } catch {
    return false;
  }
}

export async function locateVerifiedWeights(
  userDataDir: string,
  expectedBytes?: number,
  expectedSha256?: string
): Promise<string | null> {
  const filePath = needleWeightsPath(userDataDir);
  return (await verifyWeights(filePath, expectedBytes, expectedSha256)) ? filePath : null;
}

/**
 * Downloads the pinned weights into `userData/needle/` (tmp file +
 * atomic rename; the ADR-0019 pin is verified before the rename, so a
 * partial or corrupted download never becomes the active file).
 */
export async function downloadWeights(
  deps: WeightsDeps,
  options: {
    targetPath: string;
    url?: string;
    expectedBytes?: number;
    expectedSha256?: string;
    onProgress?: (progress: WeightsProgress) => void;
    signal?: AbortSignal;
  }
): Promise<void> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const url = options.url ?? NEEDLE_WEIGHTS_URL;
  const expectedBytes = options.expectedBytes ?? NEEDLE_WEIGHTS_BYTES;
  const expectedSha256 = options.expectedSha256 ?? NEEDLE_WEIGHTS_SHA256;
  const response = await fetchImpl(url, { signal: options.signal });
  if (!response.ok || !response.body) {
    throw new Error(`Needle weights download failed: HTTP ${response.status}`);
  }
  await stat(path.dirname(options.targetPath)).catch(async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(path.dirname(options.targetPath), { recursive: true });
  });
  const tmpPath = `${options.targetPath}.download`;
  const handle = await open(tmpPath, 'w');
  let received = 0;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      await handle.write(value);
      received += value.byteLength;
      options.onProgress?.({ receivedBytes: received, totalBytes: expectedBytes });
    }
    await handle.close();
    if (received !== expectedBytes) {
      throw new Error(`Needle weights incomplete: ${received} of ${expectedBytes} bytes`);
    }
    if (!(await verifyWeights(tmpPath, expectedBytes, expectedSha256))) {
      throw new Error('Needle weights checksum mismatch');
    }
    await rename(tmpPath, options.targetPath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}
