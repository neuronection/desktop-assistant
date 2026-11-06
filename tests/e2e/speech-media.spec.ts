import { test, expect } from 'playwright/test';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchDemoApp } from './demo-app';


function wavBytes(samples = 1600): Buffer {
  const data = Buffer.alloc(samples, 128);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test.describe('speech-cache audio tiers (plan 58 S3a)', () => {
  test('a cached chunk and an ephemeral data URL both play through a real media element', async () => {
    test.setTimeout(180_000);

    const probe = await launchDemoApp();
    const dataDir = (await probe.app.evaluate(({ app }) => app.getPath('userData'))) as string;
    await probe.app.close();

    const key = createHash('sha256').update('e2e|speech-cache|chunk').digest('hex');
    const cacheDir = join(dataDir, 'speech-cache');
    mkdirSync(cacheDir, { recursive: true });
    const wav = wavBytes();
    writeFileSync(join(cacheDir, `${key}.wav`), wav);
    writeFileSync(
      join(cacheDir, 'index.json'),
      JSON.stringify({
        version: 1,
        utterances: {
          [createHash('sha256').update(key).digest('hex')]: { chunks: [key], touchedAt: Date.now() },
        },
      })
    );

    const { app, window } = await launchDemoApp([], { fresh: false });

    const play = async (url: string): Promise<string> =>
      window.evaluate(async (source) => {
        const audio = new Audio(source);
        return new Promise<string>((resolve) => {
          const timer = setTimeout(() => resolve('timeout'), 8_000);
          const settle = (outcome: string) => {
            clearTimeout(timer);
            resolve(outcome);
          };
          audio.addEventListener('playing', () => settle('playing'));
          audio.addEventListener('error', () => settle('error'));
          audio.play().then(
            () => undefined,
            (error: Error) => settle(`rejected:${error.name}`)
          );
        });
      }, url);

    const cached = await play(`speech-cache://chunk/${key}.wav`);
    expect(cached, 'the cache tier must serve real audio').toBe('playing');

    const ephemeral = await play(`data:audio/wav;base64,${wav.toString('base64')}`);
    expect(ephemeral, 'the ephemeral tier must serve real audio').toBe('playing');

    await app.close();
  });
});
