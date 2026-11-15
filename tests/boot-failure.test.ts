import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const showErrorBox = vi.fn();
const exit = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/unused', exit: (code: number) => exit(code) },
  dialog: { showErrorBox: (title: string, body: string) => showErrorBox(title, body) },
}));

const { reportBootFailure } = await import('@main/bootFailure');
const { initLogger } = await import('@main/log');
const { TEXT } = await import('@shared/constants/text');

let directory = '';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'boot-failure-'));
  initLogger(directory);
  showErrorBox.mockClear();
  exit.mockClear();
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('a failed boot reaches the user', () => {
  it('shows a dialog naming the data and log, logs the failure, and exits non-zero', () => {
    reportBootFailure(new Error('DB_SCHEMA_TOO_NEW: version 9'), {
      isDev: false,
      isSmoke: false,
      dataDirectory: directory,
    });

    expect(showErrorBox).toHaveBeenCalledTimes(1);
    const [title, body] = showErrorBox.mock.calls[0] as [string, string];
    expect(title).toBe(TEXT.BOOT_FAILED_TITLE);
    expect(body).toContain('DB_SCHEMA_TOO_NEW: version 9');
    expect(body).toContain(directory);
    expect(body).toContain('main.log');
    expect(exit).toHaveBeenCalledWith(1);

    const log = readFileSync(join(directory, 'logs', 'main.log'), 'utf8');
    expect(log).toContain('initialize failed: DB_SCHEMA_TOO_NEW: version 9');
  });

  it('stays out of the way in dev and in the packaged smoke', () => {
    reportBootFailure(new Error('boom'), { isDev: true, isSmoke: false, dataDirectory: directory });
    reportBootFailure(new Error('boom'), { isDev: false, isSmoke: true, dataDirectory: directory });
    expect(showErrorBox).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
    expect(readFileSync(join(directory, 'logs', 'main.log'), 'utf8')).toContain('initialize failed: boom');
  });
});
