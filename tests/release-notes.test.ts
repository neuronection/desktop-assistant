import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(process.cwd(), 'scripts', 'release-notes.mjs');

function run(args: string[]): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

function changelog(path: string, body: string): void {
  writeFileSync(path, body);
}

describe('the release body is the changelog section', () => {
  it('emits the version section and nothing after it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
    const file = join(dir, 'CHANGELOG.md');
    changelog(
      file,
      ['## [Unreleased]', '', '## [0.12.0] - 2026-11-15', '', '### Upgrade', '- head 7', '', '## [0.11.0] - 2026-11-06', '', '### Old', '- nothing', ''].join(
        '\n'
      )
    );
    const { code, stdout } = run(['0.12.0', '--file', file]);
    expect(code).toBe(0);
    expect(stdout).toContain('### Upgrade');
    expect(stdout).toContain('- head 7');
    expect(stdout).not.toContain('0.11.0');
    expect(stdout).not.toContain('### Old');
  });

  it('lets an rc reuse the upcoming release notes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
    const file = join(dir, 'CHANGELOG.md');
    changelog(file, ['## [0.12.0] - 2026-11-15', '', '### Upgrade', '- head 7', ''].join('\n'));
    const { code, stdout } = run(['0.12.0-rc.1', '--file', file]);
    expect(code).toBe(0);
    expect(stdout).toContain('- head 7');
  });

  it('fails loudly when the section is missing or empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
    const file = join(dir, 'CHANGELOG.md');
    changelog(file, ['## [0.11.0] - 2026-11-06', '', '### Old', '- nothing', ''].join('\n'));
    expect(run(['0.12.0', '--file', file]).code).toBe(1);
    changelog(file, ['## [0.12.0] - 2026-11-15', '', '## [0.11.0] - 2026-11-06', ''].join('\n'));
    expect(run(['0.12.0', '--file', file]).code).toBe(1);
  });
});
