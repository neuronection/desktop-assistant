import os from 'os';
import { readFile, readdir } from 'fs/promises';
import { z } from 'zod';
import type { NativeToolDefinition } from '../types';

const schema = z.object({});

async function readBattery(): Promise<string | null> {
  try {
    const supplies = await readdir('/sys/class/power_supply');
    const batteryDir = supplies.find((name) => name.startsWith('BAT'));
    if (!batteryDir) {
      return null;
    }
    const base = `/sys/class/power_supply/${batteryDir}`;
    const [capacity, status] = await Promise.all([
      readFile(`${base}/capacity`, 'utf8').catch(() => null),
      readFile(`${base}/status`, 'utf8').catch(() => null),
    ]);
    if (capacity === null) {
      return null;
    }
    return `Battery: ${capacity.trim()}%${status ? ` (${status.trim()})` : ''}`;
  } catch {
    return null;
  }
}

async function readDisplays(): Promise<string | null> {
  try {
    const { screen } = await import('electron');
    return screen
      .getAllDisplays()
      .map(
        (display, index) =>
          `Display ${index + 1}: ${display.size.width}x${display.size.height} @ ${display.scaleFactor}x`
      )
      .join('; ');
  } catch {
    return null;
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

export const systemInfoTool: NativeToolDefinition<Record<string, never>> = {
  name: 'system_info',
  description:
    'Get a snapshot of this computer: operating system, architecture, uptime, CPU, memory, displays, and battery (where available).',
  schema,
  risk: 'read-only',
  category: 'system',
  timeoutMs: 5_000,
  summarize: () => 'Read system info',
  async exec() {
    const [battery, displays] = await Promise.all([readBattery(), readDisplays()]);
    const gbs = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    const cpus = os.cpus();
    const lines = [
      `OS: ${os.type()} ${os.release()} (${os.arch()})`,
      `Host: ${os.hostname()}`,
      `Uptime: ${formatUptime(os.uptime())}`,
      `CPU: ${cpus.length}x ${cpus[0]?.model ?? 'unknown'}`,
      `Memory: ${gbs(os.totalmem())} total, ${gbs(os.freemem())} free`,
    ];
    if (displays) {
      lines.push(`Displays: ${displays}`);
    }
    if (battery) {
      lines.push(battery);
    }
    return lines.join('\n');
  },
};
