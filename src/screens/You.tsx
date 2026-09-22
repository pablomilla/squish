import { useEffect, useMemo, useState } from 'react';
import Squish from '../components/Squish';
import AccountCard from '../components/AccountCard';
import { Segmented, Sheet, Stepper, usePrefersDark, useToast } from '../components/ui';
import { HeightField, NumberField, WeightField } from '../components/fields';
import { PACE_CHOICES, formatHeight, formatPace, formatWeight, formatWeightDelta, paceIn, paceToKg, retuneForUnits, saltGrams, sodiumMg, weightUnitLabel } from '../lib/units';
import { disableReminders, enableReminders, explainBlocker, reminderSupport, type ReminderBlocker } from '../lib/reminders';
import { adaptiveSuggestion } from '../lib/adaptive';
import { SparkIcon, TrashIcon } from '../components/icons';
import { LOOKS, PLUS_LOOKS, isUnlocked } from '../lib/looks';
import { backupState, resumeBackup, watchBackup, watchIdentity } from '../lib/autobackup';
import { forgetBackup, pullDiary, type BackupState, type RemoteDiary } from '../lib/backup';
import { PLUS, planNow, watchStanding, type Standing } from '../lib/plan';
import { useSquish } from '../store/useSquish';
import { ACTIVITY_LABEL, GLASS_ML, computeTargets, tdee } from '../lib/nutrition';
import { aiStatus, type AiStatus } from '../lib/api';
import { apiUrl } from '../lib/origin';
import { friendlyDate, isoDate } from '../lib/date';
import { streakOf } from '../lib/selectors';
import type { Activity, Goal, Sex } from '../types';
import './you.css';

export default function You() {
  const toast = useToast();
  const { profile, targets, meals, days, theme, look, setLook, reminders, setReminders, setProfile, setTargets, recalcTargets, applyBurnFactor, resetAll, unlocked, nutritionistNotes, forgetNote } =
    useSquish();
  const [ignoredLearning, setIgnoredLearning] = useState(false);
  const prefersDark = usePrefersDark();
  const standing = usePlan();
  const subscribed = standing.plan === 'plus';
  const backup = useBackup();

  // Only offered, never applied: a plan that moves on its own is unsettling,
  // and the reading behind it can be wrong in ways only they would know.
  const learning = useMemo(
    () => adaptiveSuggestion(profile, meals, days, targets.calories),
    [profile, meals, days, targets.calories],
  );
  const learned = ignoredLearning ? null : learning;
  const [editing, setEditing] = useState(false);
  const [editingTargets, setEditingTargets] = useState(false);
  const [savingReminders, setSavingReminders] = useState(false);
  const measured = profile.plateCm !== undefined || profile.bowlMl !== undefined;
  // Worked out once: whether push is possible does not change while the screen
  // is open, and asking the phone is a promise, not a value.
  const [blocker, setBlocker] = useState<ReminderBlocker | null>(null);

  useEffect(() => {
    let live = true;
    void reminderSupport().then((found) => {
      if (live) setBlocker(found);
    });
    return () => {
      live = false;
    };
  }, []);

  const toggleReminders = async () => {
    setSavingReminders(true);
    try {
      if (reminders.on) {
        await disableReminders();
        setReminders({ on: false });
        toast('Reminders off', '🔕');
        return;
      }
      const result = await enableReminders({
        breakfast: reminders.breakfast,
        lunch: reminders.lunch,
        dinner: reminders.dinner,
      });
      if (result.ok) {
        setReminders({ on: true });
        toast('Reminders on', '🔔');
      } else {
        toast(result.message ?? 'Reminders could not be turned on.', '🔕');
      }
    } finally {
      setSavingReminders(false);
    }
  };
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

        {learned && (
          <div className="learned">
            <p className="small">
              <b>Your logs disagree with the textbook.</b>
            </p>
            <p className="tiny muted">
              Over {learned.observation.spanDays} days you averaged{' '}
              <b>{learned.observation.meanIntake.toLocaleString()} kcal</b> a day and your weight moved{' '}
              <b>{formatWeightDelta(learned.observation.weeklyChangeKg, profile.units)}</b> a week. That puts what you
              actually burn nearer <b>{learned.applied.toLocaleString()}</b> than the {learned.formula.toLocaleString()}{' '}
              the formula assumed.
            </p>
            {learned.capped && learned.factor < 1 && (
              <p className="tiny muted">
                Worth saying: a reading this low is more often a few unlogged snacks than a slow metabolism. I have only
                gone part of the way, and it is your call.
              </p>
            )}
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--soft btn--sm"
                onClick={() => {
                  applyBurnFactor(learned.factor);
                  toast(`Plan redone — ${computeTargets({ ...profile, burnFactor: learned.factor }).calories} kcal a day`, '🎯');
                }}
              >
                Use {computeTargets({ ...profile, burnFactor: learned.factor }).calories} kcal instead
              </button>
              <button type="button" className="btn--quiet small" onClick={() => setIgnoredLearning(true)}>
                Leave it
              </button>
            </div>
          </div>
        )}

        {profile.burnFactor && profile.burnFactor !== 1 && !learned && (
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Tuned to your own logs: {Math.round((profile.burnFactor - 1) * 100) > 0 ? '+' : ''}
            {Math.round((profile.burnFactor - 1) * 100)}% on the textbook estimate.{' '}
            <button type="button" className="link-button" onClick={() => { applyBurnFactor(1); toast('Back to the textbook estimate', '↩️'); }}>
              Undo
            </button>
          </p>
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
        <Row label="Pace" value={profile.goal === 'maintain' ? '—' : `${formatPace(profile.pace, profile.units)} / week`} />
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
        {theme === 'system' && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Your browser is asking for <b>{prefersDark ? 'dark' : 'light'}</b>, so that is what Auto gives you. On
            Android that comes from the phone's dark theme <em>or</em> from Chrome's own, under Settings → Theme — they
            are two separate switches.
          </p>
        )}

        <div className="divider" style={{ margin: '16px 0 12px' }} />

        <h4 className="small">How Squish looks</h4>
        <p className="tiny muted">Earned by using the app.</p>
        <div className="looks" role="radiogroup" aria-label="How Squish looks">
          {LOOKS.map((entry) => {
            const earned = isUnlocked(entry, unlocked, subscribed);
            const chosen = entry.id === look;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={`look${chosen ? ' look--on' : ''}${earned ? '' : ' look--locked'}`}
                // A locked one is not disabled: pressing it should say how to
                // get it, which is the only thing somebody wants to know.
                onClick={() => (earned ? setLook(entry.id) : toast(entry.how, '🔒'))}
                aria-label={earned ? entry.name : `${entry.name}, locked — ${entry.how}`}
              >
                <span
                  className="look-swatch"
                  aria-hidden="true"
                  style={{
                    background: `radial-gradient(circle at 34% 30%, ${
                      (prefersDark && theme === 'system') || theme === 'dark' ? entry.dark : entry.light
                    })`,
                  }}
                />
                <span className="tiny">{earned ? entry.name : entry.how}</span>
              </button>
            );
          })}
        </div>

        <div className="row-between" style={{ marginTop: 16 }}>
          <h4 className="small">{PLUS}</h4>
          {!subscribed && <span className="badge">Not yet</span>}
        </div>
        <p className="tiny muted">
          {subscribed
            ? 'Yours while your subscription is running.'
            : 'Six more, coming when Squish Plus does. Nothing to buy yet.'}
        </p>
        <div className="looks" role="radiogroup" aria-label={PLUS}>
          {PLUS_LOOKS.map((entry) => {
            const earned = isUnlocked(entry, unlocked, subscribed);
            const chosen = entry.id === look;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={`look look--plus${chosen ? ' look--on' : ''}${earned ? '' : ' look--locked'}`}
                onClick={() => (earned ? setLook(entry.id) : toast(`${entry.name} comes with ${PLUS}, which is not on sale yet.`, '✨'))}
                aria-label={earned ? entry.name : `${entry.name}, part of ${PLUS}`}
              >
                <span
                  className="look-swatch"
                  aria-hidden="true"
                  style={{
                    background: `radial-gradient(circle at 34% 30%, ${
                      (prefersDark && theme === 'system') || theme === 'dark' ? entry.dark : entry.light
                    })`,
                  }}
                />
                <span className="tiny">{entry.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>Your plates</h3>
        </div>
        {/* The single cheapest thing anyone can do for portion accuracy. A
            phone with a depth sensor measures the food; a photo has to measure
            it against something, and the plate is the ruler already in shot.

            Nothing is assumed, though. A wrong plate size is worse than none:
            the food gets scaled by the ratio, so a 27 cm guess about a 20 cm
            plate makes the portion almost twice what it was. */}
        <p className="tiny muted">
          Measure a dinner plate across and tell Squish once. Most meals are eaten off the same few things, and a plate
          of known size is a ruler lying in every photo.
        </p>

        {measured ? (
          <>
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="row-between">
                <span className="small">Dinner plate</span>
                <Stepper
                  value={profile.plateCm ?? 27}
                  step={1}
                  min={15}
                  max={40}
                  onChange={(plateCm) => setProfile({ plateCm })}
                  suffix="cm across"
                />
              </div>
              <div className="row-between">
                <span className="small">Usual bowl</span>
                <Stepper
                  value={profile.bowlMl ?? 400}
                  step={50}
                  min={150}
                  max={1500}
                  onChange={(bowlMl) => setProfile({ bowlMl })}
                  suffix="ml"
                />
              </div>
            </div>
            <button
              type="button"
              className="btn--quiet small"
              style={{ marginTop: 10 }}
              onClick={() => {
                setProfile({ plateCm: undefined, bowlMl: undefined });
                toast('Squish will judge portions on its own', '🍽️');
              }}
            >
              Forget my plate sizes
            </button>
          </>
        ) : (
          <>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              <b>Not set.</b> Squish is judging portions from the photo alone, which is what it has always done.
            </p>
            <button
              type="button"
              className="btn btn--soft btn--block"
              style={{ marginTop: 10 }}
              onClick={() => setProfile({ plateCm: 27, bowlMl: 400 })}
            >
              Measure and set them
            </button>
          </>
        )}

        <p className="tiny muted" style={{ marginTop: 8 }}>
          A standard British dinner plate is about 27 cm; a side plate 20 cm. Only tell Squish a size you have actually
          measured — a wrong one makes portions worse, not better.
        </p>
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>Meal reminders</h3>
          {reminders.on && <span className="badge badge--good">On</span>}
        </div>

        {blocker === null ? (
          <p className="tiny muted">Checking…</p>
        ) : blocker !== 'ok' ? (
          <p className="tiny muted">{explainBlocker(blocker)}</p>
        ) : (
          <>
            <p className="tiny muted">A nudge at each mealtime, so a day does not quietly go unlogged.</p>
            <div className="stack" style={{ marginTop: 10 }}>
              {(['breakfast', 'lunch', 'dinner'] as const).map((meal) => (
                <div className="row-between" key={meal}>
                  <label className="small" htmlFor={`remind-${meal}`} style={{ textTransform: 'capitalize' }}>
                    {meal}
                  </label>
                  <input
                    id={`remind-${meal}`}
                    className="input"
                    type="time"
                    // Wide enough for "12:30 PM" plus the clock button. A US
                    // locale renders 12-hour and was clipping it to "08:00 AI".
                    style={{ width: 160 }}
                    value={reminders[meal]}
                    onChange={(e) => setReminders({ [meal]: e.target.value })}
                  />
                </div>
              ))}
            </div>

            <button
              type="button"
              className={`btn btn--block ${reminders.on ? 'btn--ghost' : ''}`}
              style={{ marginTop: 12 }}
              disabled={savingReminders}
              onClick={() => void toggleReminders()}
            >
              {savingReminders ? 'Just a moment…' : reminders.on ? 'Turn reminders off' : 'Turn reminders on'}
            </button>

            {reminders.on && (
              <p className="tiny muted" style={{ marginTop: 8 }}>
                Changed a time? Press the button twice to send the new times over.
              </p>
            )}
          </>
        )}
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>What the nutritionist remembers</h3>
          {nutritionistNotes.length > 0 && <span className="badge">{nutritionistNotes.length}</span>}
        </div>

        {nutritionistNotes.length === 0 ? (
          <p className="tiny muted">
            Nothing yet. Tell it something worth keeping — an allergy, a food you will not eat, what you are training
            for — and it will note it down and remember next time.
          </p>
        ) : (
          <>
            <p className="tiny muted">Its own notes, kept in this browser with everything else. Delete any of them.</p>
            <div className="stack" style={{ marginTop: 10 }}>
              {nutritionistNotes.map((note) => (
                <div className="row-between" key={note.id}>
                  <span className="small">{note.note}</span>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    aria-label={`Forget: ${note.note}`}
                    onClick={() => forgetNote(note.id)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <PlanCard standing={standing} />

      <AccountCard enabled={backup.kind !== 'off'} />

      <BackupCard />

      <section className="card card--quiet">
        <div className="card-title">
          <h3>Your data</h3>
        </div>
        <p className="small muted">
          {backup.kind === 'off'
            ? 'Everything lives in this browser. Nothing is uploaded except the photo you choose to analyse.'
            : 'Your diary lives in this browser. A copy is kept on the Squish server so you can get it back, along with any photo you choose to analyse. Nothing else leaves this device.'}
        </p>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <button type="button" className="btn btn--ghost grow" onClick={exportData}>
            Export JSON
          </button>
          <button type="button" className="btn btn--danger grow" onClick={() => setConfirmReset(true)}>
            Reset
          </button>
        </div>
        {/*
          Served by the server rather than routed inside the app, so it opens
          for somebody who has not installed the app or made an account —
          which is the whole point of publishing a policy.
        */}
        <p className="tiny muted" style={{ marginTop: 12 }}>
          <a href={apiUrl('/privacy')} target="_blank" rel="noopener noreferrer">
            Privacy policy
          </a>{' '}
          — what is kept, where it goes, and how to get rid of it.
        </p>
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
              <span className="small">Pace ({weightUnitLabel(profile.units)}/week)</span>
              <Stepper
                value={paceIn(profile.pace, profile.units)}
                step={PACE_CHOICES[profile.units].step}
                min={PACE_CHOICES[profile.units].min}
                max={PACE_CHOICES[profile.units].max}
                onChange={(pace) => setProfile({ pace: paceToKg(pace, profile.units) })}
              />
            </div>
          )}
          <div className="field">
            <label>Units</label>
            <Segmented
              value={profile.units}
              onChange={(units) => setProfile(retuneForUnits(profile, units))}
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
            <span className="small">Saturates<span className="tiny muted"> · a daily limit</span></span>
            <Stepper value={targets.satFat ?? 0} step={1} min={0} max={80} onChange={(satFat) => setTargets({ satFat })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">Fibre</span>
            <Stepper value={targets.fibre} step={1} min={10} max={60} onChange={(fibre) => setTargets({ fibre })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">Sugar<span className="tiny muted"> · a daily limit</span></span>
            <Stepper value={targets.sugar ?? 0} step={5} min={0} max={200} onChange={(sugar) => setTargets({ sugar })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">Free sugars<span className="tiny muted"> · added, honey and juice</span></span>
            <Stepper value={targets.freeSugar ?? 0} step={5} min={0} max={200} onChange={(freeSugar) => setTargets({ freeSugar })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">Salt<span className="tiny muted"> · a daily limit</span></span>
            <Stepper
              value={saltGrams(targets.sodium ?? 0)}
              step={0.5}
              min={0}
              max={15}
              onChange={(salt) => setTargets({ sodium: sodiumMg(salt) })}
              suffix="g"
            />
          </div>
          <div className="row-between">
            <span className="small">
              Water<span className="tiny muted"> · {GLASS_ML} ml a glass</span>
            </span>
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
        <p className="small muted">
          {backup.kind === 'off'
            ? 'This clears every meal, day log and badge on this device. It cannot be undone.'
            : 'This clears every meal, day log and badge on this device, and deletes the backup too. It cannot be undone.'}
        </p>
        <div className="row" style={{ gap: 10, marginTop: 16 }}>
          <button type="button" className="btn btn--ghost grow" onClick={() => setConfirmReset(false)}>
            Keep my data
          </button>
          <button
            type="button"
            className="btn btn--danger grow"
            onClick={() => {
              // Deleted first: the automatic backup would otherwise push the
              // emptied diary up a few seconds later, which gets to the same
              // place by accident rather than because anybody asked.
              void forgetBackup().finally(() => resetAll());
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

/**
 * What the backup is doing, and the two things somebody might want from it.
 *
 * Restore is offered rather than done. A diary on the server that is newer
 * than this browser's is not obviously the right one — somebody may have
 * logged today on their phone, or may have deliberately started again — so
 * the only automatic behaviour is keeping a copy.
 */
function usePlan(): Standing {
  const [standing, setStanding] = useState(planNow);
  useEffect(() => watchStanding(setStanding), []);
  return standing;
}

function useBackup(): BackupState {
  const [state, setState] = useState<BackupState>(backupState);
  useEffect(() => watchBackup(setState), []);
  return state;
}

function BackupCard() {
  const state = useBackup();
  const [remote, setRemote] = useState<RemoteDiary | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  // Signing in or out points this device at a different diary, and the state
  // is `idle` either side of that — so the look-up has to be told separately.
  const [switched, setSwitched] = useState(0);
  useEffect(() => watchIdentity(() => setSwitched((n) => n + 1)), []);

  useEffect(() => {
    if (state.kind === 'off') return;
    let live = true;
    void pullDiary().then((found) => {
      if (live) setRemote(found);
    });
    return () => {
      live = false;
    };
  }, [state.kind, switched]);

  if (state.kind === 'off') return null;

  const restore = async () => {
    const found = remote ?? (await pullDiary());
    if (!found?.state) {
      toast('There is no backup to restore.', '📦');
      return;
    }
    setBusy(true);
    // Merged over the current state rather than replacing it, so a key this
    // version has and the backup does not keeps its default instead of
    // becoming undefined halfway down the app.
    useSquish.setState(found.state as Partial<ReturnType<typeof useSquish.getState>>);
    resumeBackup(found.version);
    setBusy(false);
    toast('Restored from your backup.', '📦');
  };

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>Backup</h3>
        {state.kind === 'saving' && <span className="badge">Saving…</span>}
        {state.kind === 'conflict' && <span className="badge badge--warn">Paused</span>}
        {state.kind === 'failed' && <span className="badge badge--warn">Offline</span>}
        {state.kind === 'too_big' && <span className="badge badge--bad">Too large</span>}
      </div>

      {state.kind === 'too_big' ? (
        <p className="tiny muted">
          Your diary has grown past what the backup will hold, so it has stopped. Nothing on this device has been lost
          and nothing is wrong with your connection — the copy on the server is simply older than your diary now.
          Deleting some older meals, particularly photographed ones, will let it start again.
        </p>
      ) : state.kind === 'conflict' ? (
        <p className="tiny muted">
          Another device has backed up something this one has not seen. Squish will not merge two diaries — that means
          guessing whether two similar lunches are one lunch logged twice — so backing up has stopped until you say
          which to keep.
        </p>
      ) : (
        <p className="tiny muted">
          A copy of your diary is kept so a cleared browser or a lost phone is an inconvenience rather than the end of
          it. Your diary still lives on this device; this is the spare.
        </p>
      )}

      {remote?.updatedAt && (
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Last kept {friendlyDate(remote.updatedAt.slice(0, 10)).toLowerCase()}.
        </p>
      )}

      <div className="row" style={{ gap: 10, marginTop: 12 }}>
        <button type="button" className="btn btn--sm btn--ghost grow" disabled={busy || !remote} onClick={() => void restore()}>
          {state.kind === 'conflict' ? 'Use the other one' : 'Restore from backup'}
        </button>
        {state.kind === 'conflict' && (
          <button type="button" className="btn btn--sm" onClick={() => { resumeBackup(remote?.version ?? null); toast('Keeping this one.', '📦'); }}>
            Keep this one
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * Which plan, and what is left of the month.
 *
 * Shown rather than hidden behind a limit somebody runs into. A person who
 * can see they have eleven photo analyses left will spend them differently
 * from one who discovers the number by being refused, and the second is how
 * an app earns a one-star review about being "secretly limited".
 *
 * Nothing here decides anything: it is a reading of what the server said.
 */
function PlanCard({ standing }: { standing: Standing }) {
  if (!standing.known || standing.off) return null;

  const plus = standing.plan === 'plus';
  const rows: { label: string; kind: 'photo' | 'chat' | 'recipe' }[] = [
    { label: 'Photo analyses', kind: 'photo' },
    { label: 'Nutritionist questions', kind: 'chat' },
    { label: 'Recipe imports', kind: 'recipe' },
  ];

  return (
    <section className="card card--quiet">
      <div className="card-title">
        {/* Not "Your plan" — the targets card above already is. */}
        <h3>Plan and usage</h3>
        <span className={`badge ${plus ? 'badge--good' : ''}`}>{plus ? PLUS : 'Free'}</span>
      </div>

      <div className="plan-rows">
        {rows.map((row) => (
          <div className="plan-row" key={row.kind}>
            <span className="tiny">{row.label}</span>
            <b className="small">
              {standing.allowance[row.kind] === 0 ? (
                <span className="muted">{PLUS}</span>
              ) : (
                `${standing.left[row.kind]} of ${standing.allowance[row.kind]} left`
              )}
            </b>
          </div>
        ))}
      </div>

      <p className="tiny muted" style={{ marginTop: 10 }}>
        {standing.resets ? `The month starts again on ${friendlyDate(standing.resets.slice(0, 10)).toLowerCase()}. ` : ''}
        Logging by hand, food search, your diary and the charts are free and always will be.
      </p>
    </section>
  );
}
