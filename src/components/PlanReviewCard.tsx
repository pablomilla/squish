import { useSquish } from '../store/useSquish';
import { CloseIcon } from './icons';
import { isoDate, weekOf } from '../lib/date';
import { checkInDue, isNever, lastWeekReview, type Outcome } from '../lib/planLearning';
import { plural, t } from '../lib/i18n';
import './plan-review.css';

const MISSED: Record<Exclude<Outcome, 'made'>, () => string> = {
  skipped: () => t('skipped'),
  swapped: () => t('swapped'),
  dropped: () => t('taken off'),
};

/**
 * How last week's plan went, once a week, at the top of the meal plan.
 *
 * What they made, and what they didn't — each of those with a "Not for me"
 * that stops it being planned again. Said plainly and never as a score: a
 * plan not followed is the plan's to learn from, not theirs to answer for.
 * Closed, it stays closed until next week.
 */
export default function PlanReviewCard() {
  const planLog = useSquish((s) => s.planLog);
  const notForMe = useSquish((s) => s.notForMe);
  const reviewSeen = useSquish((s) => s.reviewSeen);
  const { toggleNotForMe, setReviewSeen } = useSquish.getState();
  const today = isoDate();
  const thisWeek = weekOf(today)[0];
  const review = lastWeekReview(planLog, today);
  if (!checkInDue(review, reviewSeen, thisWeek)) return null;

  const share = review.made / review.planned;
  const verdict =
    share >= 0.75
      ? t('That plan fitted your week. The next one keeps to what you made.')
      : share < 0.5
        ? t('That was a lot to fit in. The next plan will be simpler: fewer dishes, more leftovers.')
        : t('The next plan leans on what you made, and less on what you didn’t.');

  return (
    <section className="plan-review" aria-labelledby="plan-review-title">
      <div className="row-between">
        <h3 id="plan-review-title" className="small">{t('How last week’s plan went')}</h3>
        <button type="button" className="icon-btn" aria-label={t('Close until next week')} onClick={() => setReviewSeen(thisWeek)}>
          <CloseIcon size={16} />
        </button>
      </div>
      <p className="plan-review-count">
        <b>{t('You made {made} of {planned}', { made: review.made, planned: review.planned })}</b>{' '}
        <span className="small muted">{plural(review.planned, { one: 'planned meal', other: 'planned meals' })}</span>
      </p>
      <div className="plan-review-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </div>
      <p className="small muted">{verdict}</p>

      {review.hits.length > 0 && (
        <p className="small plan-review-hits" dir="auto">
          <span aria-hidden="true">💜 </span>
          {review.hits.slice(0, 3).map((h) => (h.times > 1 ? `${h.title} ×${h.times}` : h.title)).join(' · ')}
        </p>
      )}

      {review.misses.length > 0 && (
        <ul className="plan-review-misses">
          {review.misses.slice(0, 4).map((m) => {
            const never = isNever(notForMe, m.title);
            return (
              <li key={m.title}>
                <span className="plan-review-miss" dir="auto">
                  <span className={never ? 'is-never' : ''}>{m.title}</span>
                  <span className="tiny muted"> · {MISSED[m.outcome as Exclude<Outcome, 'made'>]()}</span>
                </span>
                <button type="button" className={`chip chip--sm${never ? ' chip--on' : ''}`} aria-pressed={never} onClick={() => toggleNotForMe(m.title)}>
                  {never ? t('Not for me ✓') : t('Not for me')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {review.misses.length > 0 && <p className="tiny muted">{t('Busy week? Leave them be — only “Not for me” rules a meal out.')}</p>}
    </section>
  );
}
