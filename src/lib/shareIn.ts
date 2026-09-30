/**
 * Something shared into Squish from another app — a recipe page from a
 * browser, a video from TikTok or Instagram, a note — by the phone's own
 * share sheet.
 *
 * Every way in arrives as the same thing: squish://share?url=…&text=… from
 * the Android app and the iPhone's share extension, /?share&url=…&text=… from
 * the installed web app (its manifest's share_target). A link goes to the
 * recipe import, read at once; words with no link go to Describe, typed in
 * and not yet sent.
 */

export type Shared = { kind: 'recipe'; url: string } | { kind: 'words'; text: string };

/**
 * The first web address in what was shared. Apps share a link in all sorts
 * of wrapping — "Check out this recipe! https://… via @someone" — so it is
 * found wherever it is, and trailing punctuation is left behind.
 */
export function firstLink(text: string): string | null {
  const found = text.match(/https?:\/\/[^\s<>"']+/i)?.[0];
  if (!found) return null;
  const link = found.replace(/[).,!?;:'"]+$/, '');
  try {
    const url = new URL(link);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** What a share comes to, from the parts it arrived in; null if there was nothing in it. */
export function readShare(parts: { url?: string | null; text?: string | null; title?: string | null }): Shared | null {
  const all = [parts.url, parts.text, parts.title].filter((part): part is string => Boolean(part?.trim()));
  for (const part of all) {
    const url = firstLink(part);
    if (url) return { kind: 'recipe', url };
  }
  const text = [parts.title, parts.text].filter((part): part is string => Boolean(part?.trim())).join('\n').trim().slice(0, 600);
  return text ? { kind: 'words', text } : null;
}

/** A share link (squish://share?…, /?share&…) as what was shared; null if it is not one. */
export function shareFromLink(link: string): Shared | null {
  try {
    const parsed = new URL(link);
    const inApp = parsed.protocol === 'squish:' || parsed.protocol === 'app.squish.tracker:';
    const isShare = inApp ? parsed.host === 'share' || parsed.pathname.replace(/^\/+/, '') === 'share' : parsed.searchParams.has('share') || parsed.pathname === '/share';
    if (!isShare) return null;
    const q = parsed.searchParams;
    return readShare({ url: q.get('url'), text: q.get('text'), title: q.get('title') });
  } catch {
    return null;
  }
}

/**
 * Whether this page was opened with something shared, read once at startup;
 * the address is put back to plain afterwards so a reload does not import it
 * again.
 */
export function openedWithShare(): Shared | null {
  // Through globalThis: the tests read this file with no page.
  const page = globalThis as { location?: { href: string }; history?: { state: unknown; replaceState: (state: unknown, unused: string, url: string) => void } };
  if (!page.location) return null;
  const shared = shareFromLink(page.location.href);
  if (!shared && !new URL(page.location.href).searchParams.has('share')) return null;
  const clean = new URL(page.location.href);
  for (const key of ['share', 'url', 'text', 'title']) clean.searchParams.delete(key);
  if (clean.pathname === '/share') clean.pathname = '/';
  page.history?.replaceState(page.history.state, '', clean.toString());
  return shared;
}
