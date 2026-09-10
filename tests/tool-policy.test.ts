import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import {
  ToolPolicyEngine,
  defaultPolicySnapshot,
  conditionMatches,
  deriveGrantRoot,
  extractPathArgs,
  matchesAnyCondition,
  resolveVerification,
  resolveWithinRoot,
  resolveWithinGrantedRoots,
  isSubpath,
  type ToolPolicySnapshot,
} from '@main/ai/tools/policy';

function makeEngine(overrides: Partial<ToolPolicySnapshot> = {}, sessionGrant?: string) {
  let snapshot: ToolPolicySnapshot = {
    toolGrants: {},
    disabledTools: [],
    grantedRoots: [],
    toolSettings: {},
    classDefaults: {},
    ...overrides,
  };
  const engine = new ToolPolicyEngine(
    () => snapshot,
    async (toolName) => {
      snapshot = { ...snapshot, toolGrants: { ...snapshot.toolGrants, [toolName]: 'always' } };
    }
  );
  if (sessionGrant) {
    engine.grantSession(sessionGrant);
  }
  return engine;
}

describe('ToolPolicyEngine decision matrix', () => {
  it('auto-runs read-only tools', () => {
    const engine = makeEngine();
    expect(engine.decision('screen_capture', 'read-only')).toBe('run');
    expect(engine.needsApproval('screen_capture', 'read-only')).toBe(false);
    expect(engine.grantSource('screen_capture', 'read-only')).toBe('auto');
  });

  it('asks before clipboard reads even though they are read-only, unless overridden', () => {
    const engine = makeEngine();
    expect(engine.resolveVerificationFor('clipboard_read', 'read-only').settings).toEqual({
      mode: 'always_ask',
    });
    expect(engine.needsApproval('clipboard_read', 'read-only')).toBe(true);

    const overridden = makeEngine({
      toolSettings: { clipboard_read: { mode: 'never' } },
      disabledTools: [],
      grantedRoots: [],
      toolGrants: {},
      classDefaults: {},
    });
    expect(overridden.resolveVerificationFor('clipboard_read', 'read-only')).toEqual({
      settings: { mode: 'never' },
      custom: true,
    });
    expect(overridden.needsApproval('clipboard_read', 'read-only')).toBe(false);
  });

  it('requires approval for state-changing and destructive tools by default', () => {
    const engine = makeEngine();
    expect(engine.decision('open_url', 'state-changing')).toBe('approve');
    expect(engine.decision('run_shell', 'destructive')).toBe('approve');
    expect(engine.needsApproval('open_url', 'state-changing')).toBe(true);
    expect(engine.grantSource('open_url', 'state-changing')).toBe('once');
  });

  it('denies disabled tools regardless of risk or grants', () => {
    const engine = makeEngine(
      { disabledTools: ['open_url'], toolGrants: { open_url: 'always' }, grantedRoots: [] },
      'open_url'
    );
    expect(engine.decision('open_url', 'state-changing')).toBe('deny');
    expect(engine.needsApproval('open_url', 'state-changing')).toBe(false);
    expect(engine.isDisabled('open_url')).toBe(true);
  });

  it('runs state-changing tools with a session grant and reports the source', () => {
    const engine = makeEngine({}, 'clipboard_write');
    expect(engine.decision('clipboard_write', 'state-changing')).toBe('run');
    expect(engine.grantSource('clipboard_write', 'state-changing')).toBe('session');
    expect(engine.sessionGrantsList()).toEqual(['clipboard_write']);
  });

  it('runs state-changing tools with a persistent always grant and reports the source', () => {
    const engine = makeEngine({ toolGrants: { notify: 'always' }, disabledTools: [], grantedRoots: [] });
    expect(engine.decision('notify', 'state-changing')).toBe('run');
    expect(engine.grantSource('notify', 'state-changing')).toBe('always');
  });

  it('prefers the session grant source when both grants exist', () => {
    const engine = makeEngine({ toolGrants: { notify: 'always' }, disabledTools: [], grantedRoots: [] }, 'notify');
    expect(engine.grantSource('notify', 'state-changing')).toBe('session');
  });

  it('clearSession revokes in-memory grants only', () => {
    const engine = makeEngine({ toolGrants: { notify: 'always' }, disabledTools: [], grantedRoots: [] }, 'open_url');
    engine.clearSession();
    expect(engine.decision('open_url', 'state-changing')).toBe('approve');
    expect(engine.decision('notify', 'state-changing')).toBe('run');
  });

  it('grantAlways persists through the callback and flips the decision', async () => {
    const engine = makeEngine();
    expect(engine.decision('volume_set', 'state-changing')).toBe('approve');
    await engine.grantAlways('volume_set');
    expect(engine.decision('volume_set', 'state-changing')).toBe('run');
    expect(engine.grantSource('volume_set', 'state-changing')).toBe('always');
  });

  it('snapshot deep-copies the live config', () => {
    const engine = makeEngine({ toolGrants: { a: 'always' }, disabledTools: ['b'], grantedRoots: ['/tmp/x'] });
    const snap = engine.snapshot();
    snap.toolGrants.a = undefined as unknown as 'always';
    snap.disabledTools.push('c');
    snap.grantedRoots.push('/elsewhere');
    expect(engine.snapshot().toolGrants.a).toBe('always');
    expect(engine.snapshot().disabledTools).toEqual(['b']);
    expect(engine.snapshot().grantedRoots).toEqual(['/tmp/x']);
  });

  it('defaultPolicySnapshot tolerates missing settings', () => {
    expect(defaultPolicySnapshot(undefined)).toEqual({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: [],
      toolSettings: {},
      classDefaults: {},
    });
    expect(defaultPolicySnapshot({ toolGrants: { x: 'always' }, disabledTools: [], grantedRoots: [] })).toMatchObject({
      toolGrants: { x: 'always' },
    });
  });

  it('resolveVerificationFor reports per-tool overrides as custom', () => {
    const engine = makeEngine({
      toolSettings: { notify: { mode: 'always_ask' } },
      disabledTools: [],
      grantedRoots: [],
      toolGrants: {},
      classDefaults: {},
    });
    expect(engine.resolveVerificationFor('notify', 'state-changing')).toEqual({
      settings: { mode: 'always_ask' },
      custom: true,
    });
    expect(engine.resolveVerificationFor('volume_set', 'state-changing')).toEqual({
      settings: { mode: 'standard' },
      custom: false,
    });
  });
});

describe('class-level default verification', () => {
  it('read-only class default always_ask forces confirmation on read-only tools', () => {
    const engine = makeEngine({ classDefaults: { readOnly: 'always_ask' }, disabledTools: [], grantedRoots: [], toolGrants: {}, toolSettings: {} });
    expect(engine.decision('screen_capture', 'read-only')).toBe('approve');
    expect(engine.grantSource('screen_capture', 'read-only')).toBe('once');
  });

  it('state-changing class default never auto-runs harmless tools and audits as policy', () => {
    const engine = makeEngine({ classDefaults: { stateChanging: 'never' }, disabledTools: [], grantedRoots: [], toolGrants: {}, toolSettings: {} });
    expect(engine.decision('volume_set', 'state-changing')).toBe('run');
    expect(engine.decision('power_sleep', 'state-changing')).toBe('run');
    expect(engine.grantSource('volume_set', 'state-changing')).toBe('policy');
  });

  it('state-changing class default always_ask beats session and persistent grants', () => {
    const engine = makeEngine(
      { classDefaults: { stateChanging: 'always_ask' }, toolGrants: { notify: 'always' }, disabledTools: [], grantedRoots: [], toolSettings: {} },
      'notify'
    );
    expect(engine.decision('notify', 'state-changing')).toBe('approve');
  });

  it('class defaults never weaken the destructive lock', () => {
    const engine = makeEngine({
      classDefaults: { stateChanging: 'never', readOnly: 'run' },
      disabledTools: [],
      grantedRoots: [],
      toolGrants: {},
      toolSettings: {},
    });
    expect(engine.decision('run_shell', 'destructive')).toBe('approve');
    expect(engine.decision('power_shutdown', 'destructive')).toBe('approve');
  });

  it('class defaults skip MCP tools so presets cannot auto-run third-party code', () => {
    const engine = makeEngine({ classDefaults: { stateChanging: 'never' }, disabledTools: [], grantedRoots: [], toolGrants: {}, toolSettings: {} });
    expect(engine.decision('mcp__docs__search', 'state-changing')).toBe('approve');
    expect(engine.grantSource('mcp__docs__search', 'state-changing')).toBe('once');
  });

  it('a per-tool override beats the class default in both directions', () => {
    const engine = makeEngine({
      classDefaults: { stateChanging: 'never' },
      toolSettings: { file_write: { mode: 'always_ask' } },
      disabledTools: [],
      grantedRoots: [],
      toolGrants: {},
    });
    expect(engine.decision('file_write', 'state-changing', { path: '/x' })).toBe('approve');
    expect(engine.decision('volume_set', 'state-changing')).toBe('run');
  });

  it('resolveVerification flags custom overrides and class-driven defaults', () => {
    const snapshot = {
      toolSettings: { read_file: { mode: 'conditions' as const, conditions: [] } },
      classDefaults: { readOnly: 'always_ask' as const, stateChanging: 'never' as const },
    };
    expect(resolveVerification('read_file', 'read-only', snapshot)).toEqual({
      settings: { mode: 'conditions', conditions: [] },
      custom: true,
    });
    expect(resolveVerification('screen_capture', 'read-only', snapshot)).toEqual({
      settings: { mode: 'always_ask' },
      custom: false,
    });
    expect(resolveVerification('notify', 'state-changing', snapshot)).toEqual({
      settings: { mode: 'never' },
      custom: false,
    });
    expect(resolveVerification('mcp__srv__tool', 'state-changing', snapshot)).toEqual({
      settings: { mode: 'standard' },
      custom: false,
    });
  });
});

describe('per-tool verification settings', () => {
  it('always_ask forces approval even for read-only and granted tools', () => {
    const engine = makeEngine(
      { toolSettings: { read_file: { mode: 'always_ask' }, notify: { mode: 'always_ask' } }, toolGrants: { notify: 'always' }, disabledTools: [], grantedRoots: [] },
      'notify'
    );
    expect(engine.decision('read_file', 'read-only')).toBe('approve');
    expect(engine.needsApproval('read_file', 'read-only')).toBe(true);
    expect(engine.decision('notify', 'state-changing')).toBe('approve');
    expect(engine.grantSource('notify', 'state-changing')).toBe('once');
  });

  it('never auto-runs state-changing tools and reports the policy source', () => {
    const engine = makeEngine({ toolSettings: { clipboard_write: { mode: 'never' } }, disabledTools: [], grantedRoots: [], toolGrants: {} });
    expect(engine.decision('clipboard_write', 'state-changing')).toBe('run');
    expect(engine.grantSource('clipboard_write', 'state-changing')).toBe('policy');
  });

  it('never cannot bypass the destructive lock', () => {
    const engine = makeEngine({ toolSettings: { run_shell: { mode: 'never' } }, disabledTools: [], grantedRoots: [], toolGrants: {} });
    expect(engine.decision('run_shell', 'destructive')).toBe('approve');
  });

  it('conditions ask only when a rule matches the call arguments', () => {
    const engine = makeEngine({
      toolSettings: {
        open_url: { mode: 'conditions', conditions: [{ param: 'url', operator: 'contains', value: 'intranet' }] },
      },
      disabledTools: [],
      grantedRoots: [],
      toolGrants: {},
    });
    expect(engine.decision('open_url', 'state-changing', { url: 'https://example.com' })).toBe('run');
    expect(engine.decision('open_url', 'state-changing', { url: 'https://intranet.corp/x' })).toBe('approve');
    expect(engine.grantSource('open_url', 'state-changing', { url: 'https://example.com' })).toBe('policy');
    expect(engine.grantSource('open_url', 'state-changing', { url: 'https://intranet.corp/x' })).toBe('once');
  });

  it('conditions with no matching rules run silently and an empty rule set never asks', () => {
    const engine = makeEngine({
      toolSettings: {
        file_write: { mode: 'conditions', conditions: [] },
        file_create: { mode: 'conditions' },
      },
      disabledTools: [],
      grantedRoots: [],
      toolGrants: {},
    });
    expect(engine.decision('file_write', 'state-changing', { path: '/x' })).toBe('run');
    expect(engine.decision('file_create', 'state-changing', { path: '/x' })).toBe('run');
  });

  it('conditions cannot bypass the destructive lock', () => {
    const engine = makeEngine({
      toolSettings: {
        file_delete: { mode: 'conditions', conditions: [{ param: 'path', operator: 'contains', value: 'tmp' }] },
      },
      disabledTools: [],
      grantedRoots: [],
      toolGrants: {},
    });
    expect(engine.decision('file_delete', 'destructive', { path: '/tmp/x' })).toBe('approve');
  });

  it('falls back to standard for unknown tools', () => {
    const engine = makeEngine();
    expect(engine.resolveVerificationFor('whatever', 'state-changing')).toEqual({ settings: { mode: 'standard' }, custom: false });
  });

  it('disabled tools still deny under any verification mode', () => {
    const engine = makeEngine({
      toolSettings: { open_url: { mode: 'never' } },
      disabledTools: ['open_url'],
      grantedRoots: [],
      toolGrants: {},
    });
    expect(engine.decision('open_url', 'state-changing')).toBe('deny');
  });

  it('snapshot deep-copies verification settings and class defaults', () => {
    const engine = makeEngine({ toolSettings: { a: { mode: 'never' } }, classDefaults: { stateChanging: 'never' }, disabledTools: [], grantedRoots: [], toolGrants: {} });
    const snap = engine.snapshot();
    snap.toolSettings.a = { mode: 'always_ask' };
    snap.classDefaults.stateChanging = 'always_ask';
    expect(engine.resolveVerificationFor('a', 'state-changing').settings).toEqual({ mode: 'never' });
    expect(engine.resolveVerificationFor('b', 'state-changing').settings).toEqual({ mode: 'never' });
  });
});

describe('verification condition matching', () => {
  const cases: [Parameters<typeof conditionMatches>[0], unknown, boolean][] = [
    [{ param: 'cmd', operator: 'present' }, { cmd: 'ls' }, true],
    [{ param: 'cmd', operator: 'present' }, {}, false],
    [{ param: 'cmd', operator: 'absent' }, {}, true],
    [{ param: 'cmd', operator: 'absent' }, { cmd: 'ls' }, false],
    [{ param: 'cmd', operator: 'equals', value: 'ls' }, { cmd: 'ls' }, true],
    [{ param: 'cmd', operator: 'equals', value: 'ls' }, { cmd: 'ls -la' }, false],
    [{ param: 'cmd', operator: 'not_equals', value: 'ls' }, { cmd: 'rm' }, true],
    [{ param: 'url', operator: 'contains', value: 'CORP' }, { url: 'https://corp.example' }, true],
    [{ param: 'timeoutMs', operator: 'gt', value: '60' }, { timeoutMs: 61 }, true],
    [{ param: 'timeoutMs', operator: 'gt', value: '60' }, { timeoutMs: 60 }, false],
    [{ param: 'timeoutMs', operator: 'lt', value: '10' }, { timeoutMs: '5' }, true],
    [{ param: 'cmd', operator: 'matches', value: '^rm\\b' }, { cmd: 'rm -rf /' }, true],
    [{ param: 'cmd', operator: 'matches', value: '^rm\\b' }, { cmd: 'ls' }, false],
    [{ param: 'cmd', operator: 'matches', value: '(' }, { cmd: 'anything' }, false],
    [{ param: 'n', operator: 'gt', value: '5' }, { n: 'not-a-number' }, false],
  ];

  for (const [condition, args, expected] of cases) {
    it(`${condition.operator} ${condition.param} vs ${JSON.stringify(args)} → ${expected}`, () => {
      expect(conditionMatches(condition, args)).toBe(expected);
    });
  }

  it('matchesAnyCondition requires at least one match and tolerates non-object args', () => {
    expect(matchesAnyCondition([{ param: 'a', operator: 'present' }], { a: 1 })).toBe(true);
    expect(matchesAnyCondition([{ param: 'a', operator: 'present' }, { param: 'b', operator: 'present' }], {})).toBe(false);
    expect(matchesAnyCondition([{ param: 'x', operator: 'absent' }], 'string')).toBe(true);
    expect(matchesAnyCondition(undefined, { a: 1 })).toBe(false);
  });
});

describe('granted-root path resolution', () => {
  it('resolves paths inside a root', () => {
    const inside = resolveWithinRoot('/home/user/project', '/home/user/project/src/app.ts');
    expect(inside).toBe(resolve('/home/user/project/src/app.ts'));
    expect(resolveWithinRoot('/home/user/project', '/home/user/project')).toBe(resolve('/home/user/project'));
  });

  it('rejects traversal outside the root', () => {
    expect(resolveWithinRoot('/home/user/project', '/home/user/project/../secrets.txt')).toBeNull();
    expect(resolveWithinRoot('/home/user/project', '/etc/passwd')).toBeNull();
    expect(resolveWithinRoot('/home/user/project', '../../etc/passwd')).toBeNull();
  });

  it('rejects sibling directories with shared prefixes', () => {
    expect(resolveWithinRoot('/home/user/project', '/home/user/project-evil/file')).toBeNull();
  });

  it('resolves against any granted root', () => {
    const roots = ['/home/user/project-a', '/home/user/project-b'];
    expect(resolveWithinGrantedRoots(roots, '/home/user/project-b/notes.md')).toBe(
      resolve('/home/user/project-b/notes.md')
    );
    expect(resolveWithinGrantedRoots(roots, '/home/user/project-c/notes.md')).toBeNull();
    expect(resolveWithinGrantedRoots([], '/anything')).toBeNull();
  });

  it('isSubpath rejects the parent itself and outside children', () => {
    expect(isSubpath('/a/b', '/a/b/c')).toBe(true);
    expect(isSubpath('/a/b', '/a/b')).toBe(false);
    expect(isSubpath('/a/b', '/a/bc')).toBe(false);
  });
});

describe('HITL root-grant requests', () => {
  const pathArgs = ['path'];

  it('extracts path args defensively', () => {
    expect(extractPathArgs({ path: '/tmp/a', other: 1 }, ['path'])).toEqual(['/tmp/a']);
    expect(extractPathArgs({ from: '/a', to: '/b' }, ['from', 'to'])).toEqual(['/a', '/b']);
    expect(extractPathArgs({ root: 42 }, ['root'])).toEqual([]);
    expect(extractPathArgs(undefined, ['path'])).toEqual([]);
  });

  it('derives the nearest existing ancestor as grant root', () => {
    const dir = mkdtempSync(join(tmpdir(), 'da-rootgrant-'));
    try {
      expect(deriveGrantRoot(dir)).toBe(resolve(dir));
      expect(deriveGrantRoot(join(dir, 'file.txt'))).toBe(resolve(dir));
      const deep = join(dir, 'a', 'b', 'new.txt');
      mkdirSync(join(dir, 'a', 'b'), { recursive: true });
      expect(deriveGrantRoot(deep)).toBe(resolve(join(dir, 'a', 'b')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to propose the filesystem root', () => {
    expect(deriveGrantRoot('/')).toBeNull();
    expect(deriveGrantRoot('/definitely-not-existing-dir-xyz')).toBeNull();
  });

  it('flags only paths outside the granted roots', () => {
    const engine = new ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: ['/home/user/project'],
      toolSettings: {},
      classDefaults: {},
    }));
    expect(engine.needsRootGrant(pathArgs, { path: '/home/user/project/src/a.ts' })).toBe(false);
    expect(engine.needsRootGrant(pathArgs, { path: '/etc/passwd' })).toBe(true);
    expect(engine.needsRootGrant(undefined, { path: '/etc/passwd' })).toBe(false);
    expect(engine.needsRootGrant(['root'], { pattern: '*.md' })).toBe(false);
    expect(engine.rootsNeedingGrant(pathArgs, { path: '/etc/passwd' })).toEqual([resolve('/etc')]);
  });

  it('session roots extend grantedRoots and clearSession drops them', () => {
    const engine = new ToolPolicyEngine(() => ({
      toolGrants: {},
      disabledTools: [],
      grantedRoots: ['/home/user/project'],
      toolSettings: {},
      classDefaults: {},
    }));
    engine.grantRootSession('/home/user/notes');
    expect(engine.grantedRoots()).toContain(resolve('/home/user/notes'));
    expect(engine.needsRootGrant(pathArgs, { path: '/home/user/notes/a.md' })).toBe(false);
    engine.clearSession();
    expect(engine.needsRootGrant(pathArgs, { path: '/home/user/notes/a.md' })).toBe(true);
  });

  it('persists always-granted roots through the write-back callback', async () => {
    const persisted: string[] = [];
    const engine = new ToolPolicyEngine(
      () => ({ toolGrants: {}, disabledTools: [], grantedRoots: [], toolSettings: {}, classDefaults: {} }),
      undefined,
      async (root) => {
        persisted.push(root);
      }
    );
    await engine.grantRootAlways('/home/user/notes');
    expect(persisted).toEqual([resolve('/home/user/notes')]);
    expect(engine.grantedRoots()).toContain(resolve('/home/user/notes'));
  });
});
