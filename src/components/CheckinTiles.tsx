import { DropIcon, ShoeIcon } from './icons';
import { formatWeight, type Units } from '../lib/units';
import { shortSteps } from '../lib/words';
import { t } from '../lib/i18n';
import './checkin-tiles.css';

export type Checkin = 'water' | 'steps' | 'weight';

/**
 * Water, steps and weight for one day, as three tiles: each opens its detail,
 * and water and steps have a plus for the tap made most often.
 */
export default function CheckinTiles({
  water,
  waterTarget,
  steps,
  weightKg,
  units,
  stepsAdd,
  onWater,
  onSteps,
  onOpen,
  only,
}: {
  water: number;
  waterTarget: number;
  steps: number;
  weightKg: number | undefined;
  units: Units;
  /** How many steps the plus adds. */
  stepsAdd: number;
  onWater: (glasses: number) => void;
  onSteps: (steps: number) => void;
  onOpen: (which: Checkin) => void;
  /** Just these, for the essentials view. */
  only?: readonly Checkin[];
}) {
  const shows = (which: Checkin) => !only || only.includes(which);
  return (
    <div className={`checkins${only ? ' checkins--few' : ''}`}>
      {shows('water') && <div className="checkin">
        <button type="button" className="checkin-main" onClick={() => onOpen('water')}>
          <span className="tiny muted checkin-label">
            <DropIcon size={14} /> {t('Water')}
          </span>
          <b className="small">{t('{done}/{target}', { done: water, target: waterTarget })}</b>
        </button>
        <button type="button" className="checkin-plus" aria-label={t('Add a glass of water')} onClick={() => onWater(water + 1)}>
          +
        </button>
      </div>}
      {shows('steps') && <div className="checkin">
        <button type="button" className="checkin-main" onClick={() => onOpen('steps')}>
          <span className="tiny muted checkin-label">
            <ShoeIcon size={14} /> {t('Steps')}
          </span>
          <b className="small">{shortSteps(steps)}</b>
        </button>
        <button type="button" className="checkin-plus" aria-label={t('Add {n} steps', { n: stepsAdd })} onClick={() => onSteps(steps + stepsAdd)}>
          +
        </button>
      </div>}
      {shows('weight') && <div className="checkin">
        <button type="button" className="checkin-main" onClick={() => onOpen('weight')}>
          <span className="tiny muted checkin-label">
            <span aria-hidden="true">⚖️</span> {t('Weight')}
          </span>
          <b className="small">{weightKg ? formatWeight(weightKg, units) : t('Log')}</b>
        </button>
      </div>}
    </div>
  );
}
