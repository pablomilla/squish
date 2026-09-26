/**
 * What somebody sees when they reach the end of their allowance.
 *
 * Two audiences and two entirely different messages, which is why the tier
 * decides almost everything here.
 *
 * Somebody on the free plan is being asked to consider paying, so this says
 * what Plus is for and what it costs — and, importantly, says what still
 * works without it. Squish is a usable food diary on the free plan: logging by
 * hand, food search, the diary, charts, streaks. A paywall that implies the
 * app is now useless is lying, and they will find out.
 *
 * Somebody already paying has run into the ceiling that keeps the price
 * honest. There is nothing to sell them and nothing for them to do, so this
 * says when it comes back and gets out of the way. Being shown an upgrade
 * prompt you have already bought is the fastest way to lose somebody.
 */
import { Sheet } from './ui';
import Squish from './Squish';
import { PLUS } from '../lib/plan';
import { currentRegion, formatPrice, weeklyPrice } from '../lib/region';
import type { OutOfAllowance } from '../lib/api';
import NutritionistPitch from './NutritionistPitch';
import './paywall.css';

const WHAT: Record<OutOfAllowance['kind'], string> = {
  photo: 'AI meal analyses',
  chat: 'questions for the nutritionist',
  recipe: 'recipe imports',
  weekplan: 'weekly plans from the nutritionist',
};

/** Reached by trying to use the nutritionist: the sheet leads with it. */
const aboutNutritionist = (kind: OutOfAllowance['kind']) => kind === 'chat' || kind === 'weekplan';

/** The day the month turns over, said the way a person would say it. */
function comesBack(iso: string | null | undefined): string {
  if (!iso) return 'next month';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'next month';
  return `on ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;
}

export default function Paywall({
  standing,
  onClose,
  onCreateAccount,
}: {
  standing: OutOfAllowance | null;
  onClose: () => void;
  /** Take somebody who is signed out to the create-account form. */
  onCreateAccount: () => void;
}) {
  const paying = standing?.plan === 'plus';
  // Signed out on the free plan: the answer is an account, not a subscription.
  const signUp = Boolean(standing?.needsAccount);

  return (
    <Sheet open={Boolean(standing)} onClose={onClose} title={paying ? 'That is this month' : signUp ? 'Try it free' : PLUS}>
      {standing && signUp && (
        <div className="stack paywall">
          <Squish mood="excited" size={84} />
          <p className="small">
            {aboutNutritionist(standing.kind)
              ? `Make a free account and ask the nutritionist ${standing.taste ?? 3} questions on us — it reads your diary before it answers.`
              : `Make a free account and your first ${standing.taste ?? 5} AI meal analyses are on us — snap the plate, or just say what you ate.`}
          </p>
          {aboutNutritionist(standing.kind) && <NutritionistPitch compact />}
          <p className="tiny muted">
            An account also keeps a copy of your diary, so a new phone is not a fresh start. Logging by hand, food
            search and everything else stay free without one.
          </p>
          <button type="button" className="btn btn--block" onClick={onCreateAccount}>
            Make a free account
          </button>
          <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>
            Not now
          </button>
        </div>
      )}
      {standing && !signUp && (
        <div className="stack paywall">
          <Squish mood={paying ? 'calm' : 'excited'} size={84} />

          {paying ? (
            <>
              <p className="small">
                You have used this month's {WHAT[standing.kind]}. They come back {comesBack(standing.resets)}.
              </p>
              <p className="tiny muted">
                There is a limit even on {PLUS} because the analysis costs real money to run, and a plan with no
                ceiling would have to cost more for everybody. Logging by hand, food search and everything already in
                your diary carry on as normal.
              </p>
            </>
          ) : (
            <>
              {/*
                An allowance of nought is not an allowance somebody spent —
                they never had one. "You have used your 0 free questions" is
                the sort of sentence that makes an app feel written by nobody.
              */}
              {aboutNutritionist(standing.kind) && <h3 className="paywall-headline">Your own nutritionist</h3>}
              <p className="small">
                {standing.allowance === 0
                  ? `${WHAT[standing.kind][0].toUpperCase()}${WHAT[standing.kind].slice(1)} come with ${PLUS}.`
                  : `That was your ${standing.allowance} free ${WHAT[standing.kind]}. From here, they are part of ${PLUS}.`}
              </p>

              {aboutNutritionist(standing.kind) && <NutritionistPitch />}

              <ul className="paywall-list">
                <li className="paywall-star">
                  <b>The nutritionist</b> — 30 questions a month about your own diary, and a weekly meal plan with its
                  shopping list
                </li>
                <li>
                  <b>60 AI meal analyses a month</b> — snap the plate, or say or type what you ate
                </li>
                <li>
                  <b>10 recipe imports a month</b> — paste a link, get a portion's nutrition
                </li>
                <li>
                  <b>Wild finishes</b> for Squish — rainbow, gold, holographic and more
                </li>
              </ul>

              <p className="paywall-price">
                <b>{formatPrice(currentRegion().price.monthly)}</b> a month, or <b>{formatPrice(currentRegion().price.yearly)}</b> a year
              </p>
              <p className="tiny muted">A year works out at {weeklyPrice()} a week — less than a coffee, for a nutritionist who has read your diary.</p>

              {/*
                Honest rather than aspirational. There is no way to take money
                yet — subscriptions have to go through the stores' own billing
                on a phone, which arrives with the phone app. Pretending
                otherwise would mean a button that does nothing, which is worse
                than no button.
              */}
              <p className="tiny muted paywall-soon">
                Not on sale yet. Squish is being tested, and payment arrives with the phone app — so for now this is
                here to be told whether it is worth it. If you would pay for this, or would not, please say.
              </p>
            </>
          )}

          <p className="tiny muted">
            Free for ever, either way: logging by hand, food search, your whole diary, the charts, streaks and export.
          </p>

          <button type="button" className="btn btn--block" onClick={onClose}>
            {paying ? 'Right you are' : 'Carry on without it'}
          </button>
        </div>
      )}
    </Sheet>
  );
}
