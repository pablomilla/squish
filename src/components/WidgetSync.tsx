import { useEffect, useState } from 'react';
import { useSquish } from '../store/useSquish';
import { widgetSummary } from '../lib/widgetData';
import { onWidgetSettingChange, sendWidgetSummary, widgetNumbersHidden } from '../lib/widgets';
import { currentEnergyUnit } from '../lib/region';
import { isNative } from '../lib/origin';

/** A moment's pause, so logging a meal of five items tells the widget once. */
const SETTLE_MS = 1500;

/**
 * Tells the home-screen widget about today whenever the diary changes, and
 * when the app is put away, which is when somebody next looks at the widget.
 * A new day the widget notices itself, from the date on the summary. Draws
 * nothing.
 */
export default function WidgetSync() {
  const meals = useSquish((s) => s.meals);
  const targets = useSquish((s) => s.targets);
  const snaps = useSquish((s) => s.snaps);
  const [hidden, setHidden] = useState(widgetNumbersHidden);

  useEffect(() => onWidgetSettingChange(() => setHidden(widgetNumbersHidden())), []);

  useEffect(() => {
    if (!isNative()) return;
    const send = () => void sendWidgetSummary(widgetSummary({ meals, targets, snaps, unit: currentEnergyUnit(), hidden }));
    const timer = window.setTimeout(send, SETTLE_MS);
    const onHide = () => document.visibilityState === 'hidden' && send();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [meals, targets, snaps, hidden]);

  return null;
}
