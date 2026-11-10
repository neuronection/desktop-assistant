import { describe, expect, it, vi, beforeEach } from 'vitest';

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>() }));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('@main/services/ConfigService', () => ({
  MainConfigService: { getInstance: () => ({ getConfig: () => ({}) }) },
}));

vi.mock('@main/ipc/register', () => ({
  register: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
    handlers.set(channel, handler);
  },
}));

import { registerTranslationIpc } from '@main/ipc/translation';
import { IPC } from '@shared/ipc/registry';

const translate = vi.fn(async () => ({ text: 'Καλημέρα', engine: 'llm', target: 'el' }));
const addCustomLanguage = vi.fn(async (code: string) => ({ code, name: 'Klingon' }));

beforeEach(() => {
  handlers.clear();
  translate.mockClear();
  addCustomLanguage.mockClear();
  registerTranslationIpc({ translationService: { translate, addCustomLanguage } as never });
});

describe('translation IPC — the pad request contract (plan 69)', () => {
  it('forwards the engine-mode override and normalizes target/source', async () => {
    const handler = handlers.get(IPC['translation:translate']);
    expect(handler).toBeTruthy();
    await handler!({}, { text: ' Good morning ', target: ' EL ', source: 'EN', mode: 'llm' });
    expect(translate).toHaveBeenCalledWith({ text: 'Good morning', target: 'el', source: 'en', mode: 'llm' });
  });

  it('omits mode when the pad inherits the configured engine', async () => {
    const handler = handlers.get(IPC['translation:translate']);
    await handler!({}, { text: 'hello', target: 'el' });
    expect(translate).toHaveBeenCalledWith({ text: 'hello', target: 'el' });
  });

  it('exposes the custom-language write path', async () => {
    const handler = handlers.get(IPC['translation:add-custom-language']);
    expect(handler).toBeTruthy();
    const entry = await handler!({}, 'tlh');
    expect(addCustomLanguage).toHaveBeenCalledWith('tlh');
    expect(entry).toEqual({ code: 'tlh', name: 'Klingon' });
  });
});
