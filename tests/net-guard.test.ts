import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assertFetchableUrl,
  assertPublicResolvedUrl,
  followPublicRedirects,
  isBlockedByRobots,
  isPrivateHost,
  parseRobotsForStar,
} from '@main/ai/tools/net-guard';

const lookupMock = vi.fn();
vi.mock('dns/promises', () => ({
  lookup: (host: string, options: unknown) => lookupMock(host, options),
}));

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isPrivateHost matrix', () => {
  const blocked = [
    'localhost',
    'metadata.google.internal',
    'nas.local',
    'service.internal',
    '127.0.0.1',
    '127.8.8.8',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.1.1',
    '0.0.0.0',
    '0.1.2.3',
    '100.64.0.1',
    '[::1]',
    '[::]',
    '[fe80::1]',
    '[fc00::1]',
    '[fd12:3456::1]',
    '[::ffff:10.0.0.1]',
    '[::ffff:192.168.0.1]',
    '[2002:0a00:0000:0000:0000:0000:0000:0001]',
  ];

  const allowed = ['example.com', '8.8.8.8', '8.8.4.4', '172.32.0.1', '192.169.0.1', '100.128.0.1', '[2606:4700::1111]'];

  it.each(blocked)('blocks %s', (host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each(allowed)('allows %s', (host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe('assertFetchableUrl', () => {
  it('rejects non-http schemes and embedded credentials', () => {
    expect(() => assertFetchableUrl('file:///etc/passwd')).toThrow(/http and https/);
    expect(() => assertFetchableUrl('ftp://example.com/file')).toThrow(/http and https/);
    expect(() => assertFetchableUrl('https://user:pass@example.com/file')).toThrow(/credentials/);
    expect(() => assertFetchableUrl('http://127.0.0.1/x')).toThrow(/private\/local/);
    expect(() => assertFetchableUrl('not a url')).toThrow(/Invalid URL/);
  });

  it('passes for a public https URL', () => {
    expect(assertFetchableUrl('https://example.com/file.pdf').hostname).toBe('example.com');
  });
});

describe('assertPublicResolvedUrl (DNS pre-request rule)', () => {
  it('blocks when any resolved address is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '192.168.1.10', family: 4 },
    ]);
    await expect(assertPublicResolvedUrl('https://rebind.example/file')).rejects.toThrow(/private\/local/);
    expect(lookupMock).toHaveBeenCalledWith('rebind.example', { all: true, verbatim: true });
  });

  it('allows when all resolved addresses are public', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(assertPublicResolvedUrl('https://example.com/file')).resolves.toBeInstanceOf(URL);
  });

  it('blocks a hostname resolving to loopback', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    await expect(assertPublicResolvedUrl('https://evil.example/x')).rejects.toThrow(/private\/local/);
  });

  it('fails closed when resolution fails', async () => {
    lookupMock.mockRejectedValue(new Error('NXDOMAIN'));
    await expect(assertPublicResolvedUrl('https://missing.example/x')).rejects.toThrow(/Could not resolve/);
  });  it('skips lookup for literal public IPs', async () => {
    await expect(assertPublicResolvedUrl('https://8.8.8.8/file')).resolves.toBeInstanceOf(URL);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

function htmlResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
}

describe('followPublicRedirects', () => {
  it('validates every hop and blocks a redirect onto a private address', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/steal' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(followPublicRedirects('https://public.example/redirect')).rejects.toThrow(/private\/local/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect that resolves to a private address via DNS', async () => {
    lookupMock.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://rebind.example/final' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(followPublicRedirects('https://public.example/redirect')).rejects.toThrow(/private\/local/);
  });

  it('follows a public redirect chain to the final response', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://cdn.example/real.pdf' } }))
      .mockResolvedValueOnce(htmlResponse('<html>ok</html>'));
    vi.stubGlobal('fetch', fetchMock);
    const { response, url } = await followPublicRedirects('https://example.com/file.pdf');
    expect(response.status).toBe(200);
    expect(url.toString()).toBe('https://cdn.example/real.pdf');
  });

  it('refuses redirect chains longer than the hop cap', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: URL) =>
      new Response(null, {
        status: 302,
        headers: { location: `${url.toString()}?hop` },
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(followPublicRedirects('https://example.com/a')).rejects.toThrow(/Too many redirects/);
  });
});

describe('robots.txt', () => {
  it('parses User-agent: * disallow prefixes', () => {
    const robots = ['# comment\nUser-agent: *\nDisallow: /private\nDisallow:\n\nUser-agent: bot\nDisallow: /'];
    expect(parseRobotsForStar(robots.join('\n'), '/private/file.pdf')).toBe(true);
    expect(parseRobotsForStar(robots.join('\n'), '/public/file.pdf')).toBe(false);
  });

  it('blocks when robots disallows the path, allows on fetch failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('User-agent: *\nDisallow: /files'))
      .mockResolvedValueOnce(htmlResponse('User-agent: *\nDisallow: /other'))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await isBlockedByRobots(new URL('https://example.com/files/a.pdf'))).toBe(true);
    expect(await isBlockedByRobots(new URL('https://example.com/open/a.pdf'))).toBe(false);
    expect(await isBlockedByRobots(new URL('https://example.com/files/a.pdf'))).toBe(false);
  });
});
