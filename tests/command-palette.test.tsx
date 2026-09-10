// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { CommandPalette } from '@renderer/chat-react/CommandPalette';
import type { CommandCatalogSnapshot } from '@shared/commands';
import { buildPaletteModel } from '@renderer/chat-react/commandSource';

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

afterEach(cleanup);

const SNAPSHOT: CommandCatalogSnapshot = {
  entries: [
    {
      id: 'tool:screen_capture',
      kind: 'tool',
      title: 'Screen capture',
      category: 'tools',
      aliases: ['screenshot'],
      slash: 'screenshot',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [],
      toolName: 'screen_capture',
    },
    {
      id: 'tool:run_shell',
      kind: 'tool',
      title: 'Run shell',
      subtitle: 'Run a shell command',
      category: 'tools',
      aliases: ['shell'],
      slash: 'shell',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [{ name: 'command', required: true, type: 'string' }],
      toolName: 'run_shell',
    },
    {
      id: 'nav:open-settings',
      kind: 'builtin',
      title: 'Open settings',
      category: 'navigation',
      aliases: ['settings'],
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [],
      action: 'nav:open-settings',
    },
    {
      id: 'calc:evaluate',
      kind: 'builtin',
      title: 'Calculator',
      category: 'tools',
      aliases: ['calc'],
      slash: 'calc',
      source: 'system',
      scopes: { palette: true, agent: false },
      args: [{ name: 'expression', required: true, type: 'string' }],
      action: 'calc:evaluate',
    },
  ],
  recentIds: ['calc:evaluate', 'tool:run_shell'],
  pins: ['nav:open-settings'],
};

function renderPalette(query: string, handlers = { onExecute: vi.fn(), onTabComplete: vi.fn(), onClose: vi.fn() }) {
  const model = buildPaletteModel(SNAPSHOT, query);
  const view = render(
    <CommandPalette model={model} pending={false} onExecute={handlers.onExecute} onTabComplete={handlers.onTabComplete} onClose={handlers.onClose} />
  );
  return { ...handlers, ...view };
}

describe('CommandPalette', () => {
  it('renders grouped rows with titles, subtitles, categories and slash hints', () => {
    renderPalette('');
    expect(screen.getByRole('listbox', { name: /commands/i })).toBeTruthy();
    expect(screen.getByText(/pinned/i)).toBeTruthy();
    expect(screen.getByText(/recent/i)).toBeTruthy();
    expect(screen.getByText(/suggested/i)).toBeTruthy();
    expect(screen.getAllByText(/tools/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/run a shell command/i)).toBeTruthy();
    expect(screen.getByText('/shell')).toBeTruthy();
  });

  it('keyboard-navigates and executes the selected row with Enter', () => {
    const handlers = renderPalette('sh ls');
    const firstOption = document.getElementById('command-option-0');
    expect(firstOption?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'ArrowDown' });
    const selected = document.getElementById('command-option-1');
    expect(selected?.getAttribute('aria-selected')).toBe('true');
    expect(selected?.getAttribute('style')).toContain('color-mix(in srgb, var(--as-primary)');
    expect(selected?.className).toContain('border-l-[var(--as-primary)]');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(handlers.onExecute).toHaveBeenCalledTimes(1);
    const [entry, argv] = handlers.onExecute.mock.calls[0];
    expect(entry.id).toBe('tool:screen_capture');
    expect(argv).toEqual(['ls']);
  });

  it('blocks execution of entries missing required args and shows usage instead', () => {
    const handlers = renderPalette('shell');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(handlers.onExecute).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/usage: \/shell/i);
  });

  it('runs entries whose required args are satisfied by configured defaults', () => {
    const handlers = { onExecute: vi.fn(), onTabComplete: vi.fn(), onClose: vi.fn() };
    const model = buildPaletteModel(SNAPSHOT, 'shell');
    render(
      <CommandPalette
        model={model}
        pending={false}
        onExecute={handlers.onExecute}
        onTabComplete={handlers.onTabComplete}
        onClose={handlers.onClose}
        argDefaults={{ 'tool:run_shell': { command: 'git status' } }}
      />
    );
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(handlers.onExecute).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('completes the canonical slash into the composer with Tab', () => {
    const handlers = renderPalette('screen');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' });
    expect(handlers.onTabComplete).toHaveBeenCalledTimes(1);
    expect(handlers.onTabComplete.mock.calls[0][0].id).toBe('tool:screen_capture');
  });

  it('closes on Escape and stops propagation to app-level handlers', () => {
    const bubbleHandler = vi.fn();
    document.addEventListener('keydown', bubbleHandler);
    const handlers = renderPalette('');
    const target = document.createElement('div');
    document.body.appendChild(target);
    fireEvent.keyDown(target, { key: 'Escape' });
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(bubbleHandler).not.toHaveBeenCalled();
    document.removeEventListener('keydown', bubbleHandler);
    target.remove();
  });

  it('shows a live calculator result for the calc entry', () => {
    renderPalette('calc 2 + 3 * 4');
    expect(screen.getByRole('status').textContent).toMatch(/= 14/);
  });

  it('shows the empty state when nothing matches', () => {
    renderPalette('zzzz');
    expect(screen.getByRole('status').textContent).toMatch(/no matching commands/i);
  });

  it('has no axe violations', async () => {
    const { container } = renderPalette('sh');
    const results = await axe.run(container);
    const summary = results.violations
      .map((violation) => `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => node.target.join(' ')).join(' | ')}`)
      .join('\n');
    expect(summary).toBe('');
  });
});
