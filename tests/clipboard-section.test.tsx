// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { DEFAULT_CONFIG } from '@shared/config/AppConfig';
import type { ElectronAPI } from '@shared/types';
import { ClipboardSection } from '@renderer/settings-react/tools/ClipboardSection';

afterEach(cleanup);

const config = { ...DEFAULT_CONFIG, clipboard: { ...DEFAULT_CONFIG.clipboard, enabled: true } };

describe('ClipboardSection', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: Partial<ElectronAPI> }).electronAPI = {
      loadConfig: vi.fn(async () => config),
      saveConfig: vi.fn(async () => undefined),
      getClipboardStatus: vi.fn(async () => ({
        encryptionAvailable: true,
        enabled: true,
        paused: false,
        count: 1,
        sessionOnly: false,
      })),
      listClipboardEntries: vi.fn(async () => [
        {
          id: 'c1',
          text: 'copied text',
          pinned: false,
          createdAt: new Date('2026-11-11T09:00:00').toISOString(),
          sessionOnly: false,
        },
      ]),
      pinClipboardEntry: vi.fn(async () => true),
      copyClipboardEntry: vi.fn(async () => true),
      removeClipboardEntry: vi.fn(async () => true),
      clearClipboardHistory: vi.fn(async () => true),
    };
  });

  it('lists entries and supports pin/copy/delete', async () => {
    render(<ClipboardSection />);
    expect(await screen.findByText('copied text')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(window.electronAPI.pinClipboardEntry).toHaveBeenCalledWith('c1', true));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(window.electronAPI.copyClipboardEntry).toHaveBeenCalledWith('c1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(window.electronAPI.removeClipboardEntry).toHaveBeenCalledWith('c1');
  });

  it('turns capture on only through the explicit toggle', async () => {
    (window.electronAPI.loadConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...config,
      clipboard: { ...config.clipboard, enabled: false },
    });
    render(<ClipboardSection />);
    const toggle = await screen.findByRole('checkbox', { name: 'Enable clipboard history' });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(window.electronAPI.saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({ clipboard: expect.objectContaining({ enabled: true }) })
      )
    );
  });

  it('has no axe violations', async () => {
    const { container } = render(<ClipboardSection />);
    await screen.findByText('copied text');
    const results = await axe.run(container);
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });
});
