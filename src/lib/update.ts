/**
 * Keeping an open app up to date.
 *
 * A browser keeps running the app it loaded until it is reloaded, so a phone
 * that leaves Squish open for days never gets the fixes deployed meanwhile —
 * it went on losing meal plans after the fix for it had shipped. So the app
 * asks the server which build it serves (/api/build, written at build time
 * by vite.config.ts) whenever it comes back to the screen, and now and then
 * while it is open, and compares it with its own (__SQUISH_BUILD__).
 *
 * What happens then is up to src/components/UpdateWatcher.tsx: a quiet
 * reload when nothing would be lost, a "tap to refresh" when something might.
 * Everything a reload could lose that matters — the diary, a meal plan on its
 * way or arrived, an unsaved meal — is already kept on the device.
 *
 * Not in the phone app: its code comes from the store, and a reload there
 * only reloads the same version.
 */
import { apiUrl, isNative } from './origin';

/** This app's build; absent outside a Vite build (tests, scripts). */
export const RUNNING_BUILD: string | null = typeof __SQUISH_BUILD__ === 'string' ? __SQUISH_BUILD__ : null;

/** Whether this app can update itself by reloading at all. */
export const canUpdate = (): boolean => Boolean(RUNNING_BUILD) && !isNative();

/** The build the server is serving now, or null if it does not say (development) or cannot be reached. */
export async function servedBuild(): Promise<string | null> {
  try {
    const response = await fetch(apiUrl(`/api/build?t=${Date.now()}`), { cache: 'no-store' });
    if (!response.ok) return null;
    const { build } = (await response.json()) as { build?: string | null };
    return typeof build === 'string' && build ? build : null;
  } catch {
    return null;
  }
}

/** A newer build is being served than the one running here. */
export async function newerBuild(): Promise<string | null> {
  if (!canUpdate()) return null;
  const served = await servedBuild();
  return served && served !== RUNNING_BUILD ? served : null;
}

/**
 * Reload into the new build — once per build. If the page comes back still
 * the old one (a cache in the way), it is not reloaded again and again; the
 * refresh button is left for the person to try.
 */
const RELOADED_KEY = 'squish-reloaded-for';
export function reloadInto(build: string): boolean {
  try {
    if (sessionStorage.getItem(RELOADED_KEY) === build) return false;
    sessionStorage.setItem(RELOADED_KEY, build);
  } catch {
    /* no session storage: reload anyway, the build check stops a loop by itself once it is current */
  }
  window.location.reload();
  return true;
}
