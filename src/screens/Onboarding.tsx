import { useEffect, useMemo, useState } from 'react';
import Squish from '../components/Squish';
import Wordmark from '../components/Wordmark';
import { Segmented, Sheet, useToast } from '../components/ui';
import { Credentials, Forgot } from '../components/AccountCard';
import { signIn, type Arrived } from '../lib/account';
import { pullDiary } from '../lib/backup';
import { adoptBackup } from '../lib/autobackup';
import { MacroBars } from '../components/charts';
import { HeightField, NumberField, RegionField, WeightField } from '../components/fields';
import { useSquish, DEFAULT_PROFILE, MIN_AGE } from '../store/useSquish';
import TooYoung from '../components/TooYoung';
import { ACTIVITY_LABEL, computeTargets, waterVolume } from '../lib/nutrition';
import type { Activity, Goal, Mood, Profile, Sex } from '../types';
import { PACE_CHOICES, formatPace, formatWeight, imperialLabel, paceIn, paceToKg, retuneForUnits } from '../lib/units';
import { REGIONS, browserRegion, currentEnergyUnit, energyValue, type Region } from '../lib/region';
import { aroundWhen, goalProjection, type GoalProjection } from '../lib/goalDate';
import type { Units } from '../lib/units';
import './onboarding.css';

const STEPS = ['welcome', 'name', 'about', 'goal', 'activity', 'plan'] as const;
type Step = (typeof STEPS)[number];

const GOAL_COPY: Record<Goal, { title: string; blurb: string; emoji: string; mood: Mood; say: string }> = {
  lose: { title: 'Lose weight', blurb: 'A gentle deficit, plenty of protein', emoji: '🌱', mood: 'proud', say: 'Slow and steady — I’ll cheer every step.' },
  maintain: { title: 'Eat healthy', blurb: 'Balanced meals, weight stays steady', emoji: '🥗', mood: 'calm', say: 'Good food, feeling good. Love that.' },
  gain: { title: 'Build up', blurb: 'A little surplus to grow on', emoji: '💪', mood: 'cheering', say: 'Let’s build you up!' },
};

/** What each level looks like in a real week, because "moderately active" means something different to everybody. */
const ACTIVITY_COPY: Record<Activity, { emoji: string; example: string; mood: Mood; say: string }> = {
  sedentary: { emoji: '🛋️', example: 'Desk job, not much walking', mood: 'calm', say: 'No judgement — we start where you are.' },
  light: { emoji: '🚶', example: 'On your feet a bit, or a short walk most days', mood: 'excited', say: 'A bit of bustle. Nice.' },
  moderate: { emoji: '🚴', example: 'Exercise 3–5 times a week, or an active job', mood: 'proud', say: 'Look at you go!' },
  active: { emoji: '🏃', example: 'Hard exercise most days, or a physical job', mood: 'cheering', say: 'Busy bean!' },
  athlete: { emoji: '🏅', example: 'Training hard, often twice a day', mood: 'cheering', say: 'Champion energy!' },
};

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
  const [step, setStep] = useState<Step>('welcome');
  // Which way the steps slide: forward from the right, back from the left.
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  // Starts from the browser's guess at their country, and that country's usual units.
  const [draft, setDraft] = useState<Profile>(() => {
    const region = browserRegion();
    return retuneForUnits({ ...DEFAULT_PROFILE, region }, REGIONS[region].units);
  });

  /*
   * The region goes into the store straight away, not only at the end: the
   * weight field and every formatter read it from there, and a field in
   * pounds for somebody in Ohio has to be in pounds while they type into it.
   */
  useEffect(() => {
    setProfile({ region: draft.region, energy: undefined });
  }, [draft.region, setProfile]);

  const moveTo = (region: Region) =>
    setDraft((d) => retuneForUnits({ ...d, region, energy: undefined }, REGIONS[region].units));
  const [signing, setSigning] = useState<'in' | 'forgot' | null>(null);
  // Somebody who has said they are under 18. Held here only, never saved.
  const [tooYoung, setTooYoung] = useState(false);
  const toast = useToast();

  /**
   * Signed in: bring the account's diary onto this device. With a profile in
   * it, that is the whole of onboarding — the app opens on their diary. With
   * none (an account made but never used), they are signed in and carry on
   * setting up, and the backup starts from what they make here.
   */
  const arrived = async (who: Arrived) => {
    setSigning(null);
    const found = await pullDiary();
    const profile = (found?.state as { profile?: Partial<Profile> } | null)?.profile;
    if (found && profile?.onboarded) {
      adoptBackup(found);
      toast(`Welcome back${profile.name ? `, ${profile.name}` : ''}. Your diary is here.`, '🫧');
      return;
    }
    toast(`Signed in as ${who.email ?? 'you'}. There is no diary saved yet, so let's set one up.`, '🫧');
    setStep('name');
  };

  const index = STEPS.indexOf(step);
  const targets = useMemo(() => computeTargets(draft), [draft]);
  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));
  const next = () => {
    setDir('fwd');
    setStep(STEPS[Math.min(STEPS.length - 1, index + 1)]);
  };
  const back = () => {
    setDir('back');
    setStep(STEPS[Math.max(0, index - 1)]);
  };
  const projection = goalProjection(draft);
  const name = draft.name.trim();

  if (tooYoung)
    return (
      <div className="app onboarding">
        <div className="screen">
          <TooYoung onBack={() => setTooYoung(false)} />
        </div>
      </div>
    );

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
                <Squish mood="excited" size={190} heart />
                <p className="bubble bubble--below" aria-hidden="true">
                  Hi! I’m Squish.
                </p>
              </div>
              <h1 className="onboard-logo">
                <Wordmark width={230} />
              </h1>
              <p className="onboard-tag">Your little health buddy.</p>
              <p className="muted center" style={{ maxWidth: 300, margin: '10px auto 0' }}>
                Snap your meal, get instant nutrition insights, and build habits that feel kind. Small steps, big progress.
              </p>
              <div className="onboard-features">
                {[
                  { emoji: '📸', label: 'Snap your meal' },
                  { emoji: '📊', label: 'Get instant insights' },
                  { emoji: '💖', label: 'Build healthier habits' },
                  { emoji: '⭐', label: 'Cheer together' },
                ].map((f, i) => (
                  <div key={f.label} className="onboard-feature" style={{ animationDelay: `${0.15 + i * 0.08}s` }}>
                    <span aria-hidden="true">{f.emoji}</span>
                    {f.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 'name' && (
            <div className="stack">
              <Buddy mood={name ? 'cheering' : 'excited'} say={name ? `Lovely to meet you, ${name}!` : 'Let’s be friends.'}>
                <h1>First things first — what shall I call you?</h1>
              </Buddy>
              <div className="field">
                <label htmlFor="name" className="visually-hidden">
                  Your name
                </label>
                <input
                  id="name"
                  className="input onboard-name"
                  value={draft.name}
                  placeholder="Your name"
                  autoComplete="given-name"
                  autoFocus
                  maxLength={40}
                  onChange={(e) => set({ name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') next();
                  }}
                />
                <p className="tiny muted">Just a first name, or whatever you like being called. You can skip this.</p>
              </div>
            </div>
          )}

          {step === 'about' && (
            <div className="stack">
              <Buddy mood="thinking" say="Only used to work out your targets — nothing else.">
                <h1>A bit about you{name ? `, ${name}` : ''}</h1>
              </Buddy>

              <div className="field">
                <label>Sex assigned at birth (for the energy formula)</label>
                <Segmented<Sex>
                  value={draft.sex}
                  onChange={(sex) => set({ sex })}
                  options={[
                    { value: 'female', label: 'Female' },
                    { value: 'male', label: 'Male' },
                    { value: 'other', label: 'Rather not' },
                  ]}
                />
              </div>

              <RegionField value={draft.region ?? 'GB'} onChange={moveTo} hint="For your prices, food names and the way labels are read there." />

              <div className="field">
                <label>Units</label>
                <Segmented<Units>
                  value={draft.units}
                  onChange={(units) => setDraft((d) => retuneForUnits(d, units))}
                  options={[
                    { value: 'metric', label: 'cm / kg' },
                    { value: 'imperial', label: imperialLabel() },
                  ]}
                />
              </div>

              <NumberField
                label="Age"
                value={draft.age}
                suffix="yrs"
                min={MIN_AGE}
                max={100}
                onChange={(age) => set({ age })}
                onBelowMin={() => setTooYoung(true)}
              />
              <HeightField cm={draft.heightCm} units={draft.units} onChange={(heightCm) => set({ heightCm })} />
              <WeightField label="Weight" kg={draft.weightKg} units={draft.units} onChange={(weightKg) => set({ weightKg })} />
            </div>
          )}

          {step === 'goal' && (
            <div className="stack">
              <Buddy mood={GOAL_COPY[draft.goal].mood} say={GOAL_COPY[draft.goal].say}>
                <h1>What are we aiming for?</h1>
              </Buddy>

              {(Object.keys(GOAL_COPY) as Goal[]).map((goal) => (
                <button
                  key={goal}
                  type="button"
                  className={`choice ${draft.goal === goal ? 'is-on' : ''}`}
                  onClick={() => set({ goal })}
                  aria-pressed={draft.goal === goal}
                >
                  <span className="choice-emoji" aria-hidden="true">
                    {GOAL_COPY[goal].emoji}
                  </span>
                  <span>
                    <b>{GOAL_COPY[goal].title}</b>
                    <span className="muted small"> {GOAL_COPY[goal].blurb}</span>
                  </span>
                </button>
              ))}

              {draft.goal !== 'maintain' && (
                <>
                  <WeightField
                    label="Goal weight"
                    kg={draft.targetWeightKg}
                    units={draft.units}
                    onChange={(targetWeightKg) => set({ targetWeightKg })}
                  />
                  <div className="field">
                    <label htmlFor="pace">Pace — {formatPace(draft.pace, draft.units)} per week</label>
                    <input
                      id="pace"
                      type="range"
                      min={PACE_CHOICES[draft.units].min}
                      max={PACE_CHOICES[draft.units].max}
                      step={PACE_CHOICES[draft.units].step}
                      value={paceIn(draft.pace, draft.units)}
                      onChange={(e) => set({ pace: paceToKg(Number(e.target.value), draft.units) })}
                    />
                    <p className="tiny muted">
                      Steady beats speedy — {draft.units === 'metric' ? '0.5 kg' : '1 lb'} a week is the sweet spot for most
                      people.
                    </p>
                  </div>
                  <GoalNote projection={projection} target={formatWeight(draft.targetWeightKg, draft.units)} onSwitch={(goal) => set({ goal })} />
                </>
              )}
            </div>
          )}

          {step === 'activity' && (
            <div className="stack">
              <Buddy mood={ACTIVITY_COPY[draft.activity].mood} say={ACTIVITY_COPY[draft.activity].say}>
                <h1>How active is a normal day?</h1>
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

          {step === 'plan' && (
            <div className="stack">
              <Confetti />
              <div className="center">
                <Squish mood="cheering" size={140} />
                <h1 style={{ marginTop: 6 }}>Here’s your plan{name ? `, ${name}` : ''}!</h1>
                <p className="muted small">Built from your height, weight, age and activity. Tweak it any time in You → Targets.</p>
              </div>

              <div className="card onboard-plan">
                <div className="row-between" style={{ marginBottom: 10 }}>
                  <span className="muted small">Daily energy</span>
                  <b style={{ fontSize: 28 }}>
                    <CountUp value={energyValue(targets.calories)} /> {currentEnergyUnit()}
                  </b>
                </div>
                <MacroBars totals={{ calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 }} targets={targets} compact />
                <div className="divider" />
                <div className="row" style={{ gap: 16 }}>
                  <span className="small muted">💧 {targets.water} glasses ({waterVolume(targets.water)})</span>
                  <span className="small muted">👟 {targets.steps.toLocaleString()} steps</span>
                </div>
              </div>
              {projection?.kind === 'date' && (
                <p className="onboard-when small center">
                  🎯 At this pace, around <b>{aroundWhen(projection.date)}</b> you could be at{' '}
                  <b>{formatWeight(draft.targetWeightKg, draft.units)}</b>.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="onboard-actions">
          {index > 0 && (
            <button type="button" className="btn btn--ghost" onClick={back}>
              Back
            </button>
          )}
          {step === 'plan' ? (
            <button type="button" className="btn grow" onClick={() => completeOnboarding(draft)}>
              Let's go
            </button>
          ) : (
            <button type="button" className="btn grow" onClick={next}>
              {step === 'welcome' ? 'Get started' : step === 'name' && !name ? 'Skip' : 'Continue'}
            </button>
          )}
        </div>
        {step === 'welcome' && accounts && (
          <button type="button" className="btn btn--quiet onboard-signin" onClick={() => setSigning('in')}>
            I already have an account
          </button>
        )}

        <Sheet
          open={signing !== null}
          onClose={() => setSigning(null)}
          title={signing === 'forgot' ? 'Forgotten password' : 'Sign in'}
        >
          {signing === 'in' && (
            <Credentials
              submit="Sign in"
              onSubmit={signIn}
              onDone={(who) => void arrived(who)}
              footer={
                <button type="button" className="linkish tiny" onClick={() => setSigning('forgot')}>
                  I have forgotten my password
                </button>
              }
            />
          )}
          {signing === 'forgot' && (
            <Forgot
              onDone={() => {
                setSigning(null);
                toast('If that address has an account, a link is on its way.', '📮');
              }}
            />
          )}
        </Sheet>
      </div>
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
  if (projection.kind === 'there') return <p className="onboard-when small">🎉 You’re there already — maybe “Eat healthy”?</p>;
  if (projection.kind === 'mismatch')
    return (
      <div className="onboard-when onboard-when--check small">
        <span>
          {projection.suggest === 'gain' ? 'That goal is above your weight now.' : 'That goal is below your weight now.'} Did you
          mean to {projection.suggest === 'gain' ? 'build up' : 'lose weight'}?
        </span>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => onSwitch(projection.suggest)}>
          {projection.suggest === 'gain' ? 'Build up instead' : 'Lose weight instead'}
        </button>
      </div>
    );
  return (
    <p className="onboard-when small" aria-live="polite">
      🎯 You’d reach <b>{target}</b> around <b>{aroundWhen(projection.date)}</b>.
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
