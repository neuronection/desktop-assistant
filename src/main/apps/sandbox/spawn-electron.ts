import { utilityProcess } from 'electron';
import type { SandboxProcess, SandboxSpawn } from './SandboxService';

/**
 * The production transport (ADR-0030 clause 1): one Electron
 * `utilityProcess` per imported code pack. The utility process gets NO
 * renderer privileges; stdin cannot be piped in Electron, so the
 * capability-rpc/1 frames ride the host-provided parentPort pipe (the
 * protocol's sanctioned alternative to stdio). Env arrives scrubbed via
 * ForkOptions; the memory cap rides `--max-old-space-size` in execArgv.
 */
export const electronSandboxSpawn: SandboxSpawn = ({ modulePath, args, cwd, env, execArgv }) => {
  const child = utilityProcess.fork(modulePath, args, {
    execArgv,
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    serviceName: 'mini-app-sandbox',
  });
  const listeners = new Set<(message: unknown) => void>();
  child.on('message', (message: unknown) => {
    for (const listener of listeners) {
      listener(message);
    }
  });
  const process: SandboxProcess = {
    pid: child.pid ?? 0,
    send: (message) => {
      child.postMessage(message);
    },
    onMessage: (listener) => {
      listeners.add(listener);
    },
    onExit: (listener) => {
      child.on('exit', (code: number) => listener(code));
    },
    kill: () => {
      child.kill();
    },
  };
  return process;
};
