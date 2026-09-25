import { Sheet } from '../ui';
import { scoreLabel } from '../../lib/nutrition';
import { EARLY_KCAL, type DayExplained } from '../../lib/dayExplained';
import ScoreReasons from '../ScoreReasons';

/**
 * What the day score is, and what moved it today. Opened from the score on
 * the diary, so the number teaches something rather than only judging.
 */
export default function DayScoreSheet({ open, onClose, explained }: { open: boolean; onClose: () => void; explained: DayExplained }) {
  const { score, early, reasons, tip, calories } = explained;
  const { label, tone } = scoreLabel(score);

  return (
    <Sheet open={open} onClose={onClose} title="Today's food quality">
      <div className="day-score">
        <div className="day-score-head">
          <span className={`day-score-number day-score-number--${early ? 'none' : tone}`}>{score > 0 ? score : '–'}</span>
          <div>
            <b>{early ? 'Early days' : label}</b>
            <p className="tiny muted">
              {early
                ? `${calories} kcal logged so far. The score settles once there is more to go on — about ${EARLY_KCAL} kcal, or a proper meal.`
                : 'How good today’s food was for what it’s made of. Not how much you ate — that is the calorie ring.'}
            </p>
          </div>
        </div>

        {reasons.length > 0 && (
          <>
            <h4 className="small">{early ? 'So far' : 'What moved it today'}</h4>
            <ScoreReasons reasons={reasons} base={false} />
          </>
        )}

        {tip && <p className="small day-tip">💡 {tip}</p>}

        <details className="day-how">
          <summary className="small">How it works</summary>
          <p className="tiny muted">
            Every meal starts at 52 and is scored on its make-up per calorie: protein and fibre lift it; added sugar, saturated fat and
            salt bring it down, and so does food being ultra-processed. The day is your meals’ scores averaged by calories, so a big
            dinner counts for more than a biscuit, and going well over a daily limit takes a few points off.
          </p>
          <p className="tiny muted">75 and over is Brilliant, 55 Balanced, 38 So-so, and under that there is room to improve.</p>
        </details>
      </div>
    </Sheet>
  );
}
