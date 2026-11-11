import { describe, expect, it, vi, beforeEach } from 'vitest';
import { classifyHost, egressAllowed } from '@shared/egress';
import { clearEgressLog, createGuardedFetch, EgressBlockedError, getEgressLog } from '@main/security/egress';
import { withEgressPurpose } from '@main/security/egress-purpose';

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
    expect(classifyHost('127.evil.com')).toBe('public');
    expect(classifyHost('127.0.0.1.evil.com')).toBe('public');
    expect(classifyHost('nas')).toBe('local-network');
    expect(classifyHost('localhost.')).toBe('loopback');
    expect(classifyHost(new URL('http://[::ffff:127.0.0.1]/').hostname)).toBe('loopback');
    expect(classifyHost(new URL('http://[::ffff:192.168.1.5]/').hostname)).toBe('local-network');
    expect(classifyHost('api.openai.com')).toBe('public');
  });

  it('classifies the documented outbound inventory', () => {
    const cases: Array<[string, ReturnType<typeof classifyHost>]> = [
      ['api.openai.com', 'public'],
      ['api.anthropic.com', 'public'],
      ['generativelanguage.googleapis.com', 'public'],
      ['api.search.brave.com', 'public'],
      ['api.deepl.com', 'public'],
      ['mcp.example.com', 'public'],
      ['graph.microsoft.com', 'public'],
      ['example.com', 'public'],
      ['neuronection.com', 'update'],
      ['127.0.0.1', 'loopback'],
      ['homeassistant', 'local-network'],
      ['192.168.1.10', 'local-network'],
    ];
    for (const [host, expected] of cases) {
      expect(classifyHost(host)).toBe(expected);
    }
    expect(egressAllowed('local-network', classifyHost('homeassistant'))).toBe(true);
    expect(egressAllowed('local-network', classifyHost('api.openai.com'))).toBe(false);
    expect(egressAllowed('strict-local', classifyHost('192.168.1.10'))).toBe(false);
    expect(egressAllowed('strict-local', classifyHost('127.0.0.1'))).toBe(true);
  });

  it('allows only what each mode permits', () => {
    expect(egressAllowed('off', 'public')).toBe(true);
    expect(egressAllowed('local-network', 'local-network')).toBe(true);
    expect(egressAllowed('local-network', 'public')).toBe(false);
    expect(egressAllowed('strict-local', 'local-network')).toBe(false);
    expect(egressAllowed('strict-local', 'loopback')).toBe(true);
    expect(egressAllowed('strict-local', 'update')).toBe(false);
    expect(egressAllowed('strict-local', 'update', 'update')).toBe(true);
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

  it('re-checks every redirect hop and blocks a public hop in strict mode', async () => {
    const redirecting = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://example.com/steal' } }));
    const guarded = createGuardedFetch(redirecting as unknown as typeof fetch, () => 'strict-local');
    await expect(guarded('http://127.0.0.1:8080/start')).rejects.toBeInstanceOf(EgressBlockedError);
    expect(redirecting).toHaveBeenCalledTimes(1);
  });

  it('follows a same-class redirect in strict mode', async () => {
    const redirecting = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'http://127.0.0.1:9090/next' } }))
      .mockResolvedValueOnce(new Response('ok'));
    const guarded = createGuardedFetch(redirecting as unknown as typeof fetch, () => 'strict-local');
    await expect(guarded('http://127.0.0.1:8080/start')).resolves.toBeInstanceOf(Response);
    expect(redirecting).toHaveBeenCalledTimes(2);
  });

  it('allows the update exemption in strict mode only inside an update purpose', async () => {
    const guarded = createGuardedFetch(original as unknown as typeof fetch, () => 'strict-local');
    await expect(guarded('https://neuronection.com/api/v1/versions/desktop.json')).rejects.toBeInstanceOf(EgressBlockedError);
    await expect(
      withEgressPurpose('update', () => guarded('https://neuronection.com/api/v1/versions/desktop.json'))
    ).resolves.toBeInstanceOf(Response);
  });
});
