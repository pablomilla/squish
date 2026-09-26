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
import { plural, t, uiLocale } from '../lib/i18n';
import { rich } from '../lib/i18n-react';

/*
 * Whole sentences for each kind, rather than one sentence with the kind
 * dropped in: in most languages the words round "questions" change with it.
 */
const USED: Record<OutOfAllowance['kind'], () => string> = {
  photo: () => t("You have used this month's AI meal analyses."),
  chat: () => t("You have used this month's questions for the nutritionist."),
  recipe: () => t("You have used this month's recipe imports."),
  weekplan: () => t("You have used this month's weekly plans from the nutritionist."),
};

const COME_WITH: Record<OutOfAllowance['kind'], () => string> = {
  photo: () => t('AI meal analyses come with {plus}.', { plus: PLUS }),
  chat: () => t('Questions for the nutritionist come with {plus}.', { plus: PLUS }),
  recipe: () => t('Recipe imports come with {plus}.', { plus: PLUS }),
  weekplan: () => t('Weekly plans from the nutritionist come with {plus}.', { plus: PLUS }),
};

const THAT_WAS: Record<OutOfAllowance['kind'], (n: number) => string> = {
  photo: (n) => plural(n, { one: 'That was your {n} free AI meal analysis. From here, they are part of {plus}.', other: 'That was your {n} free AI meal analyses. From here, they are part of {plus}.' }, { plus: PLUS }),
  chat: (n) => plural(n, { one: 'That was your {n} free question for the nutritionist. From here, they are part of {plus}.', other: 'That was your {n} free questions for the nutritionist. From here, they are part of {plus}.' }, { plus: PLUS }),
  recipe: (n) => plural(n, { one: 'That was your {n} free recipe import. From here, they are part of {plus}.', other: 'That was your {n} free recipe imports. From here, they are part of {plus}.' }, { plus: PLUS }),
  weekplan: (n) => plural(n, { one: 'That was your {n} free weekly plan. From here, they are part of {plus}.', other: 'That was your {n} free weekly plans. From here, they are part of {plus}.' }, { plus: PLUS }),
};

/** Reached by trying to use the nutritionist: the sheet leads with it. */
const aboutNutritionist = (kind: OutOfAllowance['kind']) => kind === 'chat' || kind === 'weekplan';

/** The day the month turns over, said the way a person would say it. */
function comesBack(iso: string | null | undefined): string {
  const when = iso ? new Date(iso) : null;
  if (!when || Number.isNaN(when.getTime())) return t('They come back next month.');
  return t('They come back on {date}.', { date: when.toLocaleDateString(uiLocale(), { day: 'numeric', month: 'long' }) });
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
    <Sheet open={Boolean(standing)} onClose={onClose} title={paying ? t('That is this month') : signUp ? t('Try it free') : PLUS}>
      {standing && signUp && (
        <div className="stack paywall">
          <Squish mood="excited" size={84} />
          <p className="small">
            {aboutNutritionist(standing.kind)
              ? t('Make a free account and ask the nutritionist {n} questions on us — it reads your diary before it answers.', { n: standing.taste ?? 3 })
              : t('Make a free account and your first {n} AI meal analyses are on us — snap the plate, or just say what you ate.', { n: standing.taste ?? 5 })}
          </p>
          {aboutNutritionist(standing.kind) && <NutritionistPitch compact />}
          <p className="tiny muted">
            {t('An account also keeps a copy of your diary, so a new phone is not a fresh start. Logging by hand, food search and everything else stay free without one.')}
          </p>
          <button type="button" className="btn btn--block" onClick={onCreateAccount}>
            {t('Make a free account')}
          </button>
          <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>
            {t('Not now')}
          </button>
        </div>
      )}
      {standing && !signUp && (
        <div className="stack paywall">
          <Squish mood={paying ? 'calm' : 'excited'} size={84} />

          {paying ? (
            <>
              <p className="small">
                {USED[standing.kind]()} {comesBack(standing.resets)}
              </p>
              <p className="tiny muted">
                {t('There is a limit even on {plus} because the analysis costs real money to run, and a plan with no ceiling would have to cost more for everybody. Logging by hand, food search and everything already in your diary carry on as normal.', { plus: PLUS })}
              </p>
            </>
          ) : (
            <>
              {/*
                An allowance of nought is not an allowance somebody spent —
                they never had one. "You have used your 0 free questions" is
                the sort of sentence that makes an app feel written by nobody.
              */}
              {aboutNutritionist(standing.kind) && <h3 className="paywall-headline">{t('Your own nutritionist')}</h3>}
              <p className="small">
                {standing.allowance === 0 ? COME_WITH[standing.kind]() : THAT_WAS[standing.kind](standing.allowance)}
              </p>

              {aboutNutritionist(standing.kind) && <NutritionistPitch />}

              <ul className="paywall-list">
                <li className="paywall-star">
                  {rich('<b>The nutritionist</b> — {n} questions a month about your own diary, and a weekly meal plan with its shopping list', { n: 30 }, { b: (text) => <b>{text}</b> })}
                </li>
                <li>
                  {rich('<b>{n} AI meal analyses a month</b> — snap the plate, or say or type what you ate', { n: 60 }, { b: (text) => <b>{text}</b> })}
                </li>
                <li>
                  {rich("<b>{n} recipe imports a month</b> — paste a link, get a portion's nutrition", { n: 10 }, { b: (text) => <b>{text}</b> })}
                </li>
                <li>
                  {rich('<b>Wild finishes</b> for Squish — rainbow, gold, holographic and more', {}, { b: (text) => <b>{text}</b> })}
                </li>
              </ul>

              <p className="paywall-price">
                {rich('<b>{monthly}</b> a month, or <b>{yearly}</b> a year', {
                  monthly: formatPrice(currentRegion().price.monthly),
                  yearly: formatPrice(currentRegion().price.yearly),
                }, { b: (text) => <b>{text}</b> })}
              </p>
              <p className="tiny muted">{t('A year works out at {price} a week — less than a coffee, for a nutritionist who has read your diary.', { price: weeklyPrice() })}</p>

              {/*
                Honest rather than aspirational. There is no way to take money
                yet — subscriptions have to go through the stores' own billing
                on a phone, which arrives with the phone app. Pretending
                otherwise would mean a button that does nothing, which is worse
                than no button.
              */}
              <p className="tiny muted paywall-soon">
                {t('Not on sale yet. Squish is being tested, and payment arrives with the phone app — so for now this is here to be told whether it is worth it. If you would pay for this, or would not, please say.')}
              </p>
            </>
          )}

          <p className="tiny muted">
            {t('Free for ever, either way: logging by hand, food search, your whole diary, the charts, streaks and export.')}
          </p>

          <button type="button" className="btn btn--block" onClick={onClose}>
            {paying ? t('Right you are') : t('Carry on without it')}
          </button>
        </div>
      )}
    </Sheet>
  );
}
