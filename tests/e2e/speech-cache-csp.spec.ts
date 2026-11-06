import { test, expect } from 'playwright/test';
import { launchDemoApp } from './demo-app';

test.describe('speech-cache scheme (plan 58 S2 discriminator)', () => {
  test('a well-formed bogus cache URL reaches the protocol handler — CSP does not block it', async () => {
    test.setTimeout(120_000);
    const { app, window } = await launchDemoApp();

    const violations: string[] = [];
    window.on('console', (message) => {
      if (/Content Security Policy/i.test(message.text())) {
        violations.push(message.text());
      }
    });

    const outcome = await window.evaluate(async () => {
      const audio = new Audio(`speech-cache://chunk/${'a'.repeat(64)}.wav`);
      return new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('timeout'), 8_000);
        audio.addEventListener('error', () => {
          clearTimeout(timer);
          resolve('error');
        });
        audio.addEventListener('playing', () => {
          clearTimeout(timer);
          resolve('playing');
        });
        audio.load();
      });
    });

    await app.close();
    expect(outcome, 'the scheme is registered and media-src allows it').toBe('error');
    expect(violations.join('\n')).not.toMatch(/speech-cache/);
  });
});
