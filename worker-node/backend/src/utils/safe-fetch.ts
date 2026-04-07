import { URL } from 'url';
import dns from 'dns/promises';

const BLOCKED_IPS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

export async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname;

  if (BLOCKED_IPS.some(pattern => pattern.test(hostname))) {
    throw new Error(`Blocked IP address: ${hostname}`);
  }

  try {
    const addresses = await dns.resolve4(hostname);
    for (const addr of addresses) {
      if (BLOCKED_IPS.some(pattern => pattern.test(addr))) {
        throw new Error(`Blocked IP address: ${addr} (resolved from ${hostname})`);
      }
    }
  } catch (e) {
    if ((e as Error).message?.startsWith('Blocked')) throw e;
  }

  return fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
}
