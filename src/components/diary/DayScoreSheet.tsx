import { Sheet } from '../ui';
import AskLink from '../AskLink';
import { scoreLabel } from '../../lib/nutrition';
import { EARLY_KCAL, type DayExplained } from '../../lib/dayExplained';
import ScoreReasons from '../ScoreReasons';
import { aboutEnergy, formatEnergy, localWords } from '../../lib/region';
import { t } from '../../lib/i18n';

/**
 * What the day score is, and what moved it today. Opened from the score on
 * the diary, so the number teaches something rather than only judging.
 */
export default function DayScoreSheet({
  open,
  onClose,
  explained,
  onAsk,
  question,
}: {
  open: boolean;
  onClose: () => void;
  explained: DayExplained;
  onAsk?: (question: string) => void;
  question?: string;
}) {
  const { score, early, reasons, tip, calories } = explained;
  const { label, tone } = scoreLabel(score);

  return (
    <Sheet open={open} onClose={onClose} title={t("Today's food quality")}>
      <div className="day-score">
        <div className="day-score-head">
          <span className={`day-score-number day-score-number--${early ? 'none' : tone}`}>{score > 0 ? score : '–'}</span>
          <div>
            <b>{early ? t('Early days') : label}</b>
            <p className="tiny muted">
              {early
                ? t('{energy} logged so far. The score settles once there is more to go on — about {settles}, or a proper meal.', { energy: formatEnergy(calories), settles: aboutEnergy(EARLY_KCAL) })
                : t('How good today’s food was for what it’s made of. Not how much you ate — that is the energy ring.')}
            </p>
          </div>
        </div>

        {reasons.length > 0 && (
          <>
            <h4 className="small">{early ? t('So far') : t('What moved it today')}</h4>
            <ScoreReasons reasons={reasons} base={false} />
          </>
        )}

        {tip && <p className="small day-tip">💡 {tip}</p>}

        {onAsk && question && <AskLink question={question} onAsk={onAsk} />}

        <details className="day-how">
          <summary className="small">{t('How it works')}</summary>
          <p className="tiny muted">
            {localWords(t('Every meal starts at 52 and is scored on its make-up per calorie: protein and fibre lift it; added sugar, saturated fat and salt bring it down, and so does food being ultra-processed. The day is your meals’ scores averaged by calories, so a big dinner counts for more than a biscuit, and going well over a daily limit takes a few points off.'))}
          </p>
          <p className="tiny muted">{t('75 and over is Brilliant, 55 Balanced, 38 So-so, and under that there is room to improve.')}</p>
        </details>
      </div>
    </Sheet>
  );
}
