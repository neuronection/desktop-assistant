import { execFile } from 'node:child_process';
import type { CaptureDisplayLike, CaptureRect, CaptureWindowRect } from '@shared/capture';

/**
 * Window geometry discovery for the capture ladder (plan 80, D3/D5).
 *
 * One interface, three realities: X11 reads `wmctrl` (and the stacking list
 * for z-order), Windows runs one user32 enumeration script, macOS has no
 * supported surface from Electron and reports nothing (the overlay's drag is
 * the primary path there). Rects come back in the OS's native pixels; the
 * service converts them to DIP with `nativeRectsToDip`.
 */

export type CaptureExec = (file: string, args: string[], options: { timeout: number }) => Promise<string>;

export interface NativeWindowRect {
  title: string;
  app?: string;
  /** Physical pixels, screen-global. */
  rect: CaptureRect;
}

export type CaptureScaleMode = 'global' | 'per-display';

export interface CaptureGeometryProvider {
  readonly kind: 'x11' | 'win32' | 'none';
  readonly scaleMode: CaptureScaleMode;
  /** Top-first windows in native pixels, or `null` when the OS cannot report them. */
  windows(): Promise<NativeWindowRect[] | null>;
}

const defaultExec: CaptureExec = (file, args, options) =>
  new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: options.timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(String(stdout));
      }
    );
  });

const X11_TIMEOUT_MS = 1_500;
const WIN32_TIMEOUT_MS = 3_000;

/** Desktop shells and docks are never a capture target. */
const SHELL_CLASSES = new Set([
  'desktop',
  'nemo-desktop',
  'nautilus-desktop',
  'cinnamon',
  'plank',
  'docky',
  'latte',
  'polybar',
  'tint2',
  'waybar',
]);

interface X11Entry extends NativeWindowRect {
  id: string;
}

/**
 * `wmctrl -lGx` rows:
 * `0x03a00007  0  1920 40  1280 1024 host nautilus.Nautilus  Documents`
 */
export function parseWmctrlGeometry(stdout: string): X11Entry[] {
  const entries: X11Entry[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length < 8) {
      continue;
    }
    const id = parts[0] ?? '';
    const x = Number.parseInt(parts[2] ?? '', 10);
    const y = Number.parseInt(parts[3] ?? '', 10);
    const width = Number.parseInt(parts[4] ?? '', 10);
    const height = Number.parseInt(parts[5] ?? '', 10);
    const fullClass = parts[7] ?? '';
    const app = (fullClass.split('.').pop() ?? fullClass).toLowerCase();
    const title = parts.slice(8).join(' ');
    if (!id || ![x, y, width, height].every(Number.isFinite)) {
      continue;
    }
    if (width <= 1 || height <= 1) {
      continue;
    }
    if (SHELL_CLASSES.has(app)) {
      continue;
    }
    entries.push({ id, title, app, rect: { x, y, width, height } });
  }
  return entries;
}

/** `xprop -root _NET_CLIENT_LIST_STACKING` → window ids, bottom-first. */
export function parseStackingOrder(stdout: string): string[] {
  const match = /window id #\s*(.*)$/m.exec(stdout);
  if (!match || !match[1]) {
    return [];
  }
  return match[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function normalizeWindowId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  if (!trimmed) {
    return '';
  }
  const numeric = trimmed.startsWith('0x') ? Number.parseInt(trimmed, 16) : Number.parseInt(trimmed, 10);
  return Number.isFinite(numeric) ? String(numeric) : trimmed;
}

/** Reorder parsed windows to the stacking list, top-most first. */
export function applyStackingOrder<T extends { id: string }>(entries: T[], stackingBottomFirst: string[]): T[] {
  if (stackingBottomFirst.length === 0) {
    return entries;
  }
  const byId = new Map(entries.map((entry) => [normalizeWindowId(entry.id), entry]));
  const ordered: T[] = [];
  for (const raw of [...stackingBottomFirst].reverse()) {
    const entry = byId.get(normalizeWindowId(raw));
    if (entry) {
      ordered.push(entry);
      byId.delete(normalizeWindowId(raw));
    }
  }
  for (const entry of entries) {
    if (byId.has(normalizeWindowId(entry.id))) {
      ordered.push(entry);
    }
  }
  return ordered;
}

/**
 * The Windows enumeration: `EnumWindows` walks top-level windows in z-order
 * (top-first), so the ladder's "behind the surface" rung needs no extra call.
 * Tool windows are skipped; titles are mandatory (an unnamed window is not a
 * target a human meant).
 */
export function buildWindowsWindowScript(): string {
  return [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -MemberDefinition @"',
    'public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);',
    '[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);',
    '[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);',
    '[DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr hWnd, int index);',
    '[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);',
    '[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int max);',
    '[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
    'public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
    '"@ -Name Win -Namespace Capture',
    '$rows = New-Object System.Collections.ArrayList',
    '$callback = [Capture.Win+EnumProc]{',
    '  param([IntPtr]$hWnd, [IntPtr]$lParam)',
    '  if ([Capture.Win]::IsWindowVisible($hWnd)) {',
    '    $ex = [Capture.Win]::GetWindowLong($hWnd, -20)',
    '    $len = [Capture.Win]::GetWindowTextLength($hWnd)',
    '    if ((($ex -band 0x00000080) -eq 0) -and ($len -gt 0)) {',
    '      $sb = New-Object System.Text.StringBuilder ($len + 2)',
    '      [void][Capture.Win]::GetWindowText($hWnd, $sb, $sb.Capacity)',
    '      $rect = New-Object Capture.Win+RECT',
    '      if ([Capture.Win]::GetWindowRect($hWnd, [ref]$rect)) {',
    '        $w = $rect.Right - $rect.Left',
    '        $h = $rect.Bottom - $rect.Top',
    '        if (($w -gt 1) -and ($h -gt 1)) {',
    '          [void]$rows.Add("$($rect.Left)|$($rect.Top)|$w|$h|$($sb.ToString())")',
    '        }',
    '      }',
    '    }',
    '  }',
    '  return $true',
    '}',
    '[void][Capture.Win]::EnumWindows($callback, [IntPtr]::Zero)',
    '$rows -join "`n"',
  ].join('\n');
}

/** `left|top|width|height|title` rows, top-first (EnumWindows order). */
export function parseWindowsWindowList(stdout: string): NativeWindowRect[] {
  const windows: NativeWindowRect[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const parts = trimmed.split('|');
    if (parts.length < 5) {
      continue;
    }
    const x = Number.parseInt(parts[0] ?? '', 10);
    const y = Number.parseInt(parts[1] ?? '', 10);
    const width = Number.parseInt(parts[2] ?? '', 10);
    const height = Number.parseInt(parts[3] ?? '', 10);
    const title = parts.slice(4).join('|').trim();
    if (!title || ![x, y, width, height].every(Number.isFinite) || width <= 1 || height <= 1) {
      continue;
    }
    windows.push({ title, rect: { x, y, width, height } });
  }
  return windows;
}

function createX11Provider(exec: CaptureExec): CaptureGeometryProvider {
  return {
    kind: 'x11',
    scaleMode: 'global',
    async windows() {
      let listing: string;
      try {
        listing = await exec('wmctrl', ['-lGx'], { timeout: X11_TIMEOUT_MS });
      } catch {
        return null;
      }
      const entries = parseWmctrlGeometry(listing);
      if (entries.length === 0) {
        return entries;
      }
      let stacking: string[] = [];
      try {
        stacking = parseStackingOrder(
          await exec('xprop', ['-root', '_NET_CLIENT_LIST_STACKING'], { timeout: X11_TIMEOUT_MS })
        );
      } catch {
        stacking = [];
      }
      return applyStackingOrder(entries, stacking).map(({ title, app, rect }) => ({ title, app, rect }));
    },
  };
}

function createWin32Provider(exec: CaptureExec): CaptureGeometryProvider {
  return {
    kind: 'win32',
    scaleMode: 'per-display',
    async windows() {
      try {
        const stdout = await exec(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', buildWindowsWindowScript()],
          { timeout: WIN32_TIMEOUT_MS }
        );
        return parseWindowsWindowList(stdout);
      } catch {
        return null;
      }
    },
  };
}

export function createWindowGeometryProvider(deps: {
  platform?: NodeJS.Platform;
  exec?: CaptureExec;
} = {}): CaptureGeometryProvider {
  const platform = deps.platform ?? process.platform;
  const exec = deps.exec ?? defaultExec;
  if (platform === 'linux') {
    return createX11Provider(exec);
  }
  if (platform === 'win32') {
    return createWin32Provider(exec);
  }
  return { kind: 'none', scaleMode: 'global', windows: async () => null };
}

/**
 * Native pixel rects → DIP for the display the pointer is on.
 *
 * X11 has ONE scale factor for the whole screen, so a plain division maps the
 * native virtual screen onto Electron's DIP space. Per-monitor DPI (Windows) is
 * a patchwork: `GetWindowRect` returns physical pixels of the virtual desktop,
 * while Electron's display bounds are DIP. Only the reference display's space
 * is ever hit-tested (the pointer lives there), so its native origin and factor
 * are the correct transform.
 */
export function nativeRectsToDip(
  rects: readonly NativeWindowRect[],
  input: {
    scaleMode: CaptureScaleMode;
    reference: CaptureDisplayLike;
  }
): CaptureWindowRect[] {
  const scale = input.reference.scaleFactor > 0 ? input.reference.scaleFactor : 1;
  const originX = input.scaleMode === 'global' ? 0 : input.reference.bounds.x * scale;
  const originY = input.scaleMode === 'global' ? 0 : input.reference.bounds.y * scale;
  const offsetX = input.scaleMode === 'global' ? 0 : input.reference.bounds.x;
  const offsetY = input.scaleMode === 'global' ? 0 : input.reference.bounds.y;
  return rects.map((entry) => ({
    title: entry.title,
    app: entry.app,
    rect: {
      x: Math.round(offsetX + (entry.rect.x - originX) / scale),
      y: Math.round(offsetY + (entry.rect.y - originY) / scale),
      width: Math.round(entry.rect.width / scale),
      height: Math.round(entry.rect.height / scale),
    },
  }));
}
