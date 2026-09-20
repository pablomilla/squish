/**
 * Fetching a page somebody pasted in.
 *
 * A server that will fetch any URL a user hands it is a server that will fetch
 * its own cloud metadata endpoint, its own database, or anything else sitting
 * on a private address it can reach and a browser cannot. That is the whole
 * shape of server-side request forgery, and the recipe importer is exactly the
 * feature that invites it.
 *
 * So: only http and https, only addresses that are genuinely public, every
 * redirect re-checked rather than trusted, a size cap and a timeout.
 *
 * One honest limitation. Where the host routes egress through a proxy —
 * as this project's own sandbox does — `fetch` connects to the proxy rather
 * than to the address checked here, so the checks are advisory in that setup
 * and the proxy's own policy is what actually holds. On a plain host, which is
 * what Render gives you, they are the real thing.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class FetchGuardError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Ranges that are not the public internet, whatever DNS says. */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10], // Carrier-grade NAT.
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // Link-local, and with it every cloud metadata service.
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15], // Benchmarking.
  ['224.0.0.0', 4], // Multicast.
  ['240.0.0.0', 4], // Reserved.
];

const toInt = (ip: string): number | null => {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
};

export function isPrivateAddress(ip: string): boolean {
  const address = ip.toLowerCase().replace(/%.*$/, ''); // Drop any zone index.

  // IPv4-mapped IPv6 is still IPv4, and is the classic way past a naive check.
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);

  const v4 = toInt(address);
  if (v4 !== null) {
    return BLOCKED_V4.some(([base, bits]) => {
      const start = toInt(base);
      if (start === null) return false;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (v4 & mask) === (start & mask);
    });
  }

  if (address === '::' || address === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(address)) return true; // Unique local, fc00::/7.
  if (/^fe[89ab][0-9a-f]:/.test(address)) return true; // Link-local, fe80::/10.
  return false;
}

/**
 * Parse and vet one URL. Throws rather than returning a flag, because every
 * caller's only sane response is to stop.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new FetchGuardError(400, "That doesn't look like a web address.");
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchGuardError(400, 'Only ordinary web links work here.');
  }
  // Credentials in a URL are never needed for a recipe and are a good sign
  // somebody is trying to reach something they should not.
  if (url.username || url.password) {
    throw new FetchGuardError(400, 'Links with a username or password in them are not allowed.');
  }

  // A bare address is checked as one rather than sent to DNS. `[::1]` came
  // back from the resolver as "no such host", which refuses it by accident
  // rather than on purpose — and an accident is not a control.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateAddress(host)) {
      throw new FetchGuardError(400, 'That address is not on the public internet.');
    }
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new FetchGuardError(400, 'That website could not be found.');
  }

  // Every address it resolves to, not just the first: a host that answers with
  // one public address and one private one is the attack, not an accident.
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new FetchGuardError(400, 'That address is not on the public internet.');
  }

  return url;
}

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;

export interface FetchedPage {
  /** Where it ended up, which may not be where it started. */
  url: string;
  html: string;
}

/**
 * Fetch a public page as text, following redirects by hand so that each hop
 * is vetted as strictly as the first. A redirect to localhost is the oldest
 * trick there is, and `redirect: 'follow'` would take it.
 */
export async function fetchPublicPage(raw: string, userAgent: string): Promise<FetchedPage> {
  let target = await assertPublicUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: Response;
    try {
      response = await fetch(target, {
        redirect: 'manual',
        headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new FetchGuardError(504, 'That page did not load. It may be slow or blocking us.');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new FetchGuardError(502, 'That page redirected to nowhere.');
      target = await assertPublicUrl(new URL(location, target).toString());
      continue;
    }

    if (response.status === 404) throw new FetchGuardError(404, 'There is no page at that address.');
    if (!response.ok) throw new FetchGuardError(502, `That page answered with an error (${response.status}).`);

    const type = response.headers.get('content-type') ?? '';
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      throw new FetchGuardError(415, 'That link is not a web page.');
    }

    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      throw new FetchGuardError(413, 'That page is too big to read.');
    }

    return { url: target.toString(), html: await readCapped(response) };
  }

  throw new FetchGuardError(502, 'That page redirected too many times.');
}

/**
 * Read the body, stopping at the cap. Content-Length is a claim, not a
 * promise, so the running total is what actually protects us.
 */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return '';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        break; // Whatever arrived first is plenty for a recipe.
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    throw new FetchGuardError(502, 'That page stopped sending part-way through.');
  }

  parts.push(decoder.decode());
  return parts.join('');
}
