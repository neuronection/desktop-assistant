import { describe, expect, it } from 'vitest';
import { mergeWithDefaults, type AppConfig, type CommandsSettings } from '@shared/config/AppConfig';

describe('commands settings merge (plan 14 S1)', () => {
  it('seeds full defaults on a legacy config', () => {
    const merged = mergeWithDefaults({});
    const commands = merged.commands;
    expect(commands.enabled).toBe(true);
    expect(commands.custom).toEqual([]);
    expect(commands.hidden).toEqual([]);
    expect(commands.pins).toEqual([]);
    expect(commands.extraAliases).toEqual({});
    expect(commands.argDefaults).toEqual({});
    expect(commands.apps).toEqual({ discovery: true, launchEnabled: true, hiddenApps: [] });
    expect(commands.web).toEqual({ behavior: 'inline', fallbackEngine: 'https://duckduckgo.com/?q=' });
    expect(commands.history).toEqual({ enabled: true, retentionDays: 90 });
    expect(commands.integrations).toEqual([]);
    expect(commands.agentCallable).toEqual({});
  });

  it('deep-merges nested command sections', () => {
    const partial = {
      commands: {
        enabled: false,
        pins: ['tool:run_shell'],
        apps: { discovery: false, launchEnabled: true, hiddenApps: ['app:vim'] },
        web: { behavior: 'browser' as const, fallbackEngine: 'https://duckduckgo.com/?q=' },
        history: { enabled: true, retentionDays: 30 },
      },
    } as Partial<AppConfig>;
    const commands: CommandsSettings = mergeWithDefaults(partial).commands;
    expect(commands.enabled).toBe(false);
    expect(commands.pins).toEqual(['tool:run_shell']);
    expect(commands.apps.discovery).toBe(false);
    expect(commands.apps.launchEnabled).toBe(true);
    expect(commands.apps.hiddenApps).toEqual(['app:vim']);
    expect(commands.history.retentionDays).toBe(30);
    expect(commands.hidden).toEqual([]);
  });

  it('merges extra aliases and agent scope maps without dropping defaults', () => {
    const merged = mergeWithDefaults({
      commands: {
        extraAliases: { 'tool:run_shell': ['sh'] },
        agentCallable: { 'tool:web_search': true },
      },
    } as Partial<AppConfig>).commands;
    expect(merged.extraAliases).toEqual({ 'tool:run_shell': ['sh'] });
    expect(merged.agentCallable).toEqual({ 'tool:web_search': true });
  });
});
