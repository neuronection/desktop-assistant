// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { CommandPalette } from '@renderer/chat-react/CommandPalette';
import { TEXT } from '@shared/constants/text';
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
      args: [{ name: 'command', required: true, type: 'string', description: 'runs a shell command' }],
      risk: 'state-changing',
      toolName: 'run_shell',
    },
    {
      id: 'tool:web_search',
      kind: 'tool',
      title: 'Web search',
      subtitle: 'Search the web',
      category: 'web',
      aliases: ['web'],
      slash: 'web',
      source: 'native',
      scopes: { palette: true, agent: false },
      args: [
        { name: 'query', required: true, type: 'string' },
        { name: 'maxResults', required: false, type: 'number', description: 'How many results to return.' },
      ],
      toolName: 'web_search',
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
  recent: [{ id: 'calc:evaluate', usedAt: Date.now() }, { id: 'tool:run_shell', usedAt: Date.now() }],
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
    expect(screen.getAllByText(/\/shell <command>/).length).toBeGreaterThan(0);
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

  it('keeps hover and selection separate: hovering never moves the selection or the help', () => {
    renderPalette('sh');
    const first = document.getElementById('command-option-0');
    const second = document.getElementById('command-option-1');
    expect(first?.getAttribute('aria-selected')).toBe('true');
    const usageBefore = screen.getByTestId('command-help-usage').textContent;
    if (second) {
      fireEvent.mouseEnter(second);
    }
    expect(document.getElementById('command-option-0')?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('command-help-usage').textContent).toBe(usageBefore);
  });

  it('selects on a single click and runs on a double click', () => {
    const handlers = renderPalette('sh');
    const first = document.getElementById('command-option-0');
    const second = document.getElementById('command-option-1');
    expect(first && second).toBeTruthy();
    const rowBody = second?.firstElementChild as HTMLElement;
    fireEvent.click(rowBody);
    expect(second?.getAttribute('aria-selected')).toBe('true');
    expect(first?.getAttribute('aria-selected')).toBe('false');
    expect(handlers.onExecute).not.toHaveBeenCalled();
    fireEvent.doubleClick(rowBody);
    expect(handlers.onExecute).toHaveBeenCalledTimes(1);
  });

  it('keeps the help pane at a fixed height so selection cannot resize the window', () => {
    renderPalette('');
    const strip = screen.getByTestId('command-help');
    expect(strip.className).toContain('h-36');
    expect(strip.className).toContain('flex-col');
  });

  it('explains defaults-only optional arguments on a free-text command', () => {
    const handlers = { onExecute: vi.fn(), onTabComplete: vi.fn(), onClose: vi.fn(), onRowAction: vi.fn() };
    const model = buildPaletteModel(SNAPSHOT, 'web');
    render(
      <CommandPalette
        model={model}
        pending={false}
        onExecute={handlers.onExecute}
        onTabComplete={handlers.onTabComplete}
        onClose={handlers.onClose}
        onRowAction={handlers.onRowAction}
        argDefaults={{ 'tool:web_search': { maxResults: '5' } }}
      />
    );
    const help = screen.getByTestId('command-help');
    expect(help.textContent).toContain('default: 5');
    expect(help.textContent).toContain('pass a flag (--name value)');
    fireEvent.click(screen.getByTestId('command-help-defaults'));
    expect(handlers.onRowAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'tool:web_search' }), 'configure');
  });

  it('never dispatches an incomplete command: Enter completes it and the help strip says what is missing', () => {
    const handlers = renderPalette('shell');
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Enter' });
    expect(handlers.onExecute).not.toHaveBeenCalled();
    expect(handlers.onTabComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('command-help-footer').textContent).toContain('Needs <command>');
    expect(screen.getByTestId('command-help-usage').textContent).toBe('/shell <command>');
  });

  it('explains the highlighted command: full description, argument types and risk class', () => {
    renderPalette('shell');
    const help = screen.getByTestId('command-help');
    expect(within(help).getByText(/run a shell command/i)).toBeTruthy();
    const args = within(help).getByTestId('command-help-args');
    expect(args.textContent).toContain('command');
    expect(args.textContent).toContain('required');
    expect(args.textContent).toContain('text');
    expect(args.textContent).toContain('runs a shell command');
    expect(help.textContent).toContain('Changes things');
  });

  it('shows the calc preview inside the pinned help strip', () => {
    renderPalette('calc 2+3*4');
    expect(screen.getByTestId('command-help').textContent).toContain('= 14');
    expect(screen.getByTestId('command-help-usage').textContent).toContain('/calc');
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
    expect(screen.getByTestId('command-help').textContent).toMatch(/= 14/);
  });

  it('runs a row action from the context menu and closes the menu', () => {
    const handlers = { onExecute: vi.fn(), onTabComplete: vi.fn(), onClose: vi.fn(), onRowAction: vi.fn() };
    const model = buildPaletteModel(SNAPSHOT, 'sh');
    render(
      <CommandPalette
        model={model}
        pending={false}
        onExecute={handlers.onExecute}
        onTabComplete={handlers.onTabComplete}
        onClose={handlers.onClose}
        onRowAction={handlers.onRowAction}
      />
    );
    const row = document.getElementById('command-option-0') as HTMLElement;
    fireEvent.contextMenu(row.firstElementChild as HTMLElement);
    const pin = screen.getByRole('button', { name: TEXT.COMMAND_PIN });
    fireEvent.click(pin);
    expect(handlers.onRowAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'tool:run_shell' }), 'pin');
    expect(screen.queryByRole('button', { name: TEXT.COMMAND_PIN })).toBeNull();
  });

  it('tells the user when the browser is capped', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      id: `tool:bulk_${index}`,
      kind: 'tool' as const,
      title: `Bulk ${index}`,
      category: 'tools' as const,
      aliases: [`bulk${index}`],
      source: 'native' as const,
      scopes: { palette: true, agent: false },
      args: [],
      toolName: 'run_shell',
    }));
    const model = buildPaletteModel({ entries, recent: [], pins: [] }, '');
    render(<CommandPalette model={model} pending={false} onExecute={vi.fn()} onTabComplete={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('palette-browse-more').textContent).toContain('4 more commands');
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
