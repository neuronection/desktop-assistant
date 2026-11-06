/**
 * Local OpenAI-compatible servers (Kokoro-FastAPI, LocalAI, whisper.cpp,
 * Piper gateways) commonly accept requests without an API key. Treat
 * loopback, mDNS and RFC1918 hosts as keyless so a local speech provider
 * does not need a dummy secret.
 */
export function isKeylessBaseUrl(apiBase: string | undefined): boolean {
  if (!apiBase) {
    return false;
  }
  let host: string;
  try {
    host = new URL(apiBase).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '::1' || host === 'host.docker.internal' || host.endsWith('.local')) {
    return true;
  }
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) {
    return true;
  }
  return /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}
