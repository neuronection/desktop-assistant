// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HotkeyAction, type ElectronAPI, type HotkeySettings } from '@shared/types';
import { HotkeysTab } from '@renderer/settings-react/tabs/HotkeysTab';

afterEach(cleanup);

const hotkeys: HotkeySettings = {
  [HotkeyAction.ToggleWindow]: {
    action: HotkeyAction.ToggleWindow,
    accelerator: 'Control+Space',
    label: 'Toggle App Window',
    isEditable: true,
  },
};

describe('HotkeysTab registration status', () => {
  beforeEach(() => {
    (window as unknown as { electronAPI: Partial<ElectronAPI> }).electronAPI = {
      getHotkeyStatus: vi.fn(async () => [
        { action: HotkeyAction.ToggleWindow, label: 'Toggle App Window', accelerator: 'Control+Space', available: false },
      ]),
      recheckHotkeys: vi.fn(async () => [
        { action: HotkeyAction.ToggleWindow, label: 'Toggle App Window', accelerator: 'Control+Space', available: true },
      ]),
    };
  });

  it('lists an unavailable registration and clears it after a recheck', async () => {
    render(<HotkeysTab hotkeys={hotkeys} onHotkeysChange={vi.fn()} />);
    expect(await screen.findByText(/could not be registered/i)).toBeTruthy();
    expect(screen.getByText(/Toggle App Window — Control\+Space/)).toBeTruthy();
    fireEvent.click(screen.getByText('Recheck'));
    await waitFor(() => expect(screen.queryByText(/could not be registered/i)).toBeNull());
  });
});
