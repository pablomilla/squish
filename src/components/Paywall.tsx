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
 * Somebody already paying has run into a fair-use ceiling — far past a real
 * day's eating, so rare — or the week's weekly plans. There is nothing to
 * sell them and nothing for them to do, so this says when it comes back and
 * gets out of the way. Being shown an upgrade
 * prompt you have already bought is the fastest way to lose somebody.
 */
import { useState } from 'react';
import { Sheet } from './ui';
import Squish from './Squish';
import { PLUS } from '../lib/plan';
import { TRIAL_DAYS, currentRegion, formatPrice, weeklyPrice, yearlySaving } from '../lib/region';
import type { OutOfAllowance } from '../lib/api';
import NutritionistPitch from './NutritionistPitch';
import './paywall.css';
import { plural, t, uiLocale } from '../lib/i18n';
import { rich } from '../lib/i18n-react';
import { legalHref } from '../lib/legal';

/*
 * Whole sentences for each kind, rather than one sentence with the kind
 * dropped in: in most languages the words round "questions" change with it.
 */
const USED: Record<OutOfAllowance['kind'], () => string> = {
  photo: () => t('That is the fair-use ceiling for AI meal analyses today.'),
  chat: () => t('That is the fair-use ceiling for questions to Squish today.'),
  recipe: () => t('That is the fair-use ceiling for recipe imports today.'),
  weekplan: () => t("You have had this week's weekly plans from Squish."),
  // Never counted against a limit; here so every kind has its words.
  swap: () => t('Swapping planned meals comes with {plus}.', { plus: PLUS }),
  cook: () => t('Cooking steps for your planned meals come with {plus}.', { plus: PLUS }),
};

const COME_WITH: Record<OutOfAllowance['kind'], () => string> = {
  photo: () => t('AI meal analyses come with {plus}.', { plus: PLUS }),
  chat: () => t('Questions for Squish come with {plus}.', { plus: PLUS }),
  recipe: () => t('Recipe imports come with {plus}.', { plus: PLUS }),
  weekplan: () => t('Weekly plans from Squish come with {plus}.', { plus: PLUS }),
  swap: () => t('Swapping planned meals comes with {plus}.', { plus: PLUS }),
  cook: () => t('Cooking steps for your planned meals come with {plus}.', { plus: PLUS }),
};

const THAT_WAS: Record<OutOfAllowance['kind'], (n: number) => string> = {
  photo: (n) => plural(n, { one: 'That was your {n} free AI meal analysis. From here, they are part of {plus}.', other: 'That was your {n} free AI meal analyses. From here, they are part of {plus}.' }, { plus: PLUS }),
  chat: (n) => plural(n, { one: 'That was your {n} free question for Squish. From here, they are part of {plus}.', other: 'That was your {n} free questions for Squish. From here, they are part of {plus}.' }, { plus: PLUS }),
  recipe: (n) => plural(n, { one: 'That was your {n} free recipe import. From here, they are part of {plus}.', other: 'That was your {n} free recipe imports. From here, they are part of {plus}.' }, { plus: PLUS }),
  weekplan: (n) => plural(n, { one: 'That was your {n} free weekly plan. From here, they are part of {plus}.', other: 'That was your {n} free weekly plans. From here, they are part of {plus}.' }, { plus: PLUS }),
  swap: () => t('Swapping planned meals comes with {plus}.', { plus: PLUS }),
  cook: () => t('Cooking steps for your planned meals come with {plus}.', { plus: PLUS }),
};

/** Reached by trying to use the nutritionist: the sheet leads with it. */
const aboutNutritionist = (kind: OutOfAllowance['kind']) => kind === 'chat' || kind === 'weekplan' || kind === 'swap' || kind === 'cook';

/** When it comes back, said the way a person would say it: a day's ceiling tomorrow, the week's plans on Monday. */
function comesBack(kind: OutOfAllowance['kind'], iso: string | null | undefined): string {
  if (kind === 'weekplan') return t('They come back on Monday.');
  const when = iso ? new Date(iso) : null;
  if (!when || Number.isNaN(when.getTime()) || when.getTime() - Date.now() < 36 * 3_600_000) return t('It comes back tomorrow.');
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
  // Leaving without a plan is offered a month instead, once a visit; "No thanks" then really closes.
  const [offering, setOffering] = useState(false);
  const close = () => {
    setOffering(false);
    onClose();
  };
  const carryOn = () => (paying ? close() : setOffering(true));
  // Signed out on the free plan: the answer is an account, not a subscription.
  const signUp = Boolean(standing?.needsAccount);

  return (
    <Sheet open={Boolean(standing)} onClose={close} title={paying ? t('Fair use') : signUp ? t('Try it free') : offering ? t('Before you go') : PLUS}>
      {standing && signUp && (
        <div className="stack paywall">
          <Squish mood="excited" size={84} />
          <p className="small">
            {aboutNutritionist(standing.kind)
              ? t('Make a free account and ask Squish {n} questions on us — it reads your diary before it answers.', { n: standing.taste ?? 5 })
              : t('Make a free account and your first {n} AI meal analyses are on us — snap the plate, or just say what you ate.', { n: standing.taste ?? 10 })}
          </p>
          {aboutNutritionist(standing.kind) && <NutritionistPitch compact />}
          <p className="tiny muted">
            {t('An account also keeps a copy of your diary, so a new phone is not a fresh start. Logging by hand, food search and everything else stay free without one.')}
          </p>
          <button type="button" className="btn btn--block" onClick={onCreateAccount}>
            {t('Make a free account')}
          </button>
          <button type="button" className="btn btn--quiet btn--block" onClick={close}>
            {t('Not now')}
          </button>
        </div>
      )}
      {standing && !signUp && offering && <ExitOffer onClose={close} />}
      {standing && !signUp && !offering && (
        <div className="stack paywall">
          <Squish mood={paying ? 'calm' : 'excited'} size={84} />

          {paying ? (
            <>
              <p className="small">
                {USED[standing.kind]()} {comesBack(standing.kind, standing.resets)}
              </p>
              <p className="tiny muted">
                {standing.kind === 'weekplan'
                  ? t('A week of meals is the most Squish plans at once, so {plus} has two a week. Asking about your meals and planning by hand carry on as normal.', { plus: PLUS })
                  : t('{plus} is unlimited for one person’s own eating. The daily ceilings sit far past a real day of meals, to keep Squish fast and affordable for everybody.', { plus: PLUS })}
              </p>
            </>
          ) : (
            <>
              {/*
                An allowance of nought is not an allowance somebody spent —
                they never had one. "You have used your 0 free questions" is
                the sort of sentence that makes an app feel written by nobody.
              */}
              {aboutNutritionist(standing.kind) && <h3 className="paywall-headline">{t('Nutrition help from your own diary')}</h3>}
              <p className="small">
                {standing.allowance === 0 ? COME_WITH[standing.kind]() : THAT_WAS[standing.kind](standing.allowance)}
              </p>

              {aboutNutritionist(standing.kind) && <NutritionistPitch />}

              <ul className="paywall-list">
                <li className="paywall-star">
                  {rich('<b>Ask Squish</b> — unlimited questions about your own diary, and a weekly meal plan with its shopping list', {}, { b: (text) => <b>{text}</b> })}
                </li>
                <li>
                  {rich('<b>Unlimited AI meal analyses</b> — snap the plate, or say or type what you ate', {}, { b: (text) => <b>{text}</b> })}
                </li>
                <li>
                  {rich("<b>Unlimited recipe imports</b> — paste a link, get a portion's nutrition", {}, { b: (text) => <b>{text}</b> })}
                </li>
                <li>
                  {rich('<b>Wild finishes</b> for Squish — rainbow, gold, holographic and more', {}, { b: (text) => <b>{text}</b> })}
                </li>
              </ul>
              {/* Said where "unlimited" is said: the advertising rules ask for both together. */}
              <p className="tiny muted paywall-fair">
                {rich('<b>Fair use:</b> {plus} is for one person’s own eating, with daily ceilings far past a real day — {photos} analyses, {questions} questions and {recipes} recipe imports — and {plans} weekly plans a week. <terms>The terms</terms> say more.', { plus: PLUS, photos: 40, questions: 50, recipes: 10, plans: 2 }, {
                  b: (text) => <b>{text}</b>,
                  terms: (text) => (
                    <a href={legalHref('/terms', 'fair-use')} target="_blank" rel="noopener noreferrer">
                      {text}
                    </a>
                  ),
                })}
              </p>

              <Plans />
              <p className="tiny muted">{t('A year works out at {price} a week — less than a coffee, for nutrition help that has read your diary.', { price: weeklyPrice() })}</p>

              <NotOnSale />
            </>
          )}

          <p className="tiny muted">
            {t('Free for ever, either way: logging by hand, food search, your whole diary, the charts, streaks and export.')}
          </p>

          <p className="tiny muted paywall-legal">
            {rich('<terms>Terms of use</terms> · <privacy>Privacy policy</privacy>', {}, {
              terms: (text) => (
                <a href={legalHref('/terms')} target="_blank" rel="noopener noreferrer">
                  {text}
                </a>
              ),
              privacy: (text) => (
                <a href={legalHref('/privacy')} target="_blank" rel="noopener noreferrer">
                  {text}
                </a>
              ),
            })}
          </p>

          <button type="button" className="btn btn--block" onClick={carryOn}>
            {paying ? t('Right you are') : t('Carry on without it')}
          </button>
        </div>
      )}
    </Sheet>
  );
}

/**
 * The two plans offered: a year, with a few days free first, and a week. A
 * year is the one shown first and marked, because it is the one most people
 * are better off with — about a third of what a year of weeks would come to,
 * and "save" is said against exactly that.
 */
function Plans() {
  const price = currentRegion().price;
  return (
    <div className="paywall-plans">
      <div className="paywall-plan paywall-plan--best">
        <span className="paywall-plan-badge">{t('Best value · save {n}%', { n: yearlySaving() })}</span>
        <b className="paywall-plan-name">{t('Yearly')}</b>
        <span className="paywall-plan-price">{plural(TRIAL_DAYS, { one: '{n} day free, then {price} a year', other: '{n} days free, then {price} a year' }, { price: formatPrice(price.yearly) })}</span>
        <span className="paywall-plan-note">{t('Cancel before the free days end and you pay nothing.')}</span>
      </div>
      <div className="paywall-plan">
        <b className="paywall-plan-name">{t('Weekly')}</b>
        <span className="paywall-plan-price">{t('{price} a week', { price: formatPrice(price.weekly) })}</span>
        <span className="paywall-plan-note">{t('Billed every week. Cancel any time.')}</span>
      </div>
    </div>
  );
}

/**
 * Somebody leaving without a plan: neither a year nor a week suited them, so
 * a month is offered, the first one cheaper. Once, and "No thanks" means it —
 * asking twice is how an app starts to feel like a salesman.
 */
function ExitOffer({ onClose }: { onClose: () => void }) {
  const price = currentRegion().price;
  return (
    <div className="stack paywall">
      <Squish mood="calm" size={84} />
      <p className="small">{t('Not ready for a year, and a week feels too short? Try a month instead.')}</p>
      <div className="paywall-plans">
        <div className="paywall-plan paywall-plan--best">
          <span className="paywall-plan-badge">{t('{n}% off your first month', { n: Math.floor((1 - price.firstMonth / price.monthly) * 100) })}</span>
          <b className="paywall-plan-name">{t('Monthly')}</b>
          <span className="paywall-plan-price">{t('{first} for your first month, then {price} a month', { first: formatPrice(price.firstMonth), price: formatPrice(price.monthly) })}</span>
          <span className="paywall-plan-note">{t('Everything in {plus}. Cancel any time.', { plus: PLUS })}</span>
        </div>
      </div>
      <NotOnSale />
      <button type="button" className="btn btn--quiet btn--block" onClick={onClose}>
        {t('No thanks')}
      </button>
    </div>
  );
}

/*
 * Honest rather than aspirational. There is no way to take money yet —
 * subscriptions have to go through the stores' own billing on a phone, which
 * arrives with the phone app. Pretending otherwise would mean a button that
 * does nothing, which is worse than no button.
 */
function NotOnSale() {
  return (
    <p className="tiny muted paywall-soon">
      {t('Not on sale yet. Squish is being tested, and payment arrives with the phone app — so for now this is here to be told whether it is worth it. If you would pay for this, or would not, please say.')}
    </p>
  );
}
