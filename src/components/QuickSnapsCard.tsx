import { useMemo } from 'react';
import type { MealEntry, QueuedSnap, Route } from '../types';
import { MealThumb } from './MealCard';
import { useSquish } from '../store/useSquish';
import { dropSnap, retrySnap } from '../lib/snaps';
import { draftOf } from '../lib/draft';
import { addDays, friendlyDate, isoDate } from '../lib/date';
import { formatEnergy } from '../lib/region';
import { plural, t } from '../lib/i18n';
import './quick-snaps.css';

/** How far back a quick snap still asks to be checked. After that it is simply in the diary. */
const CHECK_DAYS = 7;

/**
 * Quick snaps, on Home, for when there is a moment: the ones still being
 * read, any that could not be, and the meals they became — logged without
 * anybody looking, so here to be looked at. Nothing shows when there is
 * nothing to say.
 */
export default function QuickSnapsCard({ go }: { go: (route: Route) => void }) {
  const snaps = useSquish((s) => s.snaps);
  const meals = useSquish((s) => s.meals);
  const confirmMeal = useSquish((s) => s.confirmMeal);
  const toCheck = useMemo(() => {
    const since = addDays(isoDate(), -CHECK_DAYS);
    return meals.filter((meal) => meal.quick && meal.date >= since).reverse();
  }, [meals]);

  const reading = snaps.filter((snap) => snap.state === 'sent' || snap.state === 'waiting');
  const stuck = snaps.filter((snap) => snap.state === 'failed' || snap.state === 'refused');
  if (!reading.length && !stuck.length && !toCheck.length) return null;

  return (
    <section className="card quick-snaps" aria-label={t('Quick snaps')}>
      <div className="card-title">
        <h3>{t('Quick snaps')}</h3>
        {toCheck.length > 0 && <span className="badge">{plural(toCheck.length, { one: '{n} to check', other: '{n} to check' })}</span>}
      </div>

      {reading.length > 0 && (
        <div className="quick-snaps-reading">
          <span className="quick-snaps-thumbs">
            {reading.slice(0, 4).map((snap) => (
              <img key={snap.id} src={snap.thumb} alt="" className="quick-snaps-thumb" />
            ))}
          </span>
          <p className="small">
            {reading.some((snap) => snap.state === 'sent')
              ? plural(reading.length, { one: 'Squish is reading your snap…', other: 'Squish is reading {n} snaps…' })
              : plural(reading.length, { one: 'Waiting for signal to send your snap.', other: 'Waiting for signal to send {n} snaps.' })}
          </p>
        </div>
      )}

      {stuck.map((snap) => (
        <StuckSnap key={snap.id} snap={snap} go={go} />
      ))}

      {toCheck.length > 0 && (
        <ul className="quick-snaps-list">
          {toCheck.map((meal) => (
            <ToCheck key={meal.id} meal={meal} onRight={() => confirmMeal(meal.id)} onChange={() => go({ name: 'review', draft: draftOf(meal) })} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ToCheck({ meal, onRight, onChange }: { meal: MealEntry; onRight: () => void; onChange: () => void }) {
  return (
    <li className="quick-snaps-row">
      <MealThumb meal={meal} className="quick-snaps-row-thumb" />
      <span className="quick-snaps-row-text">
        <b className="small" dir="auto">{meal.title}</b>
        <span className="tiny muted">
          {friendlyDate(meal.date)} · {meal.time} · {formatEnergy(meal.nutrients.calories)}
        </span>
      </span>
      <span className="quick-snaps-row-actions">
        <button type="button" className="btn btn--sm btn--ghost" onClick={onChange}>
          {t('Change')}
        </button>
        <button type="button" className="btn btn--sm" onClick={onRight}>
          {t('Looks right')}
        </button>
      </span>
    </li>
  );
}

function StuckSnap({ snap, go }: { snap: QueuedSnap; go: (route: Route) => void }) {
  const refused = snap.state === 'refused';
  return (
    <div className="quick-snaps-stuck">
      <img src={snap.thumb} alt="" className="quick-snaps-row-thumb" />
      <div className="grow">
        <p className="small">
          {refused
            ? t('No photo reads left for this snap from {when}.', { when: friendlyDate(snap.date).toLocaleLowerCase() })
            : t('Squish could not read your snap from {when}.', { when: friendlyDate(snap.date).toLocaleLowerCase() })}
        </p>
        <div className="row quick-snaps-stuck-actions">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => {
              go({ name: 'add', tab: 'describe', slot: snap.slot, date: snap.date });
              void dropSnap(snap.id);
            }}
          >
            {t('Describe it')}
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => retrySnap(snap.id)}>
            {t('Try again')}
          </button>
          <button type="button" className="btn--quiet small" onClick={() => void dropSnap(snap.id)}>
            {t('Remove')}
          </button>
        </div>
      </div>
    </div>
  );
}
