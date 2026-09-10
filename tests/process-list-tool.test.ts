import { describe, it, expect } from 'vitest';
import {
  buildProcessListInvocation,
  formatProcesses,
  parsePsOutput,
  parseTasklistOutput,
  processListTool,
  sortProcesses,
} from '@main/ai/tools/native/process-list';
import { NATIVE_TOOL_CATALOG } from '@main/ai/tools/native';
import type { NativeToolDefinition } from '@main/ai/tools/types';

const byName = (name: string): NativeToolDefinition<never> =>
  NATIVE_TOOL_CATALOG.find((tool) => tool.name === name) as unknown as NativeToolDefinition<never>;

const PS_FIXTURE = [
  '    PID %CPU %MEM COMMAND',
  '   1234 12.5  4.2 /usr/lib/firefox/firefox',
  '    987  8.0  1.1 alacritty',
  '   5555  0.0  0.0 sleep 300',
  'garbage',
].join('\n');

const TASKLIST_FIXTURE = [
  '"chrome.exe","4242","Console","1","123,456 K"',
  '"explorer.exe","777","Console","1","45,678 K"',
  '',
].join('\n');

describe('process_list', () => {
  it('uses ps on unix and tasklist on windows', () => {
    expect(buildProcessListInvocation('linux')).toEqual({ file: 'ps', args: ['-eo', 'pid,pcpu,pmem,comm'] });
    expect(buildProcessListInvocation('darwin')).toEqual({ file: 'ps', args: ['-eo', 'pid,pcpu,pmem,comm'] });
    expect(buildProcessListInvocation('win32')).toEqual({ file: 'tasklist.exe', args: ['/fo', 'csv', '/nh'] });
  });

  it('parses ps output defensively, keeping command names with spaces', () => {
    const rows = parsePsOutput(PS_FIXTURE);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ name: '/usr/lib/firefox/firefox', pid: 1234, cpu: 12.5, mem: 4.2 });
    expect(rows[2].name).toBe('sleep 300');
  });

  it('parses tasklist csv with quoted mem values', () => {
    const rows = parseTasklistOutput(TASKLIST_FIXTURE);
    expect(rows).toEqual([
      { name: 'chrome.exe', pid: 4242, mem: 123456 },
      { name: 'explorer.exe', pid: 777, mem: 45678 },
    ]);
  });

  it('sorts by cpu desc, mem desc, pid asc; missing metrics last', () => {
    const sorted = sortProcesses([
      { name: 'a', pid: 3 },
      { name: 'b', pid: 1, cpu: 1 },
      { name: 'c', pid: 2, cpu: 5, mem: 2 },
      { name: 'd', pid: 4, cpu: 1, mem: 9 },
    ]);
    expect(sorted.map((row) => row.name)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('formats with metric extras and honors the limit', () => {
    const rows = sortProcesses(parsePsOutput(PS_FIXTURE));
    const text = formatProcesses(rows, 25);
    expect(text).toContain('/usr/lib/firefox/firefox (pid 1234) — cpu 12.5%, mem 4.2%');
    expect(formatProcesses(rows, 2).split('\n')).toHaveLength(2);
  });

  it('registers as a read-only system tool and runs on this machine', async () => {
    const def = byName('process_list');
    expect(def.risk).toBe('read-only');
    expect(def.category).toBe('system');
    const result = await processListTool.exec({}, {});
    if (result.includes('Not available')) {
      expect(result).toContain('ps');
      return;
    }
    expect(result.split('\n').length).toBeLessThanOrEqual(25);
    expect(result).toMatch(/- .+ \(pid \d+\)/);
  });
});
