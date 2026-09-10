import { describe, it, expect } from 'vitest';
import {
  buildActiveWindowInvocation,
  buildWindowListInvocation,
  formatWindows,
  parseAppleWindowLines,
  parsePowerShellWindowLines,
  parseWindowsForPlatform,
  parseWmctrlOutput,
  activeWindowTool,
  windowListTool,
} from '@main/ai/tools/native/window-enum';
import { NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import type { NativeToolDefinition } from '@main/ai/tools/types';

const byName = (name: string): NativeToolDefinition<never> =>
  NATIVE_TOOL_CATALOG.find((tool) => tool.name === name) as unknown as NativeToolDefinition<never>;

const WMCTRL_FIXTURE = [
  '0x03a00007  0 1234 host01 Google-chrome.chrome  NixOS Forum — Mozilla Firefox',
  '0x03200003  0 8110 host01 org.gnome.Nautilus.Nautilus  Home',
  '0x05000003 -1 4321 host01 Alacritty.alacritty  ne@host01: ~/code',
].join('\n');

describe('window invocation matrices', () => {
  it('uses wmctrl with pid + class on linux', () => {
    expect(buildWindowListInvocation('linux')).toEqual({ file: 'wmctrl', args: ['-lxp'] });
    expect(buildActiveWindowInvocation('linux')).toEqual({
      file: 'xdotool',
      args: ['getactivewindow', 'getwindowname'],
    });
  });

  it('uses System Events on darwin', () => {
    expect(buildWindowListInvocation('darwin').file).toBe('osascript');
    expect(buildWindowListInvocation('darwin').args.join(' ')).toContain('System Events');
    expect(buildActiveWindowInvocation('darwin').args.join(' ')).toContain('frontmost');
  });

  it('uses PowerShell on win32', () => {
    expect(buildWindowListInvocation('win32').file).toBe('powershell.exe');
    expect(buildWindowListInvocation('win32').args.join(' ')).toContain('MainWindowTitle');
    expect(buildActiveWindowInvocation('win32').args.join(' ')).toContain('GetForegroundWindow');
  });
});

describe('parsers', () => {
  it('parses wmctrl -lxp rows defensively (skips malformed lines)', () => {
    const windows = parseWmctrlOutput(`${WMCTRL_FIXTURE}\ngarbage line\n`);
    expect(windows).toHaveLength(3);
    expect(windows[0]).toEqual({ app: 'chrome', title: 'NixOS Forum — Mozilla Firefox', pid: 1234, desktop: 0 });
    expect(windows[1].app).toBe('Nautilus');
    expect(windows[2]).toMatchObject({ app: 'alacritty', pid: 4321, desktop: -1 });
  });

  it('parses Apple "App | Title" rows', () => {
    const windows = parseAppleWindowLines('Safari | GitHub\nFinder |\n\nTerminal');
    expect(windows).toEqual([
      { app: 'Safari', title: 'GitHub' },
      { app: 'Finder', title: '' },
      { app: 'Terminal', title: '' },
    ]);
  });

  it('parses PowerShell "Name|Title|Pid" rows', () => {
    const windows = parsePowerShellWindowLines('chrome|GitHub|4242\r\nnotepad|Untitled|\r\n\r\n');
    expect(windows).toEqual([
      { app: 'chrome', title: 'GitHub', pid: 4242 },
      { app: 'notepad', title: 'Untitled', pid: undefined },
    ]);
  });

  it('dispatches by platform', () => {
    expect(parseWindowsForPlatform('darwin', 'Safari | GitHub')).toEqual([{ app: 'Safari', title: 'GitHub' }]);
    expect(parseWindowsForPlatform('win32', 'chrome|X|1')).toEqual([{ app: 'chrome', title: 'X', pid: 1 }]);
    expect(parseWindowsForPlatform('linux', WMCTRL_FIXTURE)).toHaveLength(3);
  });

  it('formats rows with pid/desktop extras and honors the limit', () => {
    const windows = parseWmctrlOutput(WMCTRL_FIXTURE);
    expect(formatWindows(windows, 2).split('\n')).toHaveLength(2);
    const text = formatWindows(windows, 3);
    expect(text).toContain('chrome: NixOS Forum — Mozilla Firefox');
    expect(text).toContain('pid 4321, desktop -1');
    expect(formatWindows([{ app: 'X', title: '' }], 5)).toContain('(no title)');
  });
});

describe('window tools registration + degradation', () => {
  it('registers both tools as read-only desktop tools', () => {
    expect(byName('window_list').risk).toBe('read-only');
    expect(byName('window_list').category).toBe('desktop');
    expect(byName('active_window').risk).toBe('read-only');
    expect(byName('active_window').category).toBe('desktop');
  });

  it('degrades gracefully when the helper binary is missing', async () => {
    const originalPath = process.env.PATH ?? '';
    process.env.PATH = '/nonexistent-da-test';
    try {
      const listed = await windowListTool.exec({}, {});
      expect(listed).toContain('Not available on this system (needs wmctrl).');
      const active = await activeWindowTool.exec({}, {});
      expect(active).toContain('Not available on this system (needs xdotool).');
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('parses a real wmctrl run when the binary exists', async () => {
    const result = await windowListTool.exec({}, {});
    if (result.includes('Not available on this system')) {
      expect(result).toContain('wmctrl');
      return;
    }
    expect(result).toMatch(/^(- .+: .+|No windows found\.)$/m);
  });
});
