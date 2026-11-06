import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'src/renderer/styles/chat-app.css'), 'utf8');

describe('transcript reply actions', () => {
  it('uses the HUD square glass language one step smaller', () => {
    expect(css).toContain('[data-as="chat-message-actions"]');
    expect(css).toContain('[data-as="chat-message-actions"] button');
    expect(css).toContain('width: 22px');
    expect(css).toContain('height: 22px');
    expect(css).toContain('border-radius: 8px');
    expect(css).toContain('inset: -1px');
    expect(css).toContain('backdrop-filter: blur(10px)');
    expect(css).toContain('button + button');
  });
});
