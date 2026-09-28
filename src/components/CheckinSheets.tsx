import { useMemo } from 'react';
import { Sheet, Stepper } from './ui';
import { DailyWeightWheel } from './Dials';
import type { Checkin } from './CheckinTiles';
import { useSquish } from '../store/useSquish';
import { GLASS_ML } from '../lib/nutrition';
import { formatWeight } from '../lib/units';
import { friendlyDate } from '../lib/date';
import { t } from '../lib/i18n';

/**
 * Logging water, steps and weight for one day, one sheet each: the same on
 * Home and in the diary, so there is one way to log each, not two.
 */
export default function CheckinSheets({ date, open, onClose }: { date: string; open: Checkin | null; onClose: () => void }) {
  const { days, profile, setWater, setSteps, setWeight } = useSquish();
  const day = days[date];
  // The last weigh-in before this day, for a word of context under the wheel.
  const lastWeighIn = useMemo(
    () =>
      Object.values(days)
        .filter((entry) => entry.weightKg && entry.date < date)
        .sort((a, b) => b.date.localeCompare(a.date))[0] as { date: string; weightKg: number } | undefined,
    [days, date],
  );

  return (
    <>
      <Sheet open={open === 'water'} onClose={onClose} title={t('Water')}>
        <div className="stack">
          <div className="row-between">
            <span className="small">
              💧 {t('Water')}
              <span className="tiny muted"> · {GLASS_ML} ml</span>
            </span>
            <Stepper value={day?.water ?? 0} min={0} max={20} onChange={(v) => setWater(date, v)} suffix={t('glasses')} />
          </div>
          <button type="button" className="btn btn--block" onClick={onClose}>
            {t('Done')}
          </button>
        </div>
      </Sheet>

      <Sheet open={open === 'steps'} onClose={onClose} title={t('Steps')}>
        <div className="stack">
          <div className="row-between">
            <span className="small">👟 {t('Steps')}</span>
            <Stepper value={day?.steps ?? 0} step={500} min={0} max={50000} onChange={(v) => setSteps(date, v)} />
          </div>
          <button type="button" className="btn btn--block" onClick={onClose}>
            {t('Done')}
          </button>
        </div>
      </Sheet>

      <Sheet open={open === 'weight'} onClose={onClose} title={t('Weight')}>
        <div className="stack">
          {/* A wheel, like setting up: stones stay stones, and kilograms turn to the tenth. */}
          <DailyWeightWheel kg={day?.weightKg ?? profile.weightKg} units={profile.units} onChange={(kg) => setWeight(date, kg)} />
          <p className="tiny muted center">
            {lastWeighIn
              ? t('Last logged {weight} on {date}.', { weight: formatWeight(lastWeighIn.weightKg, profile.units), date: friendlyDate(lastWeighIn.date) })
              : t('Weigh yourself at the same time of day — first thing is the steadiest.')}
          </p>
          {/* Saves what the wheel shows, so the same weight as last time can be logged without turning it. */}
          <button
            type="button"
            className="btn btn--block"
            onClick={() => {
              if (day?.weightKg === undefined) setWeight(date, profile.weightKg);
              onClose();
            }}
          >
            {day?.weightKg === undefined ? t('Log this weight') : t('Done')}
          </button>
        </div>
      </Sheet>
    </>
  );
}
