/**
 * Load a screen when it is first opened rather than with the app.
 *
 * Everything used to arrive in one 515 kB file, so somebody opening Squish to
 * log a sandwich downloaded the admin dashboard, the password-reset page and
 * the onboarding they finished weeks ago before seeing anything. Screens most
 * people rarely or never open now come separately, when they are opened.
 *
 * The cost of that is one well-known failure, handled here. Each build names
 * its files after their contents, so a deploy removes the old names from the
 * server. Somebody with Squish open across a deploy still holds the old page,
 * which asks for the old names — and opening the nutritionist gives a blank
 * screen and "Failed to fetch dynamically imported module". The answer is to
 * reload once, which fetches the new page with the new names. Once, and
 * remembered for the session, so a genuinely missing file cannot turn into a
 * loop that reloads for ever.
 */
import { lazy, type ComponentType } from 'react';

const RELOADED = 'squish-reloaded-for-chunk';

export function lazyScreen<Props>(load: () => Promise<{ default: ComponentType<Props> }>) {
  return lazy(async () => {
    try {
      const loaded = await load();
      // It worked, so any earlier reload has done its job; a later deploy
      // deserves its own one.
      try {
        sessionStorage.removeItem(RELOADED);
      } catch {
        /* private browsing — the guard below still holds for this page */
      }
      return loaded;
    } catch (error) {
      let already = false;
      try {
        already = sessionStorage.getItem(RELOADED) === '1';
        if (!already) sessionStorage.setItem(RELOADED, '1');
      } catch {
        /* no storage: fall through to a single reload attempt */
      }

      if (!already) {
        window.location.reload();
        // Never settles: the page is going away, and rendering an error in
        // the meantime would flash one.
        return new Promise<never>(() => {});
      }
      throw error;
    }
  });
}
