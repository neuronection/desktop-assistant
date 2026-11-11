import { describe, expect, it, vi, beforeEach } from 'vitest';
import { classifyHost, egressAllowed } from '@shared/egress';
import { clearEgressLog, createGuardedFetch, EgressBlockedError, getEgressLog } from '@main/security/egress';

const original = vi.fn(async () => new Response('ok'));

beforeEach(() => {
  clearEgressLog();
  original.mockClear();
});

describe('egress policy', () => {
  it('classifies loopback, local network, update and public hosts', () => {
    expect(classifyHost('localhost')).toBe('loopback');
    expect(classifyHost('127.0.0.1')).toBe('loopback');
    expect(classifyHost('[::1]')).toBe('loopback');
    expect(classifyHost('192.168.1.5')).toBe('local-network');
    expect(classifyHost('10.0.0.2')).toBe('local-network');
    expect(classifyHost('nas.local')).toBe('local-network');
    expect(classifyHost('neuronection.com')).toBe('update');
    expect(classifyHost('objects.githubusercontent.com')).toBe('update');
    expect(classifyHost('api.openai.com')).toBe('public');
  });

  it('allows only what each mode permits', () => {
    expect(egressAllowed('off', 'public')).toBe(true);
    expect(egressAllowed('local-network', 'local-network')).toBe(true);
    expect(egressAllowed('local-network', 'public')).toBe(false);
    expect(egressAllowed('strict-local', 'local-network')).toBe(false);
    expect(egressAllowed('strict-local', 'loopback')).toBe(true);
    expect(egressAllowed('strict-local', 'update')).toBe(true);
  });
});

describe('guarded fetch', () => {
  it('blocks a public host in strict mode and logs the host without the query', async () => {
    const guarded = createGuardedFetch(original as unknown as typeof fetch, () => 'strict-local');
    await expect(guarded('https://api.openai.com/v1/chat?key=secret')).rejects.toBeInstanceOf(EgressBlockedError);
    expect(original).not.toHaveBeenCalled();
    expect(getEgressLog()).toMatchObject([{ host: 'api.openai.com', classification: 'public', allowed: false }]);
    expect(JSON.stringify(getEgressLog())).not.toContain('secret');
  });

  it('allows a LAN host in local-network mode and blocks a public one', async () => {
    const guarded = createGuardedFetch(original as unknown as typeof fetch, () => 'local-network');
    await expect(guarded('http://192.168.1.9:11434/v1')).resolves.toBeInstanceOf(Response);
    await expect(guarded('https://example.com')).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('keeps the update exemption in strict mode', async () => {
    const guarded = createGuardedFetch(original as unknown as typeof fetch, () => 'strict-local');
    await expect(guarded('https://neuronection.com/api/v1/versions/desktop.json')).resolves.toBeInstanceOf(Response);
  });
});
