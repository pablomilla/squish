import { useMemo, useState } from 'react';
import Squish from '../components/Squish';
import { Segmented } from '../components/ui';
import { MacroBars } from '../components/charts';
import { HeightField, NumberField, WeightField } from '../components/fields';
import { useSquish, DEFAULT_PROFILE } from '../store/useSquish';
import { ACTIVITY_LABEL, computeTargets } from '../lib/nutrition';
import type { Activity, Goal, Profile, Sex } from '../types';
import type { Units } from '../lib/units';
import './onboarding.css';

const STEPS = ['welcome', 'about', 'goal', 'activity', 'plan'] as const;
type Step = (typeof STEPS)[number];

const GOAL_COPY: Record<Goal, { title: string; blurb: string; emoji: string }> = {
  lose: { title: 'Lose weight', blurb: 'A gentle deficit, plenty of protein', emoji: '🌱' },
  maintain: { title: 'Stay as I am', blurb: 'Keep things steady and balanced', emoji: '⚖️' },
  gain: { title: 'Build up', blurb: 'A little surplus to grow on', emoji: '💪' },
};

export default function Onboarding() {
  const completeOnboarding = useSquish((s) => s.completeOnboarding);
  const [step, setStep] = useState<Step>('welcome');
  const [draft, setDraft] = useState<Profile>(DEFAULT_PROFILE);

  const index = STEPS.indexOf(step);
  const targets = useMemo(() => computeTargets(draft), [draft]);
  const set = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, index + 1)]);
  const back = () => setStep(STEPS[Math.max(0, index - 1)]);

  return (
    <div className="app onboarding">
      <div className="screen">
        <div className="onboard-progress" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s} className={i <= index ? 'is-on' : ''} />
          ))}
        </div>

        {step === 'welcome' && (
          <div className="onboard-hero">
            <Squish mood="excited" size={190} heart />
            <h1 className="onboard-logo">Squish</h1>
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
              ].map((f) => (
                <div key={f.label} className="onboard-feature">
                  <span aria-hidden="true">{f.emoji}</span>
                  {f.label}
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 'about' && (
          <div className="stack">
            <div className="onboard-head">
              <Squish mood="calm" size={96} bob={false} />
              <div>
                <h1>A bit about you</h1>
                <p className="muted small">This is only used to work out your daily targets, and it stays on your device.</p>
              </div>
            </div>

            <div className="field">
              <label htmlFor="name">What shall I call you?</label>
              <input id="name" className="input" value={draft.name} placeholder="Your name" onChange={(e) => set({ name: e.target.value })} />
            </div>

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

            <div className="field">
              <label>Units</label>
              <Segmented<Units>
                value={draft.units}
                onChange={(units) => set({ units })}
                options={[
                  { value: 'metric', label: 'cm / kg' },
                  { value: 'imperial', label: 'ft / st' },
                ]}
              />
            </div>

            <NumberField label="Age" value={draft.age} suffix="yrs" min={14} max={100} onChange={(age) => set({ age })} />
            <HeightField cm={draft.heightCm} units={draft.units} onChange={(heightCm) => set({ heightCm })} />
            <WeightField label="Weight" kg={draft.weightKg} units={draft.units} onChange={(weightKg) => set({ weightKg })} />
            <WeightField
              label="Goal weight"
              kg={draft.targetWeightKg}
              units={draft.units}
              onChange={(targetWeightKg) => set({ targetWeightKg })}
            />
          </div>
        )}

        {step === 'goal' && (
          <div className="stack">
            <div className="onboard-head">
              <Squish mood="proud" size={96} bob={false} />
              <div>
                <h1>What are we aiming for?</h1>
                <p className="muted small">You can change this whenever you like.</p>
              </div>
            </div>

            {(Object.keys(GOAL_COPY) as Goal[]).map((goal) => (
              <button
                key={goal}
                type="button"
                className={`choice ${draft.goal === goal ? 'is-on' : ''}`}
                onClick={() => set({ goal })}
                aria-pressed={draft.goal === goal}
              >
                <span className="choice-emoji" aria-hidden="true">{GOAL_COPY[goal].emoji}</span>
                <span>
                  <b>{GOAL_COPY[goal].title}</b>
                  <span className="muted small"> {GOAL_COPY[goal].blurb}</span>
                </span>
              </button>
            ))}

            {draft.goal !== 'maintain' && (
              <div className="field">
                <label htmlFor="pace">Pace — {draft.pace} kg per week</label>
                <input
                  id="pace"
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.1}
                  value={draft.pace}
                  onChange={(e) => set({ pace: Number(e.target.value) })}
                />
                <p className="tiny muted">Steady beats speedy — 0.5 kg a week is the sweet spot for most people.</p>
              </div>
            )}
          </div>
        )}

        {step === 'activity' && (
          <div className="stack">
            <div className="onboard-head">
              <Squish mood="cheering" size={96} bob={false} />
              <div>
                <h1>How active is a normal day?</h1>
                <p className="muted small">Everything counts — walking, chasing kids, the lot.</p>
              </div>
            </div>
            {(Object.keys(ACTIVITY_LABEL) as Activity[]).map((activity) => (
              <button
                key={activity}
                type="button"
                className={`choice ${draft.activity === activity ? 'is-on' : ''}`}
                onClick={() => set({ activity })}
                aria-pressed={draft.activity === activity}
              >
                <span>
                  <b>{ACTIVITY_LABEL[activity]}</b>
                </span>
              </button>
            ))}
          </div>
        )}

        {step === 'plan' && (
          <div className="stack">
            <div className="center">
              <Squish mood="cheering" size={140} />
              <h1 style={{ marginTop: 6 }}>Here's your plan{draft.name ? `, ${draft.name}` : ''}</h1>
              <p className="muted small">Built from your height, weight, age and activity. Tweak it any time in You → Targets.</p>
            </div>

            <div className="card">
              <div className="row-between" style={{ marginBottom: 10 }}>
                <span className="muted small">Daily energy</span>
                <b style={{ fontSize: 24 }}>{targets.calories} kcal</b>
              </div>
              <MacroBars totals={{ calories: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 }} targets={targets} compact />
              <div className="divider" />
              <div className="row" style={{ gap: 16 }}>
                <span className="small muted">💧 {targets.water} glasses</span>
                <span className="small muted">👟 {targets.steps.toLocaleString()} steps</span>
              </div>
            </div>
          </div>
        )}

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
              {step === 'welcome' ? 'Get started' : 'Continue'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
