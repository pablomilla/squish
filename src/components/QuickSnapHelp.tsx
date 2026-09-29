import { Capacitor } from '@capacitor/core';
import { t } from '../lib/i18n';
import './quick-snaps.css';

/**
 * How to put quick snap a tap away, for the phone they are holding: the
 * widget in the app, the icon's shortcut on an installed web app. What it is
 * for comes first — the steps only matter to somebody who wants it.
 */
export default function QuickSnapHelp({ onTry }: { onTry: () => void }) {
  const platform = Capacitor.getPlatform();
  const steps =
    platform === 'ios'
      ? [
          t('Touch and hold an empty part of your Home Screen, then tap Edit and Add Widget.'),
          t('Find Squish and add Quick snap. It fits on the Lock Screen too.'),
          t('On iOS 18 you can also add it to Control Centre, or set it on the Action Button.'),
        ]
      : platform === 'android'
        ? [
            t('Touch and hold an empty part of your home screen, then tap Widgets.'),
            t('Find Squish and drag Quick snap where you want it.'),
            t('Or touch and hold the Squish icon and tap Quick snap.'),
          ]
        : [
            t('On Android, with Squish added to your home screen: touch and hold its icon and tap Quick snap.'),
            t('The Squish app for iPhone and Android has a Quick snap widget for the home screen and Lock Screen.'),
          ];
  return (
    <div className="stack">
      <p className="small">
        {t('For when there is no time, or holding your phone up would be rude: one tap opens the camera, one tap takes it, and you can put your phone away. Squish logs the meal for you to check later.')}
      </p>
      <ol className="quick-snap-help">
        {steps.map((step) => (
          <li key={step} className="small">
            {step}
          </li>
        ))}
      </ol>
      <p className="tiny muted">
        {t('The photo goes to Squish to be read and is deleted from the server as soon as it has been — usually within seconds. It counts as one photo read.')}
      </p>
      <button type="button" className="btn btn--block" onClick={onTry}>
        {t('Try it now')}
      </button>
    </div>
  );
}
