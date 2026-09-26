/**
 * The website at squish.online, beside the app at app.squish.online.
 *
 * One server answers both addresses and tells them apart by the host it was
 * asked for. That keeps it to one service on the host, one deploy and one
 * bill, and it means the old links — reset links in emails already sent,
 * home-screen icons pointing at squish.online — can be caught and sent on,
 * which a separate static host could not do with anything like the same care.
 *
 *   SQUISH_PUBLIC_ORIGIN=https://app.squish.online   where the app lives
 *   SQUISH_SITE_ORIGIN=https://squish.online         where the website lives
 *
 * With SQUISH_SITE_ORIGIN unset nothing here does anything, and every address
 * serves the app exactly as before. So the code can be deployed first and the
 * switch made afterwards, on the host's dashboard, once the new address works.
 *
 * The website is plain HTML in `site/`: no framework, no build, no cookies and
 * no analytics — the privacy policy promises none, and a marketing page is
 * the usual place that promise gets broken.
 *
 * It is in every language the app is. The HTML stays English, and each page
 * is translated as it is served (see htmlWords.ts), from the same store as
 * the app's interface:
 *
 *   /            in the language the browser asks for first, English if none
 *   /es/         Spanish, whatever the browser says — what the language links
 *   /en/support  and the search engines use
 *
 * No cookie remembers the choice: the links on a page in Spanish lead to
 * pages in Spanish, and that is all the remembering it needs.
 */
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { idOf, RTL_LANGUAGES } from '../src/lib/i18n';
import { LANGUAGE_LIST, isLanguage, type Language } from '../src/lib/language';
import { stringsOf, translateHtml, type Lookup } from './htmlWords';
import { fillLanguage, registerStrings, translationsFor } from './translate';
import { acceptLanguage } from './reader';

export const SITE_DIR = resolve(process.cwd(), 'site');

/** Written into the pages as the app's address; swapped for the configured one when they are served. */
const APP_PLACEHOLDER = 'https://app.squish.online';

/** The website's configured address, tidied; null where there is no website. */
function siteOrigin(): URL | null {
  const configured = process.env.SQUISH_SITE_ORIGIN?.trim();
  if (!configured) return null;
  try {
    return new URL(configured);
  } catch {
    return null;
  }
}

/**
 * The website's host name, without a port — compared with Express's
 * req.hostname, which never has one.
 */
export const siteHost = (): string | null => siteOrigin()?.hostname.toLowerCase() ?? null;

/**
 * Where the privacy policy should be read, if not at the address it was
 * asked for: the website's own address, whenever there is a website.
 *
 * The server answers on its host's own address (squish-….onrender.com) as
 * well as on squish.online, and the app links to /privacy on whichever
 * address it was opened from — so somebody who installed it from the host's
 * address, or the phone app pointed there, read the policy under a hosting
 * company's name. The policy is one page with no state, so it can always be
 * sent to the one address people should see it at.
 */
export function privacyRedirect(host: string | undefined): string | null {
  const site = siteOrigin();
  if (!site) return null;
  return host?.toLowerCase() === site.hostname.toLowerCase() ? null : `${site.origin}/privacy`;
}

/** Whether this request is for the website rather than the app. */
export function isSiteRequest(host: string | undefined): boolean {
  const site = siteHost();
  if (!site || !host) return false;
  const asked = host.toLowerCase();
  return asked === site || asked === `www.${site}`;
}

/**
 * Paths that belong to the app, reached through the website's address: reset
 * links in emails sent before the move, and the partner page, which the
 * website's footer links to. Sent on with their query intact, because the
 * query is the reset token.
 */
const APP_PATHS = ['/reset', '/partners'];

/* ------------------------------------------------------------------ *
 * In other languages
 * ------------------------------------------------------------------ */

/**
 * The translations for a page's strings, as a lookup. Never waits for
 * Claude: what is missing shows in English this time, and the language is
 * set translating in the background for the next visitor.
 */
export async function pageWords(language: Language, html: string): Promise<{ lookup: Lookup; complete: boolean }> {
  const entries = stringsOf(html).map((text) => ({ id: idOf(text), text, where: [] }));
  const found = await translationsFor(language, entries, 0).catch(() => new Map());
  const complete = found.size === entries.length;
  if (!complete) void fillLanguage(language).catch(() => {});
  return {
    lookup: (english) => {
      const value = found.get(idOf(english));
      return typeof value === 'string' ? value : undefined;
    },
    complete,
  };
}

/** How a page and a search engine name each language; Chinese is the simplified script. */
export const hreflang = (language: Language): string => (language === 'zh' ? 'zh-Hans' : language);

/** The <html> tag for a language: its name, and its direction. The English is British. */
export const htmlTag = (language: Language): string =>
  `<html lang="${language === 'en' ? 'en-GB' : hreflang(language)}" dir="${RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr'}">`;

/**
 * `/es/support` → Spanish, `/support`; `/support` → no language said. Only
 * a language Squish has counts, so `/de` is German and `/xx` is nothing.
 */
export function languageOfPath(path: string): { language: Language | null; rest: string } {
  const match = /^\/([a-z]{2})(\/.*)?$/.exec(path);
  if (match && isLanguage(match[1])) return { language: match[1], rest: match[2] ?? '' };
  return { language: null, rest: path };
}

/** Every string on the website, registered at start-up so it is translated with the app. */
export function registerSiteStrings(): number {
  if (!existsSync(SITE_DIR)) return 0;
  let count = 0;
  for (const name of readdirSync(SITE_DIR).filter((f) => f.endsWith('.html'))) {
    const strings = stringsOf(readFileSync(join(SITE_DIR, name), 'utf8'));
    registerStrings(strings.map((text) => ({ id: idOf(text), text, where: [`site/${name}`] })));
    count += strings.length;
  }
  return count;
}

/**
 * The site's own links, kept in the language: `/support` → `/es/support`,
 * the privacy policy with `?lang=es`, and the app opened in it too.
 */
function localLinks(html: string, language: Language): string {
  return html
    .replace(/href="\/(support|404)?"/g, (_whole, page: string | undefined) => `href="/${language}/${page ?? ''}"`)
    .replace(/href="\/privacy"/g, `href="/privacy?lang=${language}"`)
    .replace(new RegExp(`href="${APP_PLACEHOLDER.replace(/[.]/g, '\\.')}"`, 'g'), `href="${APP_PLACEHOLDER}/?lang=${language}"`);
}

/** The switcher in the footer: every language, each in its own name. */
function languageLinks(current: Language, page: string): string {
  return LANGUAGE_LIST.map(
    (l) =>
      `<a href="/${l.id}/${page}" hreflang="${hreflang(l.id)}" lang="${hreflang(l.id)}"${l.id === current ? ' aria-current="page"' : ''}>${l.native}</a>`,
  ).join('\n        ');
}

/** For search engines: the same page in every other language, and which to show when none fits. */
function alternates(page: string): string {
  const origin = siteOrigin()?.origin ?? 'https://squish.online';
  return [
    ...LANGUAGE_LIST.map((l) => `<link rel="alternate" hreflang="${hreflang(l.id)}" href="${origin}/${l.id}/${page}" />`),
    `<link rel="alternate" hreflang="x-default" href="${origin}/${page}" />`,
  ].join('\n  ');
}

const pages = new Map<string, string>();

/**
 * A page from `site/` in a language, with the app's address filled in.
 * `prefixed` is whether the address said the language (`/es/…`), so its
 * links should keep saying it.
 */
async function page(file: string, appOrigin: string, language: Language = 'en', prefixed = false): Promise<string | null> {
  const key = `${file}|${appOrigin}|${language}|${prefixed}`;
  const cached = pages.get(key);
  if (cached !== undefined) return cached;
  try {
    let html = await readFile(file, 'utf8');
    let complete = true;
    if (language !== 'en') {
      const words = await pageWords(language, html);
      html = translateHtml(html, words.lookup);
      complete = words.complete;
    }
    const name = file.slice(SITE_DIR.length + 1).replace(/\.html$/, '');
    const pagePath = name === 'index' ? '' : name;
    html = html
      .replace(/<html lang="[^"]*">/, htmlTag(language))
      .replace('<!--languages-->', languageLinks(language, pagePath));
    if (name !== '404') html = html.replace('</head>', `  ${alternates(pagePath)}\n</head>`);
    if (prefixed || language !== 'en') html = localLinks(html, language);
    if (prefixed) {
      html = html.replace(/<link rel="canonical" href="([^"]*)" \/>/, (_whole, href: string) => {
        const url = new URL(href);
        return `<link rel="canonical" href="${url.origin}/${language}${url.pathname}" />`;
      });
    }
    html = html.replaceAll(APP_PLACEHOLDER, appOrigin);
    // Cached for the life of the process once whole: the pages only change
    // with a deploy. One still waiting on translations is made again next time.
    if (process.env.NODE_ENV === 'production' && complete) pages.set(key, html);
    return html;
  } catch {
    return null;
  }
}

/** `/support` → `site/support.html`, `/` → `site/index.html`; nothing outside `site/`. */
export function pageFor(path: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null; // "%E0%A4%A" and friends: not a page of ours
  }
  const clean = normalize(decoded).replace(/^([/\\])+/, '');
  if (clean.includes('..')) return null;
  const name = clean === '' ? 'index' : clean.replace(/\/$/, '');
  if (extname(name)) return null;
  const file = join(SITE_DIR, `${name}.html`);
  return file.startsWith(SITE_DIR) && existsSync(file) ? file : null;
}

/**
 * The website's routes. Mounted ahead of the app, and passes through anything
 * that is not for the website's address, anything under /api (old installs
 * still call it there), and /privacy, which both addresses share.
 */
export function siteRouter(appOrigin: () => string, distDir: string) {
  const files = express.static(SITE_DIR, { maxAge: '1h', index: false, extensions: [] });
  // The app's icons and manifest, so a browser asking squish.online for a
  // favicon — or an old home-screen install asking for its icon — gets one.
  const appFiles = express.static(distDir, { maxAge: '1h', index: false, fallthrough: true });

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isSiteRequest(req.hostname)) {
      next();
      return;
    }
    if (req.path.startsWith('/api/') || req.path === '/privacy' || req.path === '/verify') {
      next();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).end();
      return;
    }

    if (req.hostname.toLowerCase() !== siteHost()) {
      // www.squish.online → squish.online, one address for everything.
      res.redirect(301, `${siteOrigin()!.origin}${req.originalUrl}`);
      return;
    }

    if (APP_PATHS.some((path) => req.path === path || req.path.startsWith(`${path}/`))) {
      res.redirect(301, `${appOrigin()}${req.originalUrl}`);
      return;
    }

    const said = languageOfPath(req.path);
    if (said.language && said.rest === '') {
      res.redirect(301, `/${said.language}/`); // `/es` → `/es/`
      return;
    }
    // Unsaid, the browser's first choice — so the page varies by what it asks.
    const language = said.language ?? acceptLanguage(req.get('accept-language'));
    if (!said.language) res.vary('Accept-Language');

    void (async () => {
      const file = pageFor(said.rest);
      if (file) {
        const html = await page(file, appOrigin(), language, Boolean(said.language));
        if (html) {
          res.type('html').set('Cache-Control', 'public, max-age=300').send(html);
          return;
        }
      }
      files(req, res, () =>
        appFiles(req, res, async () => {
          const missing = await page(join(SITE_DIR, '404.html'), appOrigin(), language, Boolean(said.language));
          res.status(404).type('html').send(missing ?? 'Not found');
        }),
      );
    })().catch(next);
  };
}
