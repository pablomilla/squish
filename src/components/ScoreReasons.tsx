import type { Reason } from '../lib/dayExplained';
import './score-reasons.css';
import { t } from '../lib/i18n';

/**
 * What moved a food-quality score, biggest first, each with a small bar:
 * green for what lifted it, amber for what brought it down. Used for a day,
 * a meal in the diary, and a meal being reviewed.
 */
export default function ScoreReasons({ reasons, base = true }: { reasons: Reason[]; base?: boolean }) {
  const biggest = Math.max(1, ...reasons.map((r) => Math.abs(r.points)));
  return (
    <div className="score-reasons">
      {base && <p className="tiny muted">{t('Every meal starts at {base}. Then:', { base: 52 })}</p>}
      <ul>
        {reasons.map((r) => (
          <li key={r.key} className={r.points > 0 ? 'up' : 'down'}>
            <span className="score-reason-words">
              {r.points > 0 ? '↑' : '↓'} {r.words}
            </span>
            <span className="score-reason-bar" aria-hidden="true">
              <span style={{ width: `${(Math.abs(r.points) / biggest) * 100}%` }} />
            </span>
            <span className="tiny muted score-reason-points">
              {r.points > 0 ? '+' : '−'}
              {Math.abs(r.points)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
