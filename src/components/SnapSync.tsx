import { useEffect } from 'react';
import { LocalNotifications } from '@capacitor/local-notifications';
import { useToast } from './ui';
import { onSnapsLogged, watchSnaps } from '../lib/snaps';
import { isNative } from '../lib/origin';
import { formatEnergy } from '../lib/region';
import { plural, t } from '../lib/i18n';

/**
 * Keeps quick snaps moving while the app is open (src/lib/snaps.ts), and says
 * when one has been logged: a word on screen if somebody is looking, a quiet
 * notification if the app is open but out of sight — and only where they have
 * already allowed Squish's notifications. Nothing here asks for that.
 */
export default function SnapSync() {
  const toast = useToast();

  useEffect(() => watchSnaps(), []);

  useEffect(
    () =>
      onSnapsLogged((logged) => {
        const words =
          logged.length === 1
            ? t('{meal} logged from your quick snap — {energy}. Check it when you have a moment.', {
                meal: logged[0].title,
                energy: formatEnergy(logged[0].nutrients.calories),
              })
            : plural(logged.length, { one: '{n} quick snap logged. Check it when you have a moment.', other: '{n} quick snaps logged. Check them when you have a moment.' });
        if (document.visibilityState === 'visible' || !isNative()) {
          toast(words, '📸');
          return;
        }
        void (async () => {
          try {
            if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
            await LocalNotifications.schedule({
              notifications: [{ id: 7_000_000 + Math.floor(Math.random() * 1_000_000), title: t('Logged from your snap'), body: words }],
            });
          } catch {
            /* a notification that cannot be shown is only a notification */
          }
        })();
      }),
    [toast],
  );

  return null;
}
