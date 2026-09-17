import { useEffect, useMemo, useState } from 'react';
import Squish from '../components/Squish';
import { Segmented, Sheet, Stepper, useToast } from '../components/ui';
import { HeightField, NumberField, WeightField } from '../components/fields';
import { formatHeight, formatWeight } from '../lib/units';
import { SparkIcon } from '../components/icons';
import { useSquish } from '../store/useSquish';
import { ACTIVITY_LABEL, computeTargets, tdee } from '../lib/nutrition';
import { aiStatus, type AiStatus } from '../lib/api';
import { isoDate } from '../lib/date';
import { streakOf } from '../lib/selectors';
import type { Activity, Goal, Sex } from '../types';
import './you.css';

export default function You() {
  const toast = useToast();
  const { profile, targets, meals, theme, setProfile, setTargets, recalcTargets, resetAll, unlocked } = useSquish();
  const [editing, setEditing] = useState(false);
  const [editingTargets, setEditingTargets] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    aiStatus().then(setStatus);
  }, []);

  const maintenance = Math.round(tdee(profile));
  const streak = useMemo(() => streakOf(meals, isoDate()), [meals]);
  const suggested = useMemo(() => computeTargets(profile), [profile]);
  const customised = suggested.calories !== targets.calories;

  const exportData = () => {
    const blob = new Blob([JSON.stringify(useSquish.getState(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `squish-export-${isoDate()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Exported your data', '📦');
  };

  return (
    <div className="screen you">
      <header className="you-head">
        <Squish mood="proud" size={104} />
        <div>
          <h1>{profile.name || 'You'}</h1>
          <p className="muted small">
            {streak} day streak · {meals.length} meals · {Object.keys(unlocked).length} badges
          </p>
        </div>
      </header>

      <section className="card card--hero">
        <div className="card-title">
          <h3>Your plan</h3>
          <button type="button" className="btn--quiet small" onClick={() => setEditingTargets(true)}>
            Adjust
          </button>
        </div>
        <div className="you-plan">
          <div className="pill-stat">
            <span className="tiny muted">Daily energy</span>
            <b>{targets.calories} kcal</b>
          </div>
          <div className="pill-stat">
            <span className="tiny muted">Maintenance</span>
            <b>{maintenance} kcal</b>
          </div>
          <div className="pill-stat">
            <span className="tiny muted">Protein</span>
            <b>{targets.protein} g</b>
          </div>
          <div className="pill-stat">
            <span className="tiny muted">Fibre</span>
            <b>{targets.fibre} g</b>
          </div>
        </div>
        {customised && (
          <button type="button" className="btn--quiet small" style={{ marginTop: 8 }} onClick={() => { recalcTargets(); toast('Back to the suggested plan', '↩️'); }}>
            Reset to suggested ({suggested.calories} kcal)
          </button>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          <h3>About you</h3>
          <button type="button" className="btn--quiet small" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
        <Row label="Goal" value={profile.goal === 'lose' ? 'Lose weight' : profile.goal === 'gain' ? 'Build up' : 'Stay steady'} />
        <Row label="Pace" value={profile.goal === 'maintain' ? '—' : `${profile.pace} kg / week`} />
        <Row label="Weight" value={formatWeight(profile.weightKg, profile.units)} />
        <Row label="Goal weight" value={formatWeight(profile.targetWeightKg, profile.units)} />
        <Row label="Height" value={formatHeight(profile.heightCm, profile.units)} />
        <Row label="Age" value={`${profile.age}`} />
        <Row label="Activity" value={ACTIVITY_LABEL[profile.activity]} />
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>Squish AI</h3>
          <span className={`badge ${status?.ai ? 'badge--good' : 'badge--warn'}`}>
            <SparkIcon size={13} /> {status?.ai ? 'Connected' : 'Offline mode'}
          </span>
        </div>
        <p className="small muted">
          {status?.ai
            ? `Photo analysis and coaching run on ${status.model}. Your photos go to the Squish API server and are not stored.`
            : 'No API key on the server, so meals are estimated from the built-in food table. Add ANTHROPIC_API_KEY to the server environment for real photo analysis.'}
        </p>
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>Appearance</h3>
        </div>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(value) => useSquish.getState().setTheme(value)}
          options={[
            { value: 'light' as const, label: 'Light' },
            { value: 'dark' as const, label: 'Dark' },
            { value: 'system' as const, label: 'Auto' },
          ]}
        />
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>Your data</h3>
        </div>
        <p className="small muted">Everything lives in this browser. Nothing is uploaded except the photo you choose to analyse.</p>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <button type="button" className="btn btn--ghost grow" onClick={exportData}>
            Export JSON
          </button>
          <button type="button" className="btn btn--danger grow" onClick={() => setConfirmReset(true)}>
            Reset
          </button>
        </div>
      </section>

      <p className="script center you-footer">Small steps. Big progress. ♡</p>

      <Sheet open={editing} onClose={() => setEditing(false)} title="About you">
        <div className="stack">
          <div className="field">
            <label htmlFor="you-name">Name</label>
            <input id="you-name" className="input" value={profile.name} onChange={(e) => setProfile({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>Goal</label>
            <Segmented<Goal>
              value={profile.goal}
              onChange={(goal) => setProfile({ goal })}
              options={[
                { value: 'lose', label: 'Lose' },
                { value: 'maintain', label: 'Maintain' },
                { value: 'gain', label: 'Gain' },
              ]}
            />
          </div>
          {profile.goal !== 'maintain' && (
            <div className="row-between">
              <span className="small">Pace (kg/week)</span>
              <Stepper value={profile.pace} step={0.1} min={0.1} max={1} onChange={(pace) => setProfile({ pace })} />
            </div>
          )}
          <div className="field">
            <label>Units</label>
            <Segmented
              value={profile.units}
              onChange={(units) => setProfile({ units })}
              options={[
                { value: 'metric' as const, label: 'cm / kg' },
                { value: 'imperial' as const, label: 'ft / st' },
              ]}
            />
          </div>
          <WeightField label="Weight" kg={profile.weightKg} units={profile.units} onChange={(weightKg) => setProfile({ weightKg })} />
          <WeightField
            label="Goal weight"
            kg={profile.targetWeightKg}
            units={profile.units}
            onChange={(targetWeightKg) => setProfile({ targetWeightKg })}
          />
          <HeightField cm={profile.heightCm} units={profile.units} onChange={(heightCm) => setProfile({ heightCm })} />
          <NumberField label="Age" value={profile.age} suffix="yrs" min={14} max={100} onChange={(age) => setProfile({ age })} />
          <div className="field">
            <label>Sex (for the energy formula)</label>
            <Segmented<Sex>
              value={profile.sex}
              onChange={(sex) => setProfile({ sex })}
              options={[
                { value: 'female', label: 'Female' },
                { value: 'male', label: 'Male' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>
          <div className="field">
            <label>Activity</label>
            <div className="row wrap" style={{ gap: 8 }}>
              {(Object.keys(ACTIVITY_LABEL) as Activity[]).map((activity) => (
                <button
                  key={activity}
                  type="button"
                  className="chip"
                  aria-pressed={profile.activity === activity}
                  onClick={() => setProfile({ activity })}
                >
                  {ACTIVITY_LABEL[activity]}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="btn btn--block" onClick={() => { setEditing(false); toast('Plan updated', '✅'); }}>
            Done
          </button>
        </div>
      </Sheet>

      <Sheet open={editingTargets} onClose={() => setEditingTargets(false)} title="Adjust targets">
        <div className="stack">
          <p className="small muted">Override anything Squish suggested — handy if a coach or dietitian set your numbers.</p>
          <div className="row-between">
            <span className="small">Calories</span>
            <Stepper value={targets.calories} step={50} min={1000} max={5000} onChange={(calories) => setTargets({ calories })} />
          </div>
          <div className="row-between">
            <span className="small">Protein</span>
            <Stepper value={targets.protein} step={5} min={30} max={300} onChange={(protein) => setTargets({ protein })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">Carbs</span>
            <Stepper value={targets.carbs} step={10} min={40} max={600} onChange={(carbs) => setTargets({ carbs })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">Fat</span>
            <Stepper value={targets.fat} step={5} min={20} max={200} onChange={(fat) => setTargets({ fat })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">Fibre</span>
            <Stepper value={targets.fibre} step={1} min={10} max={60} onChange={(fibre) => setTargets({ fibre })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">Water</span>
            <Stepper value={targets.water} min={4} max={20} onChange={(water) => setTargets({ water })} suffix="glasses" />
          </div>
          <div className="row-between">
            <span className="small">Steps</span>
            <Stepper value={targets.steps} step={500} min={2000} max={30000} onChange={(steps) => setTargets({ steps })} />
          </div>
          <button type="button" className="btn btn--block" onClick={() => setEditingTargets(false)}>
            Done
          </button>
        </div>
      </Sheet>

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="Start over?">
        <p className="small muted">This clears every meal, day log and badge on this device. It cannot be undone.</p>
        <div className="row" style={{ gap: 10, marginTop: 16 }}>
          <button type="button" className="btn btn--ghost grow" onClick={() => setConfirmReset(false)}>
            Keep my data
          </button>
          <button
            type="button"
            className="btn btn--danger grow"
            onClick={() => {
              resetAll();
              setConfirmReset(false);
              toast('All cleared', '🧼');
            }}
          >
            Delete everything
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="list-row">
      <span className="grow small muted">{label}</span>
      <b className="small">{value}</b>
    </div>
  );
}
