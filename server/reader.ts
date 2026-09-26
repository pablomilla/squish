/**
 * Who an email is for: the language they use Squish in, their country (for
 * how dates and numbers are written) and their time zone (for when a
 * sign-in happened, which is only useful in the time on their own clock).
 *
 * The app says all three on every call (X-Squish-Language, X-Squish-Region,
 * X-Squish-Zone). They are kept on the account as it last said them, since
 * most emails go out when nobody is asking: a security notice, a friend's
 * reward. Each is checked against what it can be, so nothing a header says
 * reaches an email except a known language, a known country and a time zone
 * the runtime recognises.
 */
import type { Request } from 'express';
import { hasDatabase, query } from './db';
import { detectLanguage, isLanguage, type Language } from '../src/lib/language';
import { HOME_REGION, isRegion, type Region } from '../src/lib/region';

export interface Reader {
  language: Language;
  region: Region;
  /** An IANA time zone, e.g. "Europe/London". */
  zone: string;
}

export const DEFAULT_READER: Reader = { language: 'en', region: HOME_REGION, zone: 'Europe/London' };

/** A time zone the runtime knows, or null. */
export function zoneFrom(value: unknown): string | null {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(value)) return null;
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** What this request says about its reader. Only what it actually says: nothing is assumed. */
export function readerFromRequest(req: Pick<Request, 'get'>): Partial<Reader> {
  const out: Partial<Reader> = {};
  const language = req.get('x-squish-language');
  const region = req.get('x-squish-region');
  const zone = zoneFrom(req.get('x-squish-zone'));
  if (isLanguage(language)) out.language = language;
  if (isRegion(region)) out.region = region;
  if (zone) out.zone = zone;
  return out;
}

/** Last written per account in this process, so an unchanged reader is not written on every call. */
const written = new Map<string, string>();

/**
 * Keep what the app said on the account. Only when the request said a
 * language — a call without one (a script, an old app) changes nothing.
 * Never awaited by a request and never throws.
 */
export function rememberReader(accountId: string, said: Partial<Reader>): Promise<void> {
  if (!said.language || !hasDatabase()) return Promise.resolve();
  const key = `${said.language}|${said.region ?? ''}|${said.zone ?? ''}`;
  if (written.get(accountId) === key) return Promise.resolve();
  written.set(accountId, key);
  return query(
    `update accounts set language = $2, region = coalesce($3, region), time_zone = coalesce($4, time_zone) where id = $1`,
    [accountId, said.language, said.region ?? null, said.zone ?? null],
  )
    .then(() => undefined)
    .catch(() => {
      written.delete(accountId);
    });
}

/**
 * The reader of an email to this account: as kept, then as the request
 * being served says (an account that has never said), then Britain in English.
 */
export async function readerOf(accountId: string, fallback: Partial<Reader> = {}): Promise<Reader> {
  let kept: { language: string | null; region: string | null; time_zone: string | null } | undefined;
  if (hasDatabase()) {
    try {
      kept = (await query<{ language: string | null; region: string | null; time_zone: string | null }>(
        'select language, region, time_zone from accounts where id = $1',
        [accountId],
      ))[0];
    } catch {
      /* an email in English beats no email */
    }
  }
  return {
    language: isLanguage(kept?.language) ? kept.language : (fallback.language ?? DEFAULT_READER.language),
    region: isRegion(kept?.region) ? kept.region : (fallback.region ?? DEFAULT_READER.region),
    zone: zoneFrom(kept?.time_zone) ?? fallback.zone ?? DEFAULT_READER.zone,
  };
}

/**
 * The first language in an Accept-Language header that Squish has, by the
 * weights the browser gave: "pt-BR,pt;q=0.9,en;q=0.8" is Portuguese.
 */
export function acceptLanguage(header: string | undefined): Language {
  if (!header) return 'en';
  const tags = header
    .split(',')
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1);
      return { tag: tag.trim(), q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((t) => t.tag && t.tag !== '*' && t.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map((t) => t.tag);
  return detectLanguage(tags);
}
