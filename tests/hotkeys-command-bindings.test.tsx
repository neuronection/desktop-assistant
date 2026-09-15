// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { HotkeyAction, type HotkeySettings } from '@shared/types';
import type { CommandHotkeyBinding } from '@shared/config/AppConfig';
import { HotkeysTab } from '@renderer/settings-react/tabs/HotkeysTab';

afterEach(cleanup);

const hotkeys: HotkeySettings = {
  [HotkeyAction.ToggleWindow]: {
    action: HotkeyAction.ToggleWindow,
    accelerator: 'CommandOrControl+Shift+A',
    label: 'Toggle App Window',
    isEditable: true,
  },
  [HotkeyAction.OpenSettings]: {
    action: HotkeyAction.OpenSettings,
    accelerator: 'CommandOrControl+,',
    label: 'Open Settings',
    isEditable: true,
  },
};

const commands = [{ id: 'custom:deploy', title: 'Deploy check' }];
const bindings: Record<string, CommandHotkeyBinding> = {
  'custom:deploy': { accelerator: 'Control+Shift+9' },
};

function setup(overrides: Partial<Parameters<typeof HotkeysTab>[0]> = {}): { onHotkeysChange: ReturnType<typeof vi.fn>; onCommandBindingChange: ReturnType<typeof vi.fn> } {
  const onHotkeysChange = vi.fn();
  const onCommandBindingChange = vi.fn();
  render(
    <HotkeysTab
      hotkeys={hotkeys}
      onHotkeysChange={onHotkeysChange}
      commandOptions={commands}
      commandBindings={bindings}
      onCommandBindingChange={onCommandBindingChange}
      {...overrides}
    />
  );
  return { onHotkeysChange, onCommandBindingChange };
}

describe('HotkeysTab command bindings', () => {
  it('lists custom commands with their bound accelerator', () => {
    setup();
    expect(screen.getByText('Command Hotkeys')).toBeTruthy();
    expect(screen.getByText('Deploy check')).toBeTruthy();
    expect(screen.getByText('Control+Shift+9')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unbind' })).toBeTruthy();
  });

  it('hides the command section when there is nothing to bind', () => {
    setup({ commandOptions: [], commandBindings: {}, onCommandBindingChange: undefined });
    expect(screen.queryByText('Command Hotkeys')).toBeNull();
  });

  it('records a new binding and reports it through the change callback', () => {
    const { onCommandBindingChange } = setup({
      commandOptions: [{ id: 'custom:2', title: 'Standup notes' }],
      commandBindings: {},
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record' })[2]);
    fireEvent.keyDown(window, { key: 'j', ctrlKey: true, altKey: true, bubbles: true } as unknown as KeyboardEvent);
    expect(screen.getByText('Control+Alt+J')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onCommandBindingChange).toHaveBeenCalledWith('custom:2', 'Control+Alt+J');
  });

  it('refuses an accelerator already taken by an action hotkey', () => {
    const { onCommandBindingChange } = setup({
      commandOptions: [{ id: 'custom:2', title: 'Standup notes' }],
      commandBindings: {},
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Record' })[2]);
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true, shiftKey: true, bubbles: true } as unknown as KeyboardEvent);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('already assigned');
    expect(onCommandBindingChange).not.toHaveBeenCalled();
  });

  it('unbinds a command hotkey', () => {
    const { onCommandBindingChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Unbind' }));
    expect(onCommandBindingChange).toHaveBeenCalledWith('custom:deploy', null);
  });

  it('action hotkey recording still works alongside command bindings', () => {
    const { onHotkeysChange } = setup();
    const recordButtons = screen.getAllByRole('button', { name: 'Record' });
    fireEvent.click(recordButtons[1]);
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, altKey: true, bubbles: true } as unknown as KeyboardEvent);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onHotkeysChange).toHaveBeenCalledWith(
      expect.objectContaining({
        [HotkeyAction.OpenSettings]: expect.objectContaining({ accelerator: 'Control+Alt+L' }),
      })
    );
  });
});
