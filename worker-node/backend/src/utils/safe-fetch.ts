import { URL } from 'url';
import dns from 'dns/promises';

const BLOCKED_IPS = [
  /^127\./,           // Loopback
  /^10\./,            // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./,  // RFC1918
  /^192\.168\./,      // RFC1918
  /^169\.254\./,      // Link-local (AWS metadata!)
  /^0\./,             // This network
  /^::1$/,            // IPv6 loopback
  /^fc00:/i,          // IPv6 ULA
  /^fe80:/i,          // IPv6 link-local
];

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

export async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  // Validate protocol
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Blocked protocol: ${parsed.protocol}`);
  }

  // Resolve hostname to IP and check against blocklist
  const hostname = parsed.hostname;

  // Check if hostname is already an IP
  if (BLOCKED_IPS.some(pattern => pattern.test(hostname))) {
    throw new Error(`Blocked IP address: ${hostname}`);
  }

  // DNS resolve to check actual IP
  try {
    const addresses = await dns.resolve4(hostname);
    for (const addr of addresses) {
      if (BLOCKED_IPS.some(pattern => pattern.test(addr))) {
        throw new Error(`Blocked IP address: ${addr} (resolved from ${hostname})`);
      }
    }
  } catch (e) {
    if ((e as Error).message?.startsWith('Blocked')) throw e;
    // DNS resolution failure - allow the fetch to fail naturally
  }

  return fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
}
