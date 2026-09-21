/**
 * The few things the app has to say to the phone it is running on.
 *
 * All of it is optional and none of it matters on the web, so every call is
 * wrapped: a plugin that is missing, or a phone that refuses, must not stop
 * Squish from opening. The app worked before any of this existed and it still
 * has to.
 */
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative } from './origin';

/** Called once, as early as possible, before the first paint people notice. */
export async function startNative(dark: boolean): Promise<void> {
  if (!isNative()) return;

  await Promise.allSettled([
    // The app draws under the status bar — the layout already leaves room
    // for it, from the same safe-area insets the browser build uses.
    StatusBar.setOverlaysWebView({ overlay: true }),
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }),
    // Hidden once React has something on screen, rather than on a timer that
    // is either too short (a white flash) or too long (a wait for nothing).
    SplashScreen.hide(),
  ]);
}

/** Keep the clock and battery legible when the theme changes underneath them. */
export async function matchStatusBar(dark: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
  } catch {
    /* a phone that will not be told is not a reason to fail */
  }
}
