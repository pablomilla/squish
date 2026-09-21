/**
 * Where the server is.
 *
 * In a browser this is nothing at all: the page came from the server, so
 * `/api/chat` means the right thing and always has. Inside the phone app it
 * means nothing — the page is a file bundled into the app, served from
 * `capacitor://localhost`, and there is no server behind that. Every call has
 * to name the host, and a call that forgets fails with a 404 from a web view
 * rather than anything that reads like an explanation.
 *
 * So one function, used by everything that talks to the server. On the web it
 * returns the path unchanged and behaves exactly as before.
 */

/** True when running inside the iOS or Android shell rather than a browser. */
export function isNative(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

/**
 * The host the app talks to when it has no origin of its own.
 *
 * Baked in at build time. It has to be, because the app on somebody's phone
 * cannot be told later where its server moved to — a wrong value here ships,
 * and the only fix is another release through review.
 */
function configuredHost(): string {
  try {
    // Written as the literal Vite looks for, so it is substituted at build
    // time. Read in a try because anything that is not Vite — a test, a
    // script — has no `import.meta.env` at all, and a module that throws on
    // import takes the whole file down with it.
    return String(import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** Turn an app-relative path into something fetchable from wherever we are. */
export function apiUrl(path: string): string {
  if (!isNative()) return path;
  const host = configuredHost();
  if (!host) {
    // Loud, because the alternative is an app that looks broken for reasons
    // nobody can see. This is a build mistake, not a runtime condition.
    throw new Error('VITE_API_ORIGIN is not set — the app has no server to talk to.');
  }
  return `${host}${path}`;
}
