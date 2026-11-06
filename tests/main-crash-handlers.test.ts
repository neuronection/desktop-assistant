import { describe, it, expect, vi, beforeEach } from 'vitest';

const appHandlers = new Map<string, unknown>();

vi.mock('electron', () => ({
  app: {
    on: vi.fn((event: string, handler: unknown) => {
      appHandlers.set(event, handler);
    }),
  },
}));

import { installCrashHandlers } from '@main/crash';

type ErrorLog = (...args: unknown[]) => void;

function captureLog(): { errors: unknown[][]; log: { error: ErrorLog } } {
  const errors: unknown[][] = [];
  return { errors, log: { error: (...args: unknown[]) => errors.push(args) } };
}

describe('installCrashHandlers (plan 46 S1)', () => {
  beforeEach(() => {
    appHandlers.clear();
    vi.spyOn(process, 'on').mockImplementation(((event: string, handler: unknown) => {
      if (event === 'uncaughtException' || event === 'unhandledRejection') {
        appHandlers.set(event, handler);
      }
      return process;
    }) as typeof process.on);
  });

  it('uncaughtException is logged and never exits the process', () => {
    const { errors, log } = captureLog();
    installCrashHandlers(log);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const failure = new Error('main boom');
    (appHandlers.get('uncaughtException') as (error: Error) => void)(failure);
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe('[main-crash:uncaughtException]');
    expect(errors[0][1]).toBe(failure);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('unhandledRejection is logged and never exits the process', () => {
    const { errors, log } = captureLog();
    installCrashHandlers(log);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const reason = new Error('rejection boom');
    (appHandlers.get('unhandledRejection') as (reason: unknown) => void)(reason);
    expect(errors).toHaveLength(1);
    expect(errors[0][0]).toBe('[main-crash:unhandledRejection]');
    expect(errors[0][1]).toBe(reason);
    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('child-process-gone logs the sandbox child with the run-record pointer', () => {
    const { errors, log } = captureLog();
    installCrashHandlers(log);
    (appHandlers.get('child-process-gone') as (event: unknown, details: unknown) => void)(null, {
      type: 'Utility',
      reason: 'OOM',
      exitCode: 137,
      serviceName: 'mini-app-sandbox',
    });
    expect(errors).toHaveLength(1);
    const line = String(errors[0][0]);
    expect(line).toContain('[child-process-gone]');
    expect(line).toContain('sandbox');
    expect(line).toContain('OOM');
    expect(line).toContain('run record');
  });

  it('child-process-gone logs other children with type and service name', () => {
    const { errors, log } = captureLog();
    installCrashHandlers(log);
    (appHandlers.get('child-process-gone') as (event: unknown, details: unknown) => void)(null, {
      type: 'GPU',
      reason: 'crashed',
      exitCode: 1,
    });
    expect(errors).toHaveLength(1);
    const line = String(errors[0][0]);
    expect(line).toContain('GPU');
    expect(line).toContain('unnamed');
    expect(line).not.toContain('run record');
  });
});
