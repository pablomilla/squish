/**
 * The privacy policy says that when it changes in a way that affects what we
 * do with somebody's data, the app will say so rather than quietly swapping
 * the page. This is the app saying so: once, on Home, to anybody who was
 * already using Squish before the change. Somebody who starts afterwards
 * agreed to the policy as it now stands, and is not told it has "changed".
 *
 * When the policy changes again in a way that matters, move POLICY_CHANGED
 * to that day and change the words below.
 */
import { useEffect, useState } from 'react';
import { useSquish } from '../store/useSquish';
import { apiUrl } from '../lib/origin';
import { languageOf } from '../lib/language';
import { regionOf } from '../lib/region';
import { t } from '../lib/i18n';

export const POLICY_CHANGED = '2026-10-03';
const KEY = 'squish-policy-seen';

function seen(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return POLICY_CHANGED;
  }
}

function remember(): void {
  try {
    localStorage.setItem(KEY, POLICY_CHANGED);
  } catch {
    /* private browsing: it shows again next time, which is harmless */
  }
}

export default function PolicyNotice() {
  const profile = useSquish((s) => s.profile);
  // Somebody with a meal from before the change was using Squish under the old policy.
  const before = useSquish((s) => s.meals.some((meal) => meal.date < POLICY_CHANGED));
  const [open, setOpen] = useState(() => seen() < POLICY_CHANGED);

  useEffect(() => {
    // Nothing to tell somebody who started after it: note it and say nothing.
    if (open && !before) {
      remember();
      setOpen(false);
    }
  }, [open, before]);

  if (!open || !before) return null;

  const done = () => {
    remember();
    setOpen(false);
  };

  return (
    <section className="card policy-notice" role="status">
      <div className="card-title">
        <h3>{t('Our privacy policy has changed')}</h3>
      </div>
      <p className="small">
        {t(
          'Google’s Gemini now reads most of your photos, meals and questions, with Anthropic’s Claude as a backup when Gemini cannot answer. Google do not use them to improve their products. On Squish Plus we also note the days an account reaches a fair-use ceiling — a day and which kind, nothing more.',
        )}
      </p>
      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <a
          className="btn btn--sm btn--ghost grow"
          href={apiUrl(`/privacy?lang=${languageOf(profile)}&country=${regionOf(profile)}`)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={done}
        >
          {t('Read the policy')}
        </a>
        <button type="button" className="btn btn--sm grow" onClick={done}>
          {t('Got it')}
        </button>
      </div>
    </section>
  );
}
