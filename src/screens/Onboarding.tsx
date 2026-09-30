import { useEffect, useMemo, useRef, useState } from 'react';
import Squish from '../components/Squish';
import Wordmark from '../components/Wordmark';
import { Segmented, Sheet, Stepper, useToast } from '../components/ui';
import { Credentials, Forgot } from '../components/AccountCard';
import { providerSetup, signIn, signUp, type Arrived } from '../lib/account';
import { friendOffer, periodWords, type FriendOffer } from '../lib/friends';
import { planNow } from '../lib/plan';
import { PLUS } from '../lib/subscription';
import { AimFields, EatingFields } from '../components/EatingFields';
import SignInWith, { type SignedInWith } from '../components/SignInWith';
import { HEARD, type Heard } from '../lib/heard';
import { keepCode, referral } from '../lib/referral';
import { noteHeard } from '../lib/api';
import { explainPlan } from '../lib/planExplained';
import { pullDiary } from '../lib/backup';
import { adoptBackup } from '../lib/autobackup';
import { MACRO_COLOR } from '../components/charts';
import { LanguageField, RegionField } from '../components/fields';
import { BirthdayWheel, GoalWeightRuler, HeightWheel, WeightWheel } from '../components/Dials';
import { ageOn, startingBirthDate } from '../lib/birthday';
import { paceTier, targetMessage, type PaceTier } from '../lib/targetMessage';
import { useSquish, DEFAULT_PROFILE, MIN_AGE } from '../store/useSquish';
import TooYoung from '../components/TooYoung';
import { ACTIVITY_LABEL, MACRO_LABEL, computeTargets, waterVolume } from '../lib/nutrition';
import type { Activity, Detail, Goal, Mood, Profile, Sex, Targets } from '../types';
import { PACE_CHOICES, formatPace, formatWeight, imperialLabel, paceIn, paceToKg, retuneForUnits } from '../lib/units';
import { REGIONS, browserRegion, currentEnergyUnit, energyValue, regionOf, toKcal, type Region } from '../lib/region';
import { browserLanguage, languageOf, packFor, type Language } from '../lib/language';
import { startedWith } from '../boot/language';
import { aroundWhen, goalProjection, type GoalProjection } from '../lib/goalDate';
import type { Units } from '../lib/units';
import './onboarding.css';
import { t } from '../lib/i18n';
import { rich } from '../lib/i18n-react';
import { legalHref } from '../lib/legal';

/**
 * The steps, in order. Some are left out for some people (`stepsFor`): the
 * realistic-target moment needs a goal weight to reach, and the last two
 * need a server that keeps accounts.
 *
 * Each question earns its place by changing something: the targets, what the
 * nutritionist and the meal plans suggest, or how the dashboard learns which
 * ways in bring people who stay. Nothing is asked for its own sake.
 */
const ALL_STEPS = ['welcome', 'name', 'about', 'born', 'goal', 'target', 'activity', 'eating', 'aims', 'detail', 'heard', 'building', 'plan', 'account'] as const;
type Step = (typeof ALL_STEPS)[number];

const GOAL_COPY: Record<Goal, { title: string; blurb: string; emoji: string; mood: Mood; say: string }> = {
  lose: { title: t('Lose weight'), blurb: t('A gentle deficit, plenty of protein'), emoji: '🌱', mood: 'proud', say: t('Slow and steady — I’ll cheer every step.') },
  maintain: { title: t('Eat healthy'), blurb: t('Balanced meals, weight stays steady'), emoji: '🥗', mood: 'calm', say: t('Good food, feeling good. Love that.') },
  gain: { title: t('Build up'), blurb: t('A little surplus to grow on'), emoji: '💪', mood: 'cheering', say: t('Let’s build you up!') },
};

/** Just the essentials, or everything (src/components/detail.tsx). Skipped, it is everything. */
const DETAIL_CHOICES: { value: Detail; emoji: string; title: string; example: string }[] = [
  { value: 'essentials', emoji: '🌿', title: t('Just the essentials'), example: t('Calories left, protein and what you ate. The rest is a tap away.') },
  { value: 'everything', emoji: '📊', title: t('Everything'), example: t('Every nutrient, score and chart, all on show.') },
];

/** What each level looks like in a real week, because "moderately active" means something different to everybody. */
const ACTIVITY_COPY: Record<Activity, { emoji: string; example: string; mood: Mood; say: string }> = {
  sedentary: { emoji: '🛋️', example: t('Desk job, not much walking'), mood: 'calm', say: t('No judgement — we start where you are.') },
  light: { emoji: '🚶', example: t('On your feet a bit, or a short walk most days'), mood: 'excited', say: t('A bit of bustle. Nice.') },
  moderate: { emoji: '🚴', example: t('Exercise 3–5 times a week, or an active job'), mood: 'proud', say: t('Look at you go!') },
  active: { emoji: '🏃', example: t('Hard exercise most days, or a physical job'), mood: 'cheering', say: t('Busy bean!') },
  athlete: { emoji: '🏅', example: t('Training hard, often twice a day'), mood: 'cheering', say: t('Champion energy!') },
};

/**
 * How quick a pace is, as an animal: easier to feel than a number. Gaining
 * is slower at every level, because muscle is built slower than fat is lost.
 */
const PACE_TIERS: { tier: PaceTier; emoji: string; label: string }[] = [
  { tier: 'steady', emoji: '🦥', label: t('Steady') },
  { tier: 'brisk', emoji: '🐇', label: t('Brisk') },
  { tier: 'fast', emoji: '🐆', label: t('Fast') },
];

/** The same floors the targets are never set below (lib/nutrition.ts). */
const floorFor = (sex: Sex) => (sex === 'male' ? 1500 : 1200);

/** How long the "building your plan" moment lasts. Short: the sums are instant, this is a breath, not a wait. */
const BUILD_MS = 2600;

const prefersLessMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * First run. `accounts` is whether this Squish keeps anything on the server —
 * where it does, somebody arriving on a new phone can sign in here and get
 * their diary back, rather than being walked through making a profile they
 * already have.
 */
export default function Onboarding({ accounts = false }: { accounts?: boolean }) {
  const completeOnboarding = useSquish((s) => s.completeOnboarding);
  const setProfile = useSquish((s) => s.setProfile);
  const setTargets = useSquish((s) => s.setTargets);
  const [step, setStep] = useState<Step>('welcome');
  // Which way the steps slide: forward from the right, back from the left.
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  // Starts from the browser's guess at their country, and that country's usual units.
  const [draft, setDraft] = useState<Profile>(() => {
    const region = browserRegion();
    // A language already picked on the first screen (which reloads the app to switch) is kept.
    const language = useSquish.getState().profile.language ?? browserLanguage();
    const birthDate = startingBirthDate(DEFAULT_PROFILE.age);
    return retuneForUnits(
      { ...DEFAULT_PROFILE, region, language, birthDate, age: ageOn(birthDate), diet: 'any', avoid: [], aims: [], obstacles: [] },
      REGIONS[region].units,
    );
  });
  // Changes to the suggested targets, made on the plan itself.
  const [tweak, setTweak] = useState<Partial<Targets>>({});
  const [heard, setHeard] = useState<Heard | null>(null);
  const heardSent = useRef(false);
  // A code from a link they followed is already kept; shown here so they can see it, and change it.
  const [code, setCode] = useState(() => referral() ?? '');

  /*
   * The region goes into the store straight away, not only at the end: the
   * weight field and every formatter read it from there, and a field in
   * pounds for somebody in Ohio has to be in pounds while they type into it.
   */
  useEffect(() => {
    setProfile({ region: draft.region, energy: undefined });
  }, [draft.region, setProfile]);

  // The language too, so anything the AI writes before setup ends is already in it.
  useEffect(() => {
    setProfile({ language: draft.language });
  }, [draft.language, setProfile]);

  /*
   * Changing the language starts the app again in it: the words are loaded
   * before anything is drawn (see main.tsx). It is offered on the first
   * screen, before anything has been typed that a reload would lose.
   */
  const switchLanguage = (language: Language) => {
    setProfile({ language });
    location.reload();
  };

  const moveTo = (region: Region) =>
    setDraft((d) => retuneForUnits({ ...d, region, energy: undefined }, REGIONS[region].units));
  const [signing, setSigning] = useState<'in' | 'forgot' | null>(null);
  // Signed in from the welcome screen already: nothing to make at the end.
  const [signedIn, setSignedIn] = useState(false);
  // Came by a friend's invite: the account step says what it gets them.
  const [offer, setOffer] = useState<FriendOffer | null>(null);
  useEffect(() => {
    if (!accounts) return;
    // Asked now, so the last step knows at once whether Apple and Google are offered.
    void providerSetup();
    let live = true;
    void friendOffer().then((found) => live && setOffer(found));
    return () => {
      live = false;
    };
  }, [accounts]);
  // Somebody who has said they are under 18. Held here only, never saved.
  const [tooYoung, setTooYoung] = useState(false);
  const toast = useToast();

  const projection = goalProjection(draft);
  const STEPS: readonly Step[] = ALL_STEPS.filter((s) => {
    if (s === 'target') return draft.goal !== 'maintain' && projection?.kind === 'date';
    if (s === 'heard') return accounts;
    if (s === 'account') return accounts && !signedIn;
    return true;
  });
  const index = STEPS.indexOf(step);
  const suggested = useMemo(() => computeTargets(draft), [draft]);
  const targets: Targets = { ...suggested, ...tweak };
  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));
  const go = (to: Step, way: 'fwd' | 'back') => {
    setDir(way);
    setStep(to);
  };
  const next = () => {
    // Under 18 stops here, with the reason, as the typed age used to.
    if (step === 'born' && draft.age < MIN_AGE) {
      setTooYoung(true);
      return;
    }
    go(STEPS[Math.min(STEPS.length - 1, index + 1)], 'fwd');
  };
  const back = () => {
    // The building moment is on the way in only.
    let to = Math.max(0, index - 1);
    if (STEPS[to] === 'building') to = Math.max(0, to - 1);
    go(STEPS[to], 'back');
  };
  const name = draft.name.trim();

  // The plan builds itself, then shows itself.
  useEffect(() => {
    if (step !== 'building') return;
    const timer = window.setTimeout(() => go('plan', 'fwd'), prefersLessMotion() ? 700 : BUILD_MS);
    return () => window.clearTimeout(timer);
  }, [step]);

  const finish = () => {
    completeOnboarding(draft);
    // Their own changes to the plan, on top of what was suggested.
    if (Object.keys(tweak).length) setTargets(tweak);
    // English, into or out of the US: American or British spelling is loaded at start.
    if (packFor(languageOf(draft), regionOf(draft)) !== startedWith()) location.reload();
  };

  /** Leaving the "how did you hear" step: the answer counted once, and a typed code kept for the sign-up. */
  const leaveHeard = () => {
    const typed = code.trim();
    if (typed && typed.toUpperCase() !== referral() && !keepCode(typed)) {
      toast(t('That code does not look right. Check it, or leave it empty.'), '🤔');
      return;
    }
    if (heard && !heardSent.current) {
      heardSent.current = true;
      void noteHeard(heard);
    }
    next();
  };

  /**
   * Signed in: bring the account's diary onto this device. With a profile in
   * it, that is the whole of onboarding — the app opens on their diary. With
   * none (an account made but never used), they are signed in and carry on
   * setting up, and the backup starts from what they make here.
   */
  const arrived = async (who: Arrived) => {
    setSigning(null);
    setSignedIn(true);
    const found = await pullDiary();
    const profile = (found?.state as { profile?: Partial<Profile> } | null)?.profile;
    if (found && profile?.onboarded) {
      adoptBackup(found);
      toast(profile.name ? t('Welcome back, {name}. Your diary is here.', { name: profile.name }) : t('Welcome back. Your diary is here.'), '🫧');
      return;
    }
    // Signed in at the end, having just set up: what they made here is the account's diary now.
    if (step === 'account') {
      finish();
      toast(who.email ? t('Signed in as {email}.', { email: who.email }) : t('Signed in.'), '🫧');
      return;
    }
    toast(
      who.email
        ? t("Signed in as {email}. There is no diary saved yet, so let's set one up.", { email: who.email })
        : t("Signed in. There is no diary saved yet, so let's set one up."),
      '🫧',
    );
    setStep('name');
  };

  /** Account made at the end of setting up: straight into the app, told what it got them. */
  const madeAccount = (made: Arrived) => {
    finish();
    const taste = planNow().plan === 'free' ? planNow().left.photo : 0;
    const fromCode =
      made.code?.kind === 'plus'
        ? t('Your code added {n} days of {plus}.', { n: made.code.days, plus: PLUS })
        : made.code?.kind === 'unknown'
          ? t('That code was not one we know. You can try another on the You screen.')
          : made.code
            ? t('Code applied.')
            : '';
    toast(
      [
        t('Account made.'),
        taste > 0 ? t('Your {n} free AI analyses are ready.', { n: taste }) : '',
        fromCode,
        made.verificationSent ? t('Check your email to confirm the address.') : '',
      ]
        .filter(Boolean)
        .join(' '),
      '🫧',
    );
  };

  /**
   * In with Google or Apple. A new account at the end of setting up is made
   * as the email form makes one; anything else — an account they already
   * had, or signing in from the welcome screen — is arriving.
   */
  const enteredWith = (who: SignedInWith) => {
    if (who.created && step === 'account') madeAccount(who);
    else void arrived(who);
  };

  if (tooYoung)
    return (
      <div className="app onboarding">
        <div className="screen">
          <TooYoung onBack={() => setTooYoung(false)} />
        </div>
      </div>
    );

  const tier = paceTier(draft.pace, draft.goal);
  const energyUnit = currentEnergyUnit();
  const floor = floorFor(draft.sex);
  const explained = explainPlan(draft, targets);
  const chosenAims = (draft.aims?.length ?? 0) + (draft.obstacles?.length ?? 0);

  return (
    <div className="app onboarding">
      <div className="screen">
        <div className="onboard-progress" aria-hidden="true">
          <span style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
        </div>

        <div key={step} className={`onboard-step onboard-step--${dir}`}>
          {step === 'welcome' && (
            <div className="onboard-hero">
              <div className="onboard-hello">
                <Squish mood="excited" size={165} heart className="onboard-hello-squish" />
                <p className="bubble bubble--below" aria-hidden="true">
                  {t('Hi! I’m Squish.')}
                </p>
              </div>
              <h1 className="onboard-logo">
                <Wordmark width={230} />
              </h1>
              <p className="onboard-tag">{t('Your little health buddy.')}</p>
              <p className="muted center onboard-intro" style={{ maxWidth: 300, margin: '10px auto 0' }}>
                {t('Snap your meal, get instant nutrition insights, and build habits that feel kind. Small steps, big progress.')}
              </p>
              <div className="onboard-features">
                {[
                  { emoji: '📸', label: t('Snap your meal') },
                  { emoji: '📊', label: t('Get instant insights') },
                  { emoji: '💖', label: t('Build healthier habits') },
                  { emoji: '⭐', label: t('Cheer together') },
                ].map((f, i) => (
                  <div key={f.label} className="onboard-feature" style={{ animationDelay: `${0.15 + i * 0.08}s` }}>
                    <span aria-hidden="true">{f.emoji}</span>
                    {f.label}
                  </div>
                ))}
              </div>
              <div className="onboard-language">
                <LanguageField value={languageOf(draft)} onChange={switchLanguage} />
              </div>
            </div>
          )}

          {step === 'name' && (
            <div className="stack">
              <Buddy mood={name ? 'cheering' : 'excited'} say={name ? t('Lovely to meet you, {name}!', { name }) : t('Let’s be friends.')}>
                <h1>{t('First things first — what shall I call you?')}</h1>
              </Buddy>
              <div className="field">
                <label htmlFor="name" className="visually-hidden">
                  {t('Your name')}
                </label>
                <input
                  id="name"
                  className="input onboard-name"
                  value={draft.name}
                  placeholder={t('Your name')}
                  autoComplete="given-name"
                  autoFocus
                  maxLength={40}
                  onChange={(e) => set({ name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') next();
                  }}
                />
                <p className="tiny muted">{t('Just a first name, or whatever you like being called. You can skip this.')}</p>
              </div>
            </div>
          )}

          {step === 'about' && (
            <div className="stack">
              <Buddy mood="thinking" say={t('Only used to work out your targets — nothing else.')}>
                <h1>{name ? t('A bit about you, {name}', { name }) : t('A bit about you')}</h1>
              </Buddy>

              <div className="field">
                <label>{t('Sex assigned at birth (for the energy formula)')}</label>
                <Segmented<Sex>
                  value={draft.sex}
                  onChange={(sex) => set({ sex })}
                  options={[
                    { value: 'female', label: t('Female') },
                    { value: 'male', label: t('Male') },
                    { value: 'other', label: t('Rather not') },
                  ]}
                />
              </div>

              <RegionField value={draft.region ?? 'GB'} onChange={moveTo} hint={t('For your prices, food names and the way labels are read there.')} />

              <div className="field">
                <label>{t('Units')}</label>
                <Segmented<Units>
                  value={draft.units}
                  onChange={(units) => setDraft((d) => retuneForUnits(d, units))}
                  options={[
                    { value: 'metric', label: 'cm / kg' },
                    { value: 'imperial', label: imperialLabel() },
                  ]}
                />
              </div>

              <div className="dial-pair">
                <HeightWheel cm={draft.heightCm} units={draft.units} onChange={(heightCm) => set({ heightCm })} />
                <WeightWheel label={t('Weight')} kg={draft.weightKg} units={draft.units} onChange={(weightKg) => set({ weightKg })} />
              </div>
            </div>
          )}

          {step === 'born' && (
            <div className="stack">
              <Buddy mood="calm" say={t('Your age changes what your body burns, so I keep it up to date for you.')}>
                <h1>{t('When were you born?')}</h1>
              </Buddy>
              <BirthdayWheel
                birthDate={draft.birthDate ?? startingBirthDate(draft.age)}
                onChange={(birthDate) => set({ birthDate, age: ageOn(birthDate) })}
              />
            </div>
          )}

          {step === 'goal' && (
            <div className="stack">
              <Buddy mood={GOAL_COPY[draft.goal].mood} say={GOAL_COPY[draft.goal].say}>
                <h1>{t('What are we aiming for?')}</h1>
              </Buddy>

              {/* Three tiles in a row, so the goal, its weight and its pace fit on one screen. */}
              <div className="goal-tiles">
                {(Object.keys(GOAL_COPY) as Goal[]).map((goal) => (
                  <button
                    key={goal}
                    type="button"
                    className={`goal-tile ${draft.goal === goal ? 'is-on' : ''}`}
                    onClick={() => set({ goal })}
                    aria-pressed={draft.goal === goal}
                    aria-describedby={draft.goal === goal ? 'goal-blurb' : undefined}
                  >
                    <span className="goal-tile-emoji" aria-hidden="true">
                      {GOAL_COPY[goal].emoji}
                    </span>
                    <b>{GOAL_COPY[goal].title}</b>
                  </button>
                ))}
              </div>
              <p className="tiny muted center goal-blurb" id="goal-blurb">
                {GOAL_COPY[draft.goal].blurb}
              </p>

              {draft.goal !== 'maintain' && (
                <>
                  <GoalWeightRuler
                    kg={draft.targetWeightKg}
                    fromKg={draft.weightKg}
                    units={draft.units}
                    goal={draft.goal === 'gain' ? 'gain' : 'lose'}
                    onChange={(targetWeightKg) => set({ targetWeightKg })}
                  />
                  <div className="field">
                    <label htmlFor="pace">{t('Pace — {pace} per week', { pace: formatPace(draft.pace, draft.units) })}</label>
                    <div className="pace-tiers" aria-hidden="true">
                      {PACE_TIERS.map((p) => (
                        <span key={p.tier} className={p.tier === tier ? 'is-on' : ''}>
                          <span className="pace-emoji">{p.emoji}</span>
                          {p.label}
                        </span>
                      ))}
                    </div>
                    <input
                      id="pace"
                      type="range"
                      min={PACE_CHOICES[draft.units].min}
                      max={PACE_CHOICES[draft.units].max}
                      step={PACE_CHOICES[draft.units].step}
                      value={paceIn(draft.pace, draft.units)}
                      aria-valuetext={`${formatPace(draft.pace, draft.units)} — ${PACE_TIERS.find((p) => p.tier === tier)?.label ?? ''}`}
                      onChange={(e) => set({ pace: paceToKg(Number(e.target.value), draft.units) })}
                    />
                    {tier === 'fast' ? (
                      <p className="onboard-when onboard-when--check small" aria-live="polite">
                        {draft.goal === 'gain'
                          ? t('That is quick. Much faster than this mostly adds fat rather than muscle.')
                          : t('That is quick. Faster is harder to keep up and more likely to cost muscle — most people do better a notch slower.')}
                      </p>
                    ) : null}
                  </div>
                  <GoalNote projection={projection} target={formatWeight(draft.targetWeightKg, draft.units)} onSwitch={(goal) => set({ goal })} />
                </>
              )}
            </div>
          )}

          {step === 'target' && projection?.kind === 'date' && (
            <TargetMoment profile={draft} weeks={projection.weeks} date={projection.date} />
          )}

          {step === 'activity' && (
            <div className="stack">
              <Buddy mood={ACTIVITY_COPY[draft.activity].mood} say={ACTIVITY_COPY[draft.activity].say}>
                <h1>{t('How active is a normal day?')}</h1>
              </Buddy>
              {(Object.keys(ACTIVITY_LABEL) as Activity[]).map((activity) => (
                <button
                  key={activity}
                  type="button"
                  className={`choice ${draft.activity === activity ? 'is-on' : ''}`}
                  onClick={() => set({ activity })}
                  aria-pressed={draft.activity === activity}
                >
                  <span className="choice-emoji" aria-hidden="true">
                    {ACTIVITY_COPY[activity].emoji}
                  </span>
                  <span>
                    <b>{ACTIVITY_LABEL[activity]}</b>
                    <span className="muted small"> {ACTIVITY_COPY[activity].example}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 'eating' && (
            <div className="stack">
              <Buddy mood="thinking" say={t('So I never suggest something you can’t eat.')}>
                <h1>{t('How do you eat?')}</h1>
              </Buddy>
              <EatingFields value={draft} onChange={set} />
              <p className="tiny muted">{t('Meal plans and the nutritionist go by this. Change it any time on You.')}</p>
            </div>
          )}

          {step === 'aims' && (
            <div className="stack">
              <Buddy mood={chosenAims ? 'cheering' : 'excited'} say={chosenAims ? t('Got it. I’ll help with that.') : t('Pick as many as you like.')}>
                <h1>{t('What are you hoping for?')}</h1>
              </Buddy>
              <AimFields value={draft} onChange={set} />
            </div>
          )}

          {step === 'detail' && (
            <div className="stack">
              <Buddy mood={draft.detail === 'essentials' ? 'calm' : draft.detail ? 'excited' : 'thinking'} say={draft.detail ? t('Change it any time on You.') : t('Pick one — you can change it later.')}>
                <h1>{t('How much detail do you want?')}</h1>
              </Buddy>
              {DETAIL_CHOICES.map((choice) => (
                <button
                  key={choice.value}
                  type="button"
                  className={`choice ${draft.detail === choice.value ? 'is-on' : ''}`}
                  onClick={() => set({ detail: choice.value })}
                  aria-pressed={draft.detail === choice.value}
                >
                  <span className="choice-emoji" aria-hidden="true">
                    {choice.emoji}
                  </span>
                  <span>
                    <b>{choice.title}</b>
                    <span className="muted small"> {choice.example}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {step === 'heard' && (
            <div className="stack">
              <Buddy mood="calm" say={t('Last question, promise.')}>
                <h1>{t('How did you hear about Squish?')}</h1>
              </Buddy>
              <div className="eat-chips" role="radiogroup" aria-label={t('How did you hear about Squish?')}>
                {HEARD.map((h) => (
                  <button
                    key={h.key}
                    type="button"
                    role="radio"
                    className={`chip ${heard === h.key ? 'chip--on' : ''}`}
                    aria-checked={heard === h.key}
                    onClick={() => setHeard(heard === h.key ? null : h.key)}
                  >
                    <span aria-hidden="true">{h.emoji}</span>
                    {h.label}
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="onboard-code">{t('Got a code?')}</label>
                <input
                  id="onboard-code"
                  className="input onboard-code"
                  value={code}
                  placeholder={t('From a friend or a partner')}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={24}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                />
                <p className="tiny muted">{t('It is used when you make your account.')}</p>
              </div>
            </div>
          )}

          {step === 'building' && <Building restricted={Boolean((draft.diet && draft.diet !== 'any') || draft.avoid?.length)} />}

          {step === 'plan' && (
            <div className="stack">
              <Confetti />
              <div className="center">
                <div className="onboard-plan-squish"><Squish mood="cheering" size={110} /></div>
                <h1 style={{ marginTop: 6 }}>{name ? t('Here’s your plan, {name}!', { name }) : t('Here’s your plan!')}</h1>
                <p className="muted small">{t('Built from your height, weight, age and activity. Tap − or + to change anything.')}</p>
              </div>

              <div className="card onboard-plan">
                <div className="row-between onboard-plan-energy">
                  <span className="muted small">{t('Daily energy')}</span>
                  <b style={{ fontSize: 28 }}>
                    <CountUp value={energyValue(targets.calories)} /> {energyUnit}
                  </b>
                </div>
                <div className="row-between onboard-plan-adjust">
                  <span className="tiny muted">{tweak.calories !== undefined ? t('Changed by you') : t('Suggested')}</span>
                  {energyUnit === 'kJ' ? (
                    <Stepper
                      value={energyValue(targets.calories, 'kJ')}
                      step={200}
                      min={energyValue(floor, 'kJ')}
                      max={20900}
                      onChange={(kj) => setTweak((w) => ({ ...w, calories: Math.max(floor, toKcal(kj, 'kJ')) }))}
                      suffix="kJ"
                    />
                  ) : (
                    <Stepper value={targets.calories} step={50} min={floor} max={5000} onChange={(calories) => setTweak((w) => ({ ...w, calories }))} />
                  )}
                </div>
                <div className="row-between onboard-plan-adjust">
                  <span className="small row" style={{ gap: 8 }}>
                    <span className="macro-dot" style={{ background: MACRO_COLOR.protein }} aria-hidden="true" />
                    {MACRO_LABEL.protein}
                  </span>
                  <Stepper value={targets.protein} step={5} min={30} max={300} onChange={(protein) => setTweak((w) => ({ ...w, protein }))} suffix="g" />
                </div>
                {/* The rest as figures, not empty progress bars: nothing is eaten yet, and it keeps the plan on one screen. */}
                <div className="onboard-macros">
                  {(['carbs', 'fat', 'fibre'] as const).map((key) => (
                    <div key={key}>
                      <span className="tiny muted row" style={{ gap: 6 }}>
                        <span className="macro-dot" style={{ background: MACRO_COLOR[key] }} aria-hidden="true" />
                        {MACRO_LABEL[key]}
                      </span>
                      <b>{Math.round(targets[key])} g</b>
                    </div>
                  ))}
                </div>
                <div className="divider" />
                <div className="row" style={{ gap: 16 }}>
                  <span className="small muted">💧 {t('{n} glasses ({volume})', { n: targets.water, volume: waterVolume(targets.water) })}</span>
                  <span className="small muted">👟 {t('{n} steps', { n: targets.steps })}</span>
                </div>
                {Object.keys(tweak).length > 0 && (
                  <button type="button" className="btn--quiet small" style={{ marginTop: 8 }} onClick={() => setTweak({})}>
                    {t('Back to the suggested plan')}
                  </button>
                )}
              </div>
              {projection?.kind === 'date' && (
                <p className="onboard-when small center">
                  {rich('🎯 At this pace, around <b>{when}</b> you could be at <b>{weight}</b>.', {
                    when: aroundWhen(projection.date),
                    weight: formatWeight(draft.targetWeightKg, draft.units),
                  }, { b: (text) => <b>{text}</b> })}
                </p>
              )}
              <details className="plan-how onboard-how">
                <summary className="small">{t('How we worked this out')}</summary>
                <p className="tiny">{explained.summary}</p>
                <dl>
                  {explained.how.map((line) => (
                    <div key={line.label}>
                      <dt className="tiny">{line.label}</dt>
                      <dd className="tiny muted">{line.words}</dd>
                    </div>
                  ))}
                </dl>
                <p className="tiny muted">
                  {t('Sources: the Mifflin–St Jeor equation (1990) for what your body burns, and the WHO, the UK’s SACN and the US Dietary Guidelines for fibre, fat, sugar and salt. Squish never suggests less than {floor} a day.', {
                    floor: `${energyValue(floor).toLocaleString()} ${energyUnit}`,
                  })}
                </p>
              </details>
            </div>
          )}

          {step === 'account' && (
            <div className="stack">
              <Buddy mood="excited" say={t('Then I can keep your diary safe.')}>
                <h1>{name ? t('Save your plan, {name}', { name }) : t('Save your plan')}</h1>
              </Buddy>
              <ul className="onboard-perks">
                <li>
                  <span aria-hidden="true">📸</span> {t('Unlocks your free AI meal analyses')}
                </li>
                <li>
                  <span aria-hidden="true">📱</span> {t('A new phone is a sign-in, not a fresh start')}
                </li>
                <li>
                  <span aria-hidden="true">🛟</span> {t('Your diary back if this phone is lost')}
                </li>
              </ul>
              {offer && (
                <p className="small account-offer">
                  {t('🎁 A friend invited you: make an account, use Squish on {days} different days, and you both get {period} of Squish Plus.', {
                    days: offer.qualifyDays,
                    period: periodWords(offer.rewardDays),
                  })}
                </p>
              )}
              <SignInWith
                onDone={enteredWith}
                onTrouble={(message) => toast(message, '⚠️')}
                email={
                  <Credentials
                    submit={t('Create account')}
                    hint={t('Four words you will remember beats one word with a number on the end.')}
                    onSubmit={signUp}
                    onDone={madeAccount}
                  />
                }
              />
              <div className="account-form-footer">
                <button type="button" className="linkish tiny" onClick={() => setSigning('in')}>
                  {t('I already have an account')}
                </button>
              </div>
              <p className="tiny muted center">
                {rich('By making an account you agree to our <terms>terms of use</terms>. How we look after your data is in the <privacy>privacy policy</privacy>.', {}, {
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
            </div>
          )}
        </div>

        {step !== 'building' && (
          <div className="onboard-foot">
          <div className="onboard-actions">
            {index > 0 && (
              <button type="button" className="btn btn--ghost" onClick={back}>
                {t('Back')}
              </button>
            )}
            {step === 'account' ? (
              // The form above is the way on; this is the way round it.
              <button type="button" className="btn btn--quiet grow" onClick={finish}>
                {t('Not now')}
              </button>
            ) : step === STEPS[STEPS.length - 1] ? (
              <button type="button" className="btn grow" onClick={finish}>
                {t("Let's go")}
              </button>
            ) : step === 'heard' ? (
              <button type="button" className="btn grow" onClick={leaveHeard}>
                {heard || code.trim() ? t('Continue') : t('Skip')}
              </button>
            ) : (
              <button type="button" className="btn grow" onClick={next}>
                {step === 'welcome'
                  ? t('Get started')
                  : (step === 'name' && !name) || (step === 'aims' && !chosenAims) || (step === 'detail' && !draft.detail)
                    ? t('Skip')
                    : step === 'target'
                      ? t('Sounds good')
                      : t('Continue')}
              </button>
            )}
          </div>
          {step === 'welcome' && accounts && (
            <button type="button" className="btn btn--quiet onboard-signin" onClick={() => setSigning('in')}>
              {t('I already have an account')}
            </button>
          )}
          </div>
        )}

        <Sheet
          open={signing !== null}
          onClose={() => setSigning(null)}
          title={signing === 'forgot' ? t('Forgotten password') : t('Sign in')}
        >
          {signing === 'in' && <SignInWith onDone={enteredWith} onTrouble={(message) => toast(message, '⚠️')} />}
          {signing === 'in' && (
            <Credentials
              submit={t('Sign in')}
              onSubmit={signIn}
              onDone={(who) => void arrived(who)}
              footer={
                <button type="button" className="linkish tiny" onClick={() => setSigning('forgot')}>
                  {t('I have forgotten my password')}
                </button>
              }
            />
          )}
          {signing === 'forgot' && (
            <Forgot
              onDone={() => {
                setSigning(null);
                toast(t('If that address has an account, a link is on its way.'), '📮');
              }}
            />
          )}
        </Sheet>
      </div>
    </div>
  );
}

/**
 * After the goal weight: how much, how long, and a line showing the way.
 * What it says depends on what they chose (lib/targetMessage.ts): a small
 * goal, a big one, a rushed one, or one below a healthy weight each hear
 * something different, and honest.
 */
function TargetMoment({ profile, weeks, date }: { profile: Profile; weeks: number; date: Date }) {
  const say = targetMessage(profile, weeks, date);
  return (
    <div className="stack onboard-target">
      <div className="center">
        <Squish mood={say.mood} size={120} key={say.mood} />
        <h1 style={{ marginTop: 6 }}>{say.headline}</h1>
        <p className="muted">{say.detail}</p>
      </div>
      <WeightPath from={formatWeight(profile.weightKg, profile.units)} to={formatWeight(profile.targetWeightKg, profile.units)} when={aroundWhen(date)} down={profile.goal === 'lose'} />
      <p className="small center">{say.footer}</p>
    </div>
  );
}

/** A line from now to the goal, easing off as it nears it — the way a real one tends to. Decoration with words. */
function WeightPath({ from, to, when, down }: { from: string; to: string; when: string; down: boolean }) {
  const [y0, y1] = down ? [22, 88] : [88, 22];
  const path = `M 20 ${y0} C 110 ${y0 + (y1 - y0) * 0.75}, 200 ${y1}, 300 ${y1}`;
  return (
    <figure className="weight-path">
      <svg viewBox="0 0 320 110" role="img" aria-label={t('From {from} now to {to} around {when}', { from, to, when })}>
        <line x1="20" y1="100" x2="300" y2="100" className="weight-path-base" />
        <path d={path} className="weight-path-line" pathLength={1} />
        <circle cx="20" cy={y0} r="6" className="weight-path-dot" />
        <circle cx="300" cy={y1} r="8" className="weight-path-goal" />
      </svg>
      <figcaption className="row-between tiny">
        <span>
          <b>{from}</b> · {t('Now')}
        </span>
        <span>
          <b>{to}</b> · {when}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * A breath before the plan: the things it is working out, ticked off. The
 * sums take no time at all, so this is short — long enough to feel made for
 * them, never a fake wait.
 */
function Building({ restricted }: { restricted: boolean }) {
  const items = [
    t('Working out what your body burns'),
    t('Setting your daily energy'),
    t('Balancing protein, carbs and fat'),
    t('Adding fibre and water'),
    ...(restricted ? [t('Noting what you never eat')] : []),
  ];
  return (
    <div className="stack onboard-building" role="status">
      <div className="center">
        <Squish mood="thinking" size={130} />
        <h1 style={{ marginTop: 6 }}>{t('Building your plan…')}</h1>
      </div>
      <div className="onboard-building-bar" aria-hidden="true">
        <span />
      </div>
      <ul className="onboard-building-list">
        {items.map((item, i) => (
          <li key={item} style={{ animationDelay: `${0.2 + i * (2 / items.length)}s` }}>
            <span className="onboard-tick" aria-hidden="true">
              ✓
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Squish, saying something — the step's question, with a reaction that changes as they answer. */
function Buddy({ mood, say, children }: { mood: Mood; say: string; children: React.ReactNode }) {
  return (
    <div className="buddy">
      <Squish mood={mood} size={92} bob={false} className="buddy-squish" key={mood} />
      <div className="buddy-words">
        {children}
        {/* Keyed on the words, so each new reaction pops in rather than silently swapping. */}
        <p className="bubble" key={say} aria-live="polite">
          {say}
        </p>
      </div>
    </div>
  );
}

/** Where the goal weight and pace lead — or a kind word if they point opposite ways. */
function GoalNote({
  projection,
  target,
  onSwitch,
}: {
  projection: GoalProjection;
  target: string;
  onSwitch: (goal: Goal) => void;
}) {
  if (!projection) return null;
  if (projection.kind === 'there') return <p className="onboard-when small">{t('🎉 You’re there already — maybe “Eat healthy”?')}</p>;
  if (projection.kind === 'mismatch')
    return (
      <div className="onboard-when onboard-when--check small">
        <span>
          {projection.suggest === 'gain'
            ? t('That goal is above your weight now. Did you mean to build up?')
            : t('That goal is below your weight now. Did you mean to lose weight?')}
        </span>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => onSwitch(projection.suggest)}>
          {projection.suggest === 'gain' ? t('Build up instead') : t('Lose weight instead')}
        </button>
      </div>
    );
  return (
    <p className="onboard-when small" aria-live="polite">
      {rich('🎯 You’d reach <b>{target}</b> around <b>{when}</b>.', { target, when: aroundWhen(projection.date) }, { b: (text) => <b>{text}</b> })}
    </p>
  );
}

/** The day's calories counting up to their number, once. Straight to it for anybody who has asked for less motion. */
function CountUp({ value }: { value: number }) {
  const still = useMemo(() => prefersLessMotion(), []);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (still) return;
    let frame = 0;
    // A beat first, while the card settles and the confetti starts, then a
    // count slow enough to watch, easing into the final number.
    const WAIT_MS = 800;
    const COUNT_MS = 2400;
    const started = performance.now() + WAIT_MS;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - started) / COUNT_MS));
      // Eased in and out, so the digits turn at a pace you can watch all the way, not all at once and then a crawl.
      setShown(Math.round(value * (0.5 - Math.cos(Math.PI * t) / 2)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, still]);
  return <>{(still ? value : shown).toLocaleString()}</>;
}

const CONFETTI_COLOURS = ['var(--brand)', 'var(--pink)', 'var(--peach)', 'var(--mint)', 'var(--yellow)'];

/** A little burst for finishing setup. Decoration only: hidden from screen readers, and absent with reduced motion. */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: `${(i * 37) % 100}%`,
        colour: CONFETTI_COLOURS[i % CONFETTI_COLOURS.length],
        delay: `${(i % 7) * 0.1}s`,
        drift: `${((i * 53) % 120) - 60}px`,
        spin: `${((i * 71) % 540) - 270}deg`,
        round: i % 3 === 0,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          className={p.round ? 'confetti-round' : undefined}
          style={{ left: p.left, background: p.colour, animationDelay: p.delay, ['--drift' as string]: p.drift, ['--spin' as string]: p.spin }}
        />
      ))}
    </div>
  );
}
