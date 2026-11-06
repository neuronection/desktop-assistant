// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ConfigRulesEditor } from '@renderer/settings-react/apps/ConfigRulesEditor';
import { PackConfigPage } from '@renderer/settings-react/apps/PackConfigPage';
import { PackPolicyEditor } from '@renderer/settings-react/apps/PackPolicyEditor';
import { QuarantineManager } from '@renderer/settings-react/apps/QuarantineManager';
import type { MiniAppView } from '@shared/app-pack';

afterEach(cleanup);

const rulesPack: MiniAppView = {
  id: 'rules-review',
  version: '1.1.0',
  kind: 'assessment',
  title: 'Rules review',
  capabilities: ['fs-read', 'decision', 'run', 'report'],
  enabled: true,
  originKind: 'bundled',
  configFields: [
    { name: 'freshDays', type: 'number', default: 14 },
    { name: 'keepRules', label: 'Keep rules', type: 'array', default: [] },
    { name: 'reviewRules', label: 'Review rules', type: 'array', default: [] },
    { name: 'junkRules', label: 'Junk rules', type: 'array', default: [] },
  ],
  configValues: { junkRules: ['*.tmp'] },
  ruleBindings: [
    { ruleId: 'user-keep', list: 'keep', configKey: 'keepRules', label: 'Keep rules' },
    { ruleId: 'user-review', list: 'ask', configKey: 'reviewRules', label: 'Review rules' },
    { ruleId: 'user-junk', list: 'candidate', configKey: 'junkRules', label: 'Junk rules' },
  ],
  classifyRules: {
    veto: [{ id: 'exceptions', when: { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.exceptions' } }],
    keep: [{ id: 'user-keep', when: { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.keepRules' } }],
    ask: [{ id: 'user-review', when: { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.reviewRules' } }],
    candidate: [
      { id: 'build-cache', when: { signal: 'meta.path', op: 'matches-any', value: ['node_modules/**'] } },
      { id: 'user-junk', when: { signal: 'meta.path', op: 'matches-any', valueSignal: 'config.junkRules' } },
    ],
  },
};

function mockApi(): { saved: Array<Record<string, unknown>> } {
  const saved: Array<Record<string, unknown>> = [];
  window.electronAPI = {
    ruleImpactPreview: vi.fn(async () => null),
    saveMiniAppConfig: vi.fn(async (_id: string, values: Record<string, unknown>) => {
      saved.push(values);
      return { ok: true, values };
    }),
  } as unknown as typeof window.electronAPI;
  return { saved };
}

function fieldsetOf(title: string): HTMLElement {
  return screen.getByText(title).closest('fieldset') as HTMLElement;
}

function renderEditor(values: Record<string, unknown>, onValuesChange = vi.fn(), onSave = vi.fn(async () => undefined)) {
  return render(<ConfigRulesEditor view={rulesPack} values={values} onValuesChange={onValuesChange} onSave={onSave} />);
}

describe('ConfigRulesEditor (plan 51 S2.3)', () => {
  it('renders one chip list per binding and adds, removes and reorders patterns', () => {
    mockApi();
    const onValuesChange = vi.fn();
    renderEditor({ junkRules: ['*.tmp', '*.bak'] }, onValuesChange);
    expect(screen.getByText('*.tmp')).toBeTruthy();
    expect(screen.getByText('*.bak')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove pattern *.tmp' }));
    expect(onValuesChange).toHaveBeenCalledWith({ junkRules: ['*.bak'] });
    onValuesChange.mockClear();
    const junk = fieldsetOf('Junk rules');
    fireEvent.click(within(junk).getByRole('button', { name: 'Move pattern *.tmp down' }));
    expect(onValuesChange).toHaveBeenCalledWith({ junkRules: ['*.bak', '*.tmp'] });
    const addInput = within(junk).getByRole('textbox', { name: 'Add a pattern to Junk rules' });
    fireEvent.change(addInput, { target: { value: 'dist/**' } });
    fireEvent.click(within(junk).getByRole('button', { name: /^Add$/ }));
    expect(onValuesChange).toHaveBeenLastCalledWith({ junkRules: ['*.tmp', '*.bak', 'dist/**'] });
  });

  it('refuses empty patterns and warns on a bare ** glob', () => {
    mockApi();
    renderEditor({});
    const junk = fieldsetOf('Junk rules');
    const addInput = within(junk).getByRole('textbox', { name: 'Add a pattern to Junk rules' });
    const addButton = within(junk).getByRole('button', { name: /^Add$/ });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(addInput, { target: { value: '   ' } });
    expect((addButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(addInput, { target: { value: '**' } });
    expect((addButton as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/matches everything/)).toBeTruthy();
  });

  it('adds a snippet chip in one click', () => {
    mockApi();
    const onValuesChange = vi.fn();
    renderEditor({}, onValuesChange);
    const junk = fieldsetOf('Junk rules');
    fireEvent.click(within(junk).getByRole('button', { name: 'Add pattern node_modules/**' }));
    expect(onValuesChange).toHaveBeenCalledWith({ junkRules: ['node_modules/**'] });
    expect(onValuesChange).toHaveBeenCalledTimes(1);
  });

  it('the simulator prints the deciding rule, basename matching and :days reasoning', () => {
    mockApi();
    renderEditor({ junkRules: ['*.log:30'] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Path' }), { target: { value: 'src/data/app.log' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Age (days)' }), { target: { value: '12' } });
    expect(screen.getByTestId('rules-simulator-verdict').textContent).toContain('No rule decides');
    expect(screen.getAllByText('matches, but the age is under the :days minimum').length).toBe(1);
    fireEvent.change(screen.getByRole('textbox', { name: 'Age (days)' }), { target: { value: '45' } });
    expect(screen.getByTestId('rules-simulator-verdict').textContent).toContain('candidate — Junk rules');
    expect(screen.getAllByText('matches — decides').length).toBe(1);
  });

  it('flags host-baseline paths before any rule', () => {
    mockApi();
    renderEditor({ junkRules: ['*.key'] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Path' }), { target: { value: 'certs/server.key' } });
    expect(screen.getByTestId('rules-simulator-host')).toBeTruthy();
    expect(screen.queryByTestId('rules-simulator-verdict')).toBeNull();
  });

  it('renders nothing without bindings', () => {
    mockApi();
    const { container } = render(
      <ConfigRulesEditor view={{ ...rulesPack, ruleBindings: undefined }} values={{}} onValuesChange={vi.fn()} onSave={vi.fn(async () => undefined)} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('saves the edited lists through the page save path and coexists with the generic form', async () => {
    const { saved } = mockApi();
    render(
      <PackConfigPage
        view={rulesPack}
        onBack={vi.fn()}
        onEnabledChange={vi.fn()}
        onConfigSave={async (values) => {
          const result = await window.electronAPI.saveMiniAppConfig(rulesPack.id, values);
          return result.ok ? null : result.error;
        }}
      />
    );
    const editor = screen.getByTestId('rules-editor-rules-review');
    expect(editor).toBeTruthy();
    expect(screen.getByText('Pack settings')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /Junk rules/ })).toBeTruthy();
    const junk = within(editor).getByText('Junk rules').closest('fieldset') as HTMLElement;
    const addInput = within(junk).getByRole('textbox', { name: 'Add a pattern to Junk rules' });
    fireEvent.change(addInput, { target: { value: 'coverage/**' } });
    fireEvent.click(within(junk).getByRole('button', { name: /^Add$/ }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(saved.length).toBeGreaterThan(0));
    expect(saved[0].junkRules).toEqual(['*.tmp', 'coverage/**']);
  });
});

describe('PackConfigPage — config export/import (plan 51 S4.3)', () => {
  function configApi() {
    const savedFiles: { defaultPath: string; content: string }[] = [];
    let imported: string | null = null;
    window.electronAPI = {
      ruleImpactPreview: vi.fn(async () => null),
      saveFile: vi.fn(async (input: { defaultPath: string; content: string }) => {
        savedFiles.push(input);
        return input.defaultPath;
      }),
      openFile: vi.fn(async () => (imported === null ? null : { filePath: 'config.json', content: imported })),
      saveMiniAppConfig: vi.fn(async (_id: string, values: Record<string, unknown>) => ({ ok: true, values })),
    } as unknown as typeof window.electronAPI;
    return {
      savedFiles,
      setImported: (content: string | null) => {
        imported = content;
      },
    };
  }

  const plainPack: MiniAppView = {
    ...rulesPack,
    ruleBindings: undefined,
    classifyRules: undefined,
    configFields: [
      { name: 'freshDays', type: 'number', default: 14 },
      { name: 'exceptions', label: 'Exception globs', type: 'array', default: [] },
    ],
    configValues: { freshDays: 30, exceptions: ['keep/**'] },
  };

  it('exports the effective config as JSON through the save dialog', async () => {
    const api = configApi();
    render(<PackConfigPage view={plainPack} onBack={vi.fn()} onEnabledChange={vi.fn()} onConfigSave={vi.fn(async () => null)} />);
    fireEvent.click(screen.getByTestId('config-export'));
    await waitFor(() => expect(api.savedFiles).toHaveLength(1));
    expect(api.savedFiles[0].defaultPath).toBe('rules-review-config.json');
    expect(JSON.parse(api.savedFiles[0].content)).toMatchObject({ freshDays: 30, exceptions: ['keep/**'] });
    expect(await screen.findByText('Settings exported')).toBeTruthy();
  });

  it('imports a config file, validates main-side through the save path, and rejects invalid JSON', async () => {
    const api = configApi();
    const onConfigSave = vi.fn(async (values: Record<string, unknown>) => {
      if (values.freshDays !== undefined && typeof values.freshDays !== 'number') {
        return 'freshDays must be a number';
      }
      return null;
    });
    render(<PackConfigPage view={plainPack} onBack={vi.fn()} onEnabledChange={vi.fn()} onConfigSave={onConfigSave} />);
    fireEvent.click(screen.getByTestId('config-import'));
    await waitFor(() => expect(window.electronAPI.openFile).toHaveBeenCalled());
    expect(onConfigSave).not.toHaveBeenCalled();

    api.setImported('not json');
    fireEvent.click(screen.getByTestId('config-import'));
    expect(await screen.findByText(/Import failed/)).toBeTruthy();

    api.setImported(JSON.stringify({ freshDays: 7, exceptions: ['other/**'] }));
    fireEvent.click(screen.getByTestId('config-import'));
    await waitFor(() => expect(onConfigSave).toHaveBeenCalledWith(expect.objectContaining({ freshDays: 7, exceptions: ['other/**'] })));
    expect(screen.getByRole('status').textContent).toBe('Saved');
  });
});

describe('QuarantineManager — trashed receipts (plan 51 S4.7)', () => {
  it('shows trashed records with no Restore button and the file-manager hint', async () => {
    window.electronAPI = {
      listMiniAppQuarantine: vi.fn(async () => ({
        packId: 'pack',
        records: [
          { id: 'r1', relPath: 'a.log', originPath: '/x', movedAt: 1, restoredAt: null, destination: 'system-trash' },
          { id: 'r2', relPath: 'b.log', originPath: '/y', movedAt: 2, restoredAt: null, destination: 'app-store' },
        ],
      })),
      restoreMiniAppQuarantineRecord: vi.fn(async () => ({ ok: true, restoredPath: '/r' })),
    } as unknown as typeof window.electronAPI;
    render(<QuarantineManager packId="pack" packTitle="Pack" onEmptied={vi.fn(async () => undefined)} />);
    await screen.findByText('a.log');
    const list = screen.getByText('a.log').closest('li') as HTMLElement;
    expect(within(list).getByText('In system trash')).toBeTruthy();
    expect(within(list).getByText('Restore from your file manager — the app cannot.')).toBeTruthy();
    expect(within(list).queryByRole('button', { name: 'Restore' })).toBeNull();
    const storeRow = screen.getByText('b.log').closest('li') as HTMLElement;
    expect(within(storeRow).getByRole('button', { name: 'Restore' })).toBeTruthy();
  });
});

describe('PackPolicyEditor (plan 51 S5.1)', () => {
  function policyApi() {
    window.electronAPI = {
      ruleImpactPreview: vi.fn(async () => null),
      saveMiniAppConfig: vi.fn(async (_id: string, values: Record<string, unknown>) => ({ ok: true, values })),
    } as unknown as typeof window.electronAPI;
  }

  function policyPack(guidelines: string): MiniAppView {
    return {
      ...rulesPack,
      ruleBindings: undefined,
      classifyRules: undefined,
      configFields: [
        { name: 'freshDays', type: 'number', default: 14 },
        { name: 'guidelines', label: 'Extra guidelines', type: 'string', default: '' },
      ],
      configValues: { guidelines },
    };
  }

  it('composes the deterministic labeled format from structured inputs and shows the preview', async () => {
    policyApi();
    const onConfigSave = vi.fn(async () => null);
    render(<PackConfigPage view={policyPack('')} onBack={vi.fn()} onEnabledChange={vi.fn()} onConfigSave={onConfigSave} />);
    fireEvent.change(screen.getByTestId('policy-keep'), { target: { value: 'contracts/**\nmanuals/**' } });
    fireEvent.change(screen.getByTestId('policy-never'), { target: { value: 'photos/family/**' } });
    fireEvent.change(screen.getByTestId('policy-hint-safe'), { target: { value: 'generated files are safe' } });
    fireEvent.change(screen.getByTestId('policy-hint-recoverability'), { target: { value: 'version-controlled files are regenerable' } });
    const preview = screen.getByTestId('policy-preview').textContent ?? '';
    expect(preview).toContain('ALWAYS KEEP:\n- contracts/**\n- manuals/**');
    expect(preview).toContain('NEVER DELETE:\n- photos/family/**');
    expect(preview).toContain('SCORING HINTS — safe: generated files are safe; recoverability: version-controlled files are regenerable');
  });

  it('parses an existing composed guidelines string back into the structured fields', () => {
    render(
      <PackPolicyEditor
        guidelines={'ALWAYS KEEP:\n- contracts/**\nALWAYS REVIEW:\n- giant/**\nSCORING HINTS — safe: builds; recoverability: git-backed means regenerable'}
        onChange={vi.fn()}
      />
    );
    expect((screen.getByTestId('policy-keep') as HTMLTextAreaElement).value).toBe('contracts/**');
    expect((screen.getByTestId('policy-hint-safe') as HTMLInputElement).value).toBe('builds');
    expect((screen.getByTestId('policy-hint-recoverability') as HTMLInputElement).value).toBe('git-backed means regenerable');
  });
});

describe('Rule drafting (plan 51 S6.2)', () => {
  it('is absent when the toggle is off; drafts land as chips that join a list only when added', async () => {
    window.electronAPI = {
      ruleImpactPreview: vi.fn(async () => null),
      draftMiniAppRules: vi.fn(async () => ({ ok: true, globs: ['*.afdesign', 'assets/**'] })),
    } as unknown as typeof window.electronAPI;
    const off: MiniAppView = { ...rulesPack, configValues: { ...rulesPack.configValues, ruleDrafting: false } };
    const { unmount } = render(<ConfigRulesEditor view={off} values={{ junkRules: [] }} onValuesChange={vi.fn()} onSave={vi.fn(async () => undefined)} />);
    expect(screen.queryByTestId('rules-drafting')).toBeNull();
    unmount();

    const onValuesChange = vi.fn();
    const on: MiniAppView = { ...rulesPack, configValues: { ...rulesPack.configValues, ruleDrafting: true } };
    render(<ConfigRulesEditor view={on} values={{ junkRules: [] }} onValuesChange={onValuesChange} onSave={vi.fn(async () => undefined)} />);
    expect(screen.getByTestId('rules-drafting')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Describe the files to match' }), { target: { value: 'affinity designer files' } });
    fireEvent.click(screen.getByTestId('rules-draft-go'));
    await waitFor(() => expect(screen.getByTestId('rules-draft-add-*.afdesign')).toBeTruthy());
    fireEvent.change(screen.getByTestId('rules-draft-list'), { target: { value: 'candidate' } });
    fireEvent.click(screen.getByTestId('rules-draft-add-*.afdesign'));
    expect(onValuesChange).toHaveBeenCalledWith({ junkRules: ['*.afdesign'] });
  });
});

describe('Rule learning card (plan 51 S6.3)', () => {
  it('accepting a suggestion writes the globs into keep rules through save-config; dismissing writes nothing', async () => {
    const saveConfig = vi.fn(async (_id: string, values: Record<string, unknown>) => ({ ok: true, values }));
    window.electronAPI = {
      listMiniAppFeedback: vi.fn(async () => [
        { relPath: 'a.afdesign', rootPath: '/r', verdict: 'keep', source: 'override' },
        { relPath: 'b.afdesign', rootPath: '/r', verdict: 'keep', source: 'override' },
        { relPath: 'c.afdesign', rootPath: '/r', verdict: 'keep', source: 'override' },
      ]),
      clearMiniAppFeedback: vi.fn(async () => 0),
      learnMiniAppRules: vi.fn(async () => ({ ok: true, globs: ['*.afdesign'], source: 'pattern' })),
      getMiniApps: vi.fn(async () => ({
        masterEnabled: true,
        packs: [{
          id: 'pack',
          configValues: { keepRules: ['docs/**'] },
          ruleBindings: [{ ruleId: 'user-keep', list: 'keep', configKey: 'keepRules', label: 'Keep rules' }],
        }],
        removedBundled: [],
      })),
      saveMiniAppConfig: saveConfig,
    } as unknown as typeof window.electronAPI;
    const { OverridesManager } = await import('@renderer/settings-react/apps/OverridesManager');
    render(<OverridesManager packId="pack" />);
    fireEvent.click(await screen.findByTestId('overrides-suggest'));
    const card = await screen.findByTestId('overrides-suggestion');
    expect(card.textContent).toContain('*.afdesign');
    expect(card.textContent).toContain('pattern');
    fireEvent.click(screen.getByTestId('overrides-suggestion-accept'));
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith('pack', expect.objectContaining({ keepRules: ['docs/**', '*.afdesign'] })));
    expect(screen.queryByTestId('overrides-suggestion')).toBeNull();

    window.electronAPI.learnMiniAppRules = vi.fn(async () => ({ ok: true, globs: ['*.x'], source: 'model' })) as unknown as typeof window.electronAPI.learnMiniAppRules;
    fireEvent.click(screen.getByTestId('overrides-suggest'));
    await screen.findByTestId('overrides-suggestion');
    fireEvent.click(screen.getByTestId('overrides-suggestion-reject'));
    expect(screen.queryByTestId('overrides-suggestion')).toBeNull();
    expect(saveConfig).toHaveBeenCalledTimes(1);
  });
});
