// @vitest-environment jsdom
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { PackLaunchMenu, hasLaunchMenu } from '@renderer/shared/PackLaunchMenu';
import type { MiniAppView } from '@shared/app-pack';

afterEach(cleanup);

function translateView(overrides: Partial<MiniAppView> = {}): MiniAppView {
  return {
    id: 'mini-translate',
    version: '1.2.0',
    kind: 'surface',
    title: 'Translate',
    capabilities: ['ui', 'llm'],
    enabled: true,
    originKind: 'bundled',
    commands: ['tool:translate'],
    configFields: [
      { name: 'sourceCode', type: 'string', label: 'Default source', default: 'auto', enum: ['auto', 'en', 'el'] },
      { name: 'targetCode', type: 'string', label: 'Default target', default: 'en' },
    ],
    configValues: { sourceCode: 'auto', targetCode: 'el' },
    launchOptions: [
      {
        id: 'source',
        label: 'Source',
        type: 'select',
        configKey: 'sourceCode',
        choices: [
          { value: 'auto', label: 'Automatic' },
          { value: 'en', label: 'en' },
          { value: 'el', label: 'el' },
        ],
      },
      {
        id: 'target',
        label: 'Target',
        type: 'select',
        configKey: 'targetCode',
        choices: ['en', 'el', 'de', 'fr', 'es', 'it'].map((code) => ({ value: code, label: code })),
      },
      { id: 'read-context', label: 'Read context', type: 'switch', configKey: 'readContext', default: true },
      { id: 'root', label: 'Folder', type: 'path', required: true },
    ],
    ...overrides,
  };
}

function runView(overrides: Partial<MiniAppView> = {}): MiniAppView {
  return {
    id: 'sample-review',
    version: '1.1.0',
    kind: 'assessment',
    title: 'Deletion review',
    capabilities: ['fs-read', 'run', 'report'],
    enabled: true,
    originKind: 'bundled',
    commands: [],
    configFields: [],
    configValues: {},
    launchOptions: [{ id: 'root', label: 'Folder', type: 'path', required: true }],
    ...overrides,
  };
}

async function scanNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container);
  const summary = results.violations
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
    .join('\n');
  expect(summary).toBe('');
}

describe('PackLaunchMenu — declared options (plan 53 S2)', () => {
  it('renders the declared controls with config pre-fill: pills, select, switch, path', () => {
    render(<PackLaunchMenu view={translateView()} onLaunch={vi.fn()} />);
    expect(screen.getByTestId('launch-option-source')).toBeTruthy();
    expect(screen.getByTestId('launch-option-source-choice-auto').getAttribute('aria-pressed')).toBe('true');
    const host = screen.getByTestId('launch-option-target-select');
    expect(host).toBeTruthy();
    expect(within(host).getByRole('combobox').textContent).toContain('el');
    expect((screen.getByTestId('launch-option-read-context-switch') as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    expect((screen.getByTestId('launch-option-root-input') as HTMLInputElement).value).toBe('');
  });

  it('disables the primary until a required path is set, then launches with the values', () => {
    const onLaunch = vi.fn();
    render(<PackLaunchMenu view={translateView()} onLaunch={onLaunch} />);
    expect((screen.getByTestId('launch-primary') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('launch-option-root').textContent).toContain('Required');
    fireEvent.change(screen.getByTestId('launch-option-root-input'), { target: { value: '/tmp/demo' } });
    expect((screen.getByTestId('launch-primary') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('launch-primary'));
    expect(onLaunch).toHaveBeenCalledWith({ source: 'auto', target: 'el', 'read-context': true, root: '/tmp/demo' });
  });

  it('browse fills the path from the host picker and cancelling keeps it empty', async () => {
    const picked = vi.fn(async () => '/picked/folder');
    render(<PackLaunchMenu view={translateView()} onLaunch={vi.fn()} onBrowsePath={picked} />);
    fireEvent.click(screen.getByTestId('launch-option-root-browse'));
    await vi.waitFor(() => {
      expect((screen.getByTestId('launch-option-root-input') as HTMLInputElement).value).toBe('/picked/folder');
    });
    expect(picked).toHaveBeenCalledTimes(1);
    cleanup();
    render(<PackLaunchMenu view={translateView()} onLaunch={vi.fn()} onBrowsePath={vi.fn(async () => null)} />);
    fireEvent.click(screen.getByTestId('launch-option-root-browse'));
    await Promise.resolve();
    expect((screen.getByTestId('launch-option-root-input') as HTMLInputElement).value).toBe('');
  });

  it('derives choices from the config enum when the declaration omits them', () => {
    render(<PackLaunchMenu view={translateView()} onLaunch={vi.fn()} />);
    fireEvent.click(within(screen.getByTestId('launch-option-target-select')).getByRole('combobox'));
    expect(screen.getAllByRole('option').map((option) => option.getAttribute('data-value') ?? option.textContent)).toEqual([
      'en',
      'el',
      'de',
      'fr',
      'es',
      'it',
    ]);
  });

  it('keeps an undeclared stored value selectable instead of rendering a blank dropdown', () => {
    const view = translateView();
    view.configValues = { ...view.configValues, targetCode: 'xx' };
    render(<PackLaunchMenu view={view} onLaunch={vi.fn()} />);
    fireEvent.click(within(screen.getByTestId('launch-option-target-select')).getByRole('combobox'));
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options[0]).toBe('xx');
    expect(screen.getByRole('option', { name: 'xx', selected: true })).toBeTruthy();
  });

  it('degrades an unknown option type to a text input', () => {
    const view = translateView({
      launchOptions: [{ id: 'mystery', label: 'Mystery', type: 'custom' as never }],
    });
    render(<PackLaunchMenu view={view} onLaunch={vi.fn()} />);
    expect(screen.getByTestId('launch-option-mystery-input')).toBeTruthy();
  });
});

describe('PackLaunchMenu — labels, hub actions, states (plan 53 S2)', () => {
  it('labels the primary by capability: Open for surfaces, Run for assessment packs', () => {
    render(<PackLaunchMenu view={translateView()} onLaunch={vi.fn()} />);
    expect(screen.getByTestId('launch-primary').textContent).toBe('Open');
    cleanup();
    render(<PackLaunchMenu view={runView()} onLaunch={vi.fn()} />);
    expect(screen.getByTestId('launch-primary').textContent).toBe('Run');
  });

  it('gates hub actions: Runs history needs the run capability, the rest render when wired', () => {
    render(
      <PackLaunchMenu
        view={translateView({ capabilities: ['ui', 'llm', 'ui:window'] })}
        onLaunch={vi.fn()}
        onOpenRuns={vi.fn()}
        onConfigure={vi.fn()}
        onOpenWindow={vi.fn()}
      />
    );
    expect(screen.queryByTestId('launch-runs')).toBeNull();
    expect(screen.getByTestId('launch-configure')).toBeTruthy();
    expect(screen.getByTestId('launch-window')).toBeTruthy();
    cleanup();
    render(<PackLaunchMenu view={translateView()} onLaunch={vi.fn()} onOpenWindow={vi.fn()} />);
    expect(screen.queryByTestId('launch-window')).toBeNull();
    cleanup();
    render(<PackLaunchMenu view={runView()} onLaunch={vi.fn()} onOpenRuns={vi.fn()} />);
    expect(screen.getByTestId('launch-runs')).toBeTruthy();
    expect(screen.queryByTestId('launch-configure')).toBeNull();
    expect(screen.queryByTestId('launch-window')).toBeNull();
  });

  it('renders a launch error under its field and a general error at the actions', () => {
    render(<PackLaunchMenu view={runView()} onLaunch={vi.fn()} error={{ optionId: 'root', message: 'Refused root' }} />);
    const rootRow = screen.getByTestId('launch-option-root');
    expect(within(rootRow).getByRole('alert').textContent).toBe('Refused root');
    cleanup();
    render(<PackLaunchMenu view={runView()} onLaunch={vi.fn()} error={{ message: 'Run start failed' }} />);
    const menu = screen.getByTestId('pack-launch-menu');
    expect(within(menu).getByRole('alert').textContent).toBe('Run start failed');
  });

  it('renders a non-blocking notice and disables the primary while launching', () => {
    render(<PackLaunchMenu view={runView()} onLaunch={vi.fn()} notice="Settings could not be saved" launching />);
    expect(screen.getByRole('status').textContent).toBe('Settings could not be saved');
    expect((screen.getByTestId('launch-primary') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('pack-launch-menu').getAttribute('aria-busy')).toBe('true');
  });

  it('is axe-clean with options and hub actions', { timeout: 30_000 }, async () => {
    const { container } = render(
      <PackLaunchMenu view={translateView()} onLaunch={vi.fn()} onOpenRuns={vi.fn()} onConfigure={vi.fn()} onOpenWindow={vi.fn()} onBrowsePath={vi.fn(async () => null)} />
    );
    await scanNoViolations(container);
  });
});

describe('hasLaunchMenu — visibility rule (plan 53 S2.4)', () => {
  it('is true with declared options, true for hub-only packs (run or window), false for a bare pack', () => {
    expect(hasLaunchMenu(translateView())).toBe(true);
    expect(hasLaunchMenu(runView())).toBe(true);
    expect(hasLaunchMenu(translateView({ launchOptions: [], capabilities: ['run'] }))).toBe(true);
    expect(hasLaunchMenu(translateView({ launchOptions: [], capabilities: ['ui:window'] }))).toBe(true);
    expect(hasLaunchMenu(translateView({ launchOptions: [], capabilities: ['ui', 'llm'] }))).toBe(false);
  });
});
