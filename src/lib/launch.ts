/**
 * Opening Squish somewhere other than Home: from a widget, a home-screen
 * shortcut, or the Control Centre button, straight into a quick snap.
 *
 * All of them open the same link — squish://snap in the app, /?snap on the
 * web (the installed web app's shortcut) — so there is one thing to handle,
 * however it was asked for.
 */
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { isNative } from './origin';

/** squish://snap, app.squish.tracker://snap, https://…/?snap, /snap, #snap: all the same ask. */
export function isSnapLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'squish:' || parsed.protocol === 'app.squish.tracker:') {
      return parsed.host === 'snap' || parsed.pathname.replace(/^\/+/, '') === 'snap';
    }
    return parsed.searchParams.has('snap') || parsed.pathname === '/snap' || parsed.hash === '#snap';
  } catch {
    return false;
  }
}

/**
 * Whether this page was opened to snap, read once at startup. The address is
 * put back to plain afterwards, so a reload or a shared link does not open
 * the camera again.
 */
export function openedToSnap(): boolean {
  // Through globalThis: this file is also read by the tests, which run with no page.
  const page = globalThis as { location?: { href: string }; history?: { state: unknown; replaceState: (state: unknown, unused: string, url: string) => void } };
  if (!page.location || !isSnapLink(page.location.href)) return false;
  const clean = new URL(page.location.href);
  clean.searchParams.delete('snap');
  if (clean.pathname === '/snap') clean.pathname = '/';
  if (clean.hash === '#snap') clean.hash = '';
  page.history?.replaceState(page.history.state, '', clean.toString());
  return true;
}

const HANDLED = 'squish-launch-handled';

/**
 * Snap links arriving in the app: the one it was started with, and any while
 * it is already running (the widget tapped with Squish in the background).
 */
export function onSnapLink(open: () => void): () => void {
  if (!isNative()) return () => {};
  let live = true;
  void App.getLaunchUrl()
    .then((launch) => {
      if (!live || !launch?.url || !isSnapLink(launch.url)) return;
      // The launch link is still the launch link after the page reloads (an update): once is enough.
      try {
        if (sessionStorage.getItem(HANDLED) === launch.url) return;
        sessionStorage.setItem(HANDLED, launch.url);
      } catch {
        /* no storage: the camera opening again is the lesser harm */
      }
      open();
    })
    .catch(() => {});
  const listening = App.addListener('appUrlOpen', ({ url }) => {
    if (isSnapLink(url)) open();
  }).catch(() => null);
  return () => {
    live = false;
    void listening.then((handle) => handle?.remove());
  };
}

/**
 * Done snapping. On Android the app steps out of the way, back to wherever
 * they were, as a widget's job is done; iOS allows no app to do that, so
 * there, and on the web, it goes to Home.
 */
export function finishQuickSnap(toHome: () => void): void {
  toHome();
  if (Capacitor.getPlatform() === 'android') void App.minimizeApp().catch(() => {});
}
