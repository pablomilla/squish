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
import type { OutOfAllowance } from '../lib/api';
import './paywall.css';

const WHAT: Record<OutOfAllowance['kind'], string> = {
  photo: 'photo analyses',
  chat: 'questions for the nutritionist',
  recipe: 'recipe imports',
};

/** The day the month turns over, said the way a person would say it. */
function comesBack(iso: string | undefined): string {
  if (!iso) return 'next month';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'next month';
  return `on ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}`;
}

export default function Paywall({ standing, onClose }: { standing: OutOfAllowance | null; onClose: () => void }) {
  const paying = standing?.plan === 'plus';

  return (
    <Sheet open={Boolean(standing)} onClose={onClose} title={paying ? 'That is this month' : PLUS}>
      {standing && (
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
              <p className="small">
                {standing.allowance === 0
                  ? `${WHAT[standing.kind][0].toUpperCase()}${WHAT[standing.kind].slice(1)} come with ${PLUS}.`
                  : `You have used your ${standing.allowance} free ${WHAT[standing.kind]} this month. They come back ${comesBack(standing.resets)}.`}
              </p>

              <ul className="paywall-list">
                <li>
                  <b>60 photo analyses a month</b> — snap the plate and let Squish work it out
                </li>
                <li>
                  <b>The nutritionist</b> — ask about your own diary, not the internet's
                </li>
                <li>
                  <b>Six more colourways</b> for Squish
                </li>
              </ul>

              <p className="paywall-price">
                <b>£4.99</b> a month, or <b>£39.99</b> a year
              </p>

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
