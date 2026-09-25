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
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';

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

const pages = new Map<string, string>();

/** A page from `site/`, with the app's address filled in. */
async function page(file: string, appOrigin: string): Promise<string | null> {
  const key = `${file}|${appOrigin}`;
  const cached = pages.get(key);
  if (cached !== undefined) return cached;
  try {
    const html = (await readFile(file, 'utf8')).replaceAll(APP_PLACEHOLDER, appOrigin);
    // Cached for the life of the process: the pages only change with a deploy.
    if (process.env.NODE_ENV === 'production') pages.set(key, html);
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

    void (async () => {
      const file = pageFor(req.path);
      if (file) {
        const html = await page(file, appOrigin());
        if (html) {
          res.type('html').set('Cache-Control', 'public, max-age=300').send(html);
          return;
        }
      }
      files(req, res, () =>
        appFiles(req, res, async () => {
          const missing = await page(join(SITE_DIR, '404.html'), appOrigin());
          res.status(404).type('html').send(missing ?? 'Not found');
        }),
      );
    })().catch(next);
  };
}
