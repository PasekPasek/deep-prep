import 'server-only';

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/**
 * SSRF-guarded fetch for user-supplied URLs.
 *
 * The pipeline fetches whatever URL the user submits as an offer. Unguarded, that
 * lets a request reach places only the server can see: localhost, the private
 * network, or a cloud metadata endpoint (169.254.169.254 hands out credentials on
 * most platforms). Single-user softens the threat, but the guard is cheap and the
 * class of bug is too well-known to ship without it.
 *
 * Checks: scheme allowlist, hostname resolution, and a private/reserved-range test
 * on EVERY resolved address. Redirects are followed manually so each hop is
 * re-validated — an allowed public host redirecting to 127.0.0.1 is the classic
 * bypass. Response size is capped so a hostile endpoint cannot balloon the LLM
 * input (cost) or the process memory.
 */

export const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MiB of HTML is a very long job ad
const MAX_REDIRECTS = 5;

export class BlockedUrlError extends Error {
  constructor(url: string, reason: string) {
    super(`Refusing to fetch ${url}: ${reason}`);
    this.name = 'BlockedUrlError';
  }
}

function isPrivateIp(address: string): boolean {
  if (address.includes(':')) {
    // IPv6: loopback, link-local, unique-local, unspecified, and v4-mapped forms.
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
    const v4 = /::ffff:(\d+\.\d+\.\d+\.\d+)/.exec(lower);
    return v4 ? isPrivateIp(v4[1]) : false;
  }

  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return true; // fail closed
  const [a, b] = octets;
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local incl. metadata endpoints
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 // multicast + reserved
  );
}

async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BlockedUrlError(url.href, `unsupported protocol ${url.protocol}`);
  }

  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new BlockedUrlError(url.href, 'local hostname');
  }

  if (isIP(host)) {
    if (isPrivateIp(host)) throw new BlockedUrlError(url.href, 'private or reserved IP');
    return;
  }

  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError(url.href, 'hostname does not resolve');
  }
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new BlockedUrlError(url.href, `resolves to private address ${address}`);
    }
  }
}

/** Fetch with per-hop SSRF validation and a hard response-size cap. */
export async function safeFetchText(
  rawUrl: string,
  init: { headers?: Record<string, string> } = {},
): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(rawUrl, 'not a valid URL');
  }

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(url);

    const response = await fetch(url, {
      headers: init.headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`redirect from ${url} without a Location header`);
      url = new URL(location, url); // relative redirects resolve against current hop
      continue;
    }

    if (!response.ok) {
      throw new Error(`Fetching ${url} failed: HTTP ${response.status}`);
    }

    // Stream with a byte cap rather than trusting Content-Length, which is optional
    // and attacker-controlled.
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new BlockedUrlError(url.href, `response exceeds ${MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(concat(chunks, received));
  }

  throw new BlockedUrlError(rawUrl, `more than ${MAX_REDIRECTS} redirects`);
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
