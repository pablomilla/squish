import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Squish as an app on a phone.
 *
 * The web build is bundled into the app rather than loaded from a server, so
 * it opens instantly, works on the Underground, and passes review — an app
 * that is a window onto a website gets rejected, and rightly.
 *
 * That means the API is somewhere else. In a browser `/api/chat` is the same
 * origin the page came from; inside the app the page comes from
 * `capacitor://localhost` and there is no server behind it. Every call has to
 * name the host, which is what `src/lib/origin.ts` is for.
 */
const config: CapacitorConfig = {
  appId: 'app.squish.tracker',
  appName: 'Squish',
  webDir: 'dist',

  ios: {
    // The camera and the scanner want the whole screen; the app draws its own
    // padding from the safe-area insets the web build already uses.
    contentInset: 'never',
    /*
     * Deliberately not setting limitsNavigationsToAppBoundDomains. It is a
     * sensible hardening option and it needs a matching WKAppBoundDomains
     * list in Info.plist; set wrong, it disables web-view features in ways
     * that only show up on a device. Nothing here can test that, and an
     * untestable restriction is not hardening, it is a bug waiting for a
     * release.
     */
  },

  android: {
    // Mixed content off: everything Squish talks to is https, and a debug
    // build that quietly allows http is how a release build ends up doing it.
    allowMixedContent: false,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#fbf7f2',
      showSpinner: false,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_squish',
      iconColor: '#6b5fe0',
    },
  },
};

export default config;
