import { describe, it, expect } from 'vitest';
import { devCspRelax } from '../vite.config.ts';

const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data:;">`;

describe('devCspRelax', () => {
  it('relaxes script-src and allows the HMR socket in dev', async () => {
    const out = await devCspRelax().transformIndexHtml.handler(html, { server: true });
    expect(out).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(out).toContain('ws://localhost:5173');
  });

  it('leaves the CSP untouched for production builds', async () => {
    const out = await devCspRelax().transformIndexHtml.handler(html, { server: false });
    expect(out).toBe(html);
  });
});
