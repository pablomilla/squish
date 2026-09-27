/**
 * Refreshes the app into a newer build (src/lib/update.ts).
 *
 * Checked when the app comes back to the screen — the moment somebody picks
 * their phone up again — and every twenty minutes while it is open. Then:
 *
 * - Coming back to a main tab with nothing open over it: reloaded there and
 *   then. They were not looking at anything, so there is nothing to lose, and
 *   the page they return to is the new one.
 * - Anywhere else — the camera, a meal being reviewed, a sheet open, or
 *   while they are using it — a small bar says Squish has been updated and
 *   offers to refresh, rather than yanking the screen away mid-task. It
 *   reloads by itself the next time the app comes back to a quiet tab.
 */
import { useEffect, useRef, useState } from 'react';
import { canUpdate, newerBuild, reloadInto } from '../lib/update';
import { t } from '../lib/i18n';

const EVERY_MS = 20 * 60_000;
/** Not more often than this, however often the app is switched to and fro. */
const AT_MOST_MS = 60_000;

export default function UpdateWatcher({ quiet }: { quiet: boolean }) {
  const [waiting, setWaiting] = useState<string | null>(null);
  const quietRef = useRef(quiet);
  useEffect(() => {
    quietRef.current = quiet;
  }, [quiet]);

  useEffect(() => {
    if (!canUpdate()) return;
    let last = Date.now();
    let busy = false;

    // Quiet: on a main tab, and nothing open on top of it.
    const calm = () => quietRef.current && !document.querySelector('[role="dialog"]');

    const check = async (returning: boolean) => {
      if (busy || Date.now() - last < AT_MOST_MS) return;
      busy = true;
      last = Date.now();
      const build = await newerBuild();
      busy = false;
      if (!build) return;
      if (returning && calm() && reloadInto(build)) return;
      setWaiting(build);
    };

    const onShow = () => {
      if (document.visibilityState === 'visible') void check(true);
    };
    document.addEventListener('visibilitychange', onShow);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void check(false);
    }, EVERY_MS);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.clearInterval(timer);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div className="update-bar" role="status">
      <span className="small">{t('Squish has been updated.')}</span>
      <button type="button" className="btn btn--sm" onClick={() => window.location.reload()}>
        {t('Refresh')}
      </button>
    </div>
  );
}
