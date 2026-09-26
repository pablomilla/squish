import { useEffect, useMemo, useState } from 'react';
import Squish from '../components/Squish';
import AccountCard from '../components/AccountCard';
import Shelf from '../components/Shelf';
import PackTile from '../components/PackTile';
import InviteCard from '../components/InviteCard';
import SquadCard from '../components/squad/SquadCard';
import { Segmented, Sheet, Stepper, usePrefersDark, useToast } from '../components/ui';
import { HeightField, LanguageField, NumberField, RegionField, WeightField } from '../components/fields';
import { LANGUAGES, languageOf } from '../lib/language';
import { REGIONS, energyUnitOf, energyValue, formatEnergy, regionOf, toKcal, type EnergyUnit } from '../lib/region';
import { PACE_CHOICES, formatHeight, formatPace, formatWeight, formatWeightDelta, paceIn, paceToKg, imperialLabel, retuneForUnits, saltGrams, saltLabel, saltShown, showsSodium, sodiumFromShown, sodiumMg, weightUnitLabel } from '../lib/units';
import { disableReminders, enableReminders, explainBlocker, reminderSupport, type ReminderBlocker } from '../lib/reminders';
import { adaptiveSuggestion } from '../lib/adaptive';
import { ShareIcon, SparkIcon, TrashIcon } from '../components/icons';
import { LOOKS, PLUS_LOOKS, isUnlocked } from '../lib/looks';
import { ACCESSORIES, SLOTS, accessoryById, lockedNote, onShow, shelves, toggle, wearable, whyLocked } from '../lib/outfit';
import { SCENES, canUseScene, sceneOnShow } from '../lib/scenes';
import { sceneUrl } from '../components/sceneArt';
import { listWords, packLocked, packsAmong } from '../lib/packs';
import { explainPlan } from '../lib/planExplained';
import { adoptBackup, backupState, resumeBackup, watchBackup, watchIdentity } from '../lib/autobackup';
import { forgetBackup, pullDiary, type BackupState, type RemoteDiary } from '../lib/backup';
import { summariseDiary, type DiarySummary } from '../lib/diarySummary';
import { PLUS, planNow, redeemInvite, watchStanding, type Standing } from '../lib/plan';
import { useSquish, MIN_AGE } from '../store/useSquish';
import { ACTIVITY_LABEL, GLASS_ML, MACRO_LABEL, computeTargets, tdee } from '../lib/nutrition';
import { aiStatus, type AiStatus } from '../lib/api';
import { apiUrl } from '../lib/origin';
import { friendlyDate, isoDate, lastDays } from '../lib/date';
import { bestStreak, series, streakOf, summarise } from '../lib/selectors';
import { shareStory } from '../lib/shareStory';
import ShareSheet from '../components/ShareSheet';
import type { Activity, Goal, Route, Sex } from '../types';
import './you.css';
import { plural, t } from '../lib/i18n';
import { rich } from '../lib/i18n-react';
import { slotName } from '../lib/words';

export default function You({ go }: { go: (route: Route) => void }) {
  const toast = useToast();
  const { profile, targets, meals, days, theme, comparisons, look, setLook, reminders, setReminders, setProfile, setTargets, recalcTargets, applyBurnFactor, resetAll, unlocked, nutritionistNotes, forgetNote } =
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
        toast(t('Reminders off'), '🔕');
        return;
      }
      const result = await enableReminders({
        breakfast: reminders.breakfast,
        lunch: reminders.lunch,
        dinner: reminders.dinner,
      });
      if (result.ok) {
        setReminders({ on: true });
        toast(t('Reminders on'), '🔔');
      } else {
        toast(result.message ?? t('Reminders could not be turned on.'), '🔕');
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
  const plan = useMemo(() => explainPlan(profile, targets), [profile, targets]);

  const exportData = () => {
    const blob = new Blob([JSON.stringify(useSquish.getState(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `squish-export-${isoDate()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast(t('Exported your data'), '📦');
  };

  return (
    <div className="screen you">
      <header className="you-head">
        <Squish mood="proud" size={104} />
        <div>
          <h1>{profile.name || t('You')}</h1>
          <p className="muted small">
            {plural(streak, { one: '{n} day streak', other: '{n} day streak' })} · {plural(meals.length, { one: '{n} meal', other: '{n} meals' })} ·{' '}
            {plural(Object.keys(unlocked).length, { one: '{n} badge', other: '{n} badges' })}
          </p>
        </div>
      </header>

      <section className="card card--hero">
        <div className="card-title">
          <h3>{t('Your plan')}</h3>
          <button type="button" className="btn--quiet small" onClick={() => setEditingTargets(true)}>
            {t('Adjust')}
          </button>
        </div>
        <div className="you-plan">
          <div className="pill-stat">
            <span className="tiny muted">{t('Daily target')}</span>
            <b>{formatEnergy(targets.calories)}</b>
            <span className="tiny muted">{t('to eat')}</span>
          </div>
          <div className="pill-stat">
            <span className="tiny muted">{t('Maintenance')}</span>
            <b>{formatEnergy(maintenance)}</b>
            <span className="tiny muted">{t('your body burns')}</span>
          </div>
          <div className="pill-stat">
            <span className="tiny muted">{t('Protein')}</span>
            <b>{targets.protein} g</b>
          </div>
          <div className="pill-stat">
            <span className="tiny muted">{MACRO_LABEL.fibre}</span>
            <b>{targets.fibre} g</b>
          </div>
        </div>
        <p className="small plan-summary">{plan.summary}</p>
        <details className="plan-how">
          <summary className="small">{t('How these are worked out')}</summary>
          <dl>
            {plan.how.map((line) => (
              <div key={line.label}>
                <dt className="tiny">{line.label}</dt>
                <dd className="tiny muted">{line.words}</dd>
              </div>
            ))}
          </dl>
        </details>
        {customised && (
          <button type="button" className="btn--quiet small" style={{ marginTop: 8 }} onClick={() => { recalcTargets(); toast(t('Back to the suggested plan'), '↩️'); }}>
            {t('Reset to suggested ({energy})', { energy: formatEnergy(suggested.calories) })}
          </button>
        )}

        {learned && (
          <div className="learned">
            <p className="small">
              <b>{t('Your logs disagree with the textbook.')}</b>
            </p>
            <p className="tiny muted">
              {rich('Over {days} days you averaged <b>{intake}</b> a day and your weight moved <b>{change}</b> a week. That puts what you actually burn nearer <b>{burn}</b> than the {formula} the formula assumed.', {
                days: learned.observation.spanDays,
                intake: formatEnergy(learned.observation.meanIntake),
                change: formatWeightDelta(learned.observation.weeklyChangeKg, profile.units),
                burn: formatEnergy(learned.applied),
                formula: formatEnergy(learned.formula),
              }, { b: (text) => <b>{text}</b> })}
            </p>
            {learned.capped && learned.factor < 1 && (
              <p className="tiny muted">
                {t('Worth saying: a reading this low is more often a few unlogged snacks than a slow metabolism. I have only gone part of the way, and it is your call.')}
              </p>
            )}
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn--soft btn--sm"
                onClick={() => {
                  applyBurnFactor(learned.factor);
                  toast(t('Plan redone — {energy} a day', { energy: formatEnergy(computeTargets({ ...profile, burnFactor: learned.factor }).calories) }), '🎯');
                }}
              >
                {t('Use {energy} instead', { energy: formatEnergy(computeTargets({ ...profile, burnFactor: learned.factor }).calories) })}
              </button>
              <button type="button" className="btn--quiet small" onClick={() => setIgnoredLearning(true)}>
                {t('Leave it')}
              </button>
            </div>
          </div>
        )}

        {profile.burnFactor && profile.burnFactor !== 1 && !learned && (
          <p className="tiny muted" style={{ marginTop: 10 }}>
            {t('Tuned to your own logs: {percent}% on the textbook estimate.', {
              percent: `${Math.round((profile.burnFactor - 1) * 100) > 0 ? '+' : ''}${Math.round((profile.burnFactor - 1) * 100)}`,
            })}{' '}
            <button type="button" className="link-button" onClick={() => { applyBurnFactor(1); toast(t('Back to the textbook estimate'), '↩️'); }}>
              {t('Undo')}
            </button>
          </p>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          <h3>{t('About you')}</h3>
          <button type="button" className="btn--quiet small" onClick={() => setEditing(true)}>
            {t('Edit')}
          </button>
        </div>
        <Row label={t('Goal')} value={profile.goal === 'lose' ? t('Lose weight') : profile.goal === 'gain' ? t('Build up') : t('Stay steady')} />
        <Row label={t('Pace')} value={profile.goal === 'maintain' ? '—' : t('{pace} / week', { pace: formatPace(profile.pace, profile.units) })} />
        <Row label={t('Weight')} value={formatWeight(profile.weightKg, profile.units)} />
        <Row label={t('Goal weight')} value={formatWeight(profile.targetWeightKg, profile.units)} />
        <Row label={t('Height')} value={formatHeight(profile.heightCm, profile.units)} />
        <Row label={t('Country')} value={`${REGIONS[regionOf(profile)].flag} ${t(REGIONS[regionOf(profile)].name)}`} />
        <Row label={t('Language')} value={LANGUAGES[languageOf(profile)].native} />
        <Row label={t('Age')} value={`${profile.age}`} />
        <Row label={t('Activity')} value={ACTIVITY_LABEL[profile.activity]} />
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>{t('Squish AI')}</h3>
          <span className={`badge ${status?.ai ? 'badge--good' : 'badge--warn'}`}>
            <SparkIcon size={13} /> {status?.ai ? t('Connected') : t('Offline mode')}
          </span>
        </div>
        <p className="small muted">
          {status?.ai
            ? t('Photo analysis and coaching run on {model}. Your photos go to the Squish API server and are not stored.', { model: status.model })
            : t('No API key on the server, so meals are estimated from the built-in food table. Add ANTHROPIC_API_KEY to the server environment for real photo analysis.')}
        </p>
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>{t('Appearance')}</h3>
        </div>
        <Segmented
          label={t('Theme')}
          value={theme}
          onChange={(value) => useSquish.getState().setTheme(value)}
          options={[
            { value: 'light' as const, label: t('Light') },
            { value: 'dark' as const, label: t('Dark') },
            { value: 'system' as const, label: t('Auto') },
          ]}
        />
        {theme === 'system' && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {rich(prefersDark
              ? "Your browser is asking for <b>dark</b>, so that is what Auto gives you. On Android that comes from the phone's dark theme <em>or</em> from Chrome's own, under Settings → Theme — they are two separate switches."
              : "Your browser is asking for <b>light</b>, so that is what Auto gives you. On Android that comes from the phone's dark theme <em>or</em> from Chrome's own, under Settings → Theme — they are two separate switches.", {}, { b: (text) => <b>{text}</b>, em: (text) => <em>{text}</em> })}
          </p>
        )}

        <div className="divider" style={{ margin: '16px 0 12px' }} />

        <h4 className="small" style={{ marginBottom: 8 }}>
          {t('Food comparisons')}
        </h4>
        <Segmented
          label={t('Food comparisons')}
          value={comparisons === false ? 'off' : 'on'}
          onChange={(value) => useSquish.getState().setComparisons(value === 'on')}
          options={[
            { value: 'on' as const, label: t('On') },
            { value: 'off' as const, label: t('Off') },
          ]}
        />
        <p className="tiny muted" style={{ marginTop: 8 }}>
          {t('Lines like “the protein of 3 eggs” on your meals and your day — for the good stuff, never calories.')}
        </p>

        <div className="divider" style={{ margin: '16px 0 12px' }} />

        <h4 className="small">{t('How Squish looks')}</h4>
        <p className="tiny muted">{t('Earned by using the app.')}</p>
        <div className="looks" role="radiogroup" aria-label={t('How Squish looks')}>
          {LOOKS.map((entry) => {
            const earned = isUnlocked(entry, unlocked, subscribed);
            const chosen = entry.id === look;
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={`look look--colour${chosen ? ' look--on' : ''}${earned ? '' : ' look--locked'}`}
                // A locked one is not disabled: pressing it should say how to
                // get it, which is the only thing somebody wants to know.
                onClick={() => (earned ? setLook(entry.id) : toast(entry.how, '🔒'))}
                aria-label={earned ? entry.name : t('{name}, locked — {how}', { name: entry.name, how: entry.how })}
              >
                {/* Squish in the colour, like the finishes below: a dot of peach
                    says less about how Squish will look than Squish in peach. */}
                <Squish mood="excited" size={58} bob={false} look={entry.id} className="look-preview" label="" />
                <span className="tile-name">{entry.name}</span>
                {chosen ? <span className="tile-note">{t('Wearing')}</span> : !earned && <span className="tile-note">{entry.how}</span>}
              </button>
            );
          })}
        </div>

        <div className="row-between" style={{ marginTop: 16 }}>
          <h4 className="small">{PLUS}</h4>
          {!subscribed && <span className="badge">{t('Not yet')}</span>}
        </div>
        <p className="tiny muted">
          {subscribed
            ? t('Yours while your subscription is running.')
            : t('Rainbow, holographic, gold, chrome and more — coming when Squish Plus does. Nothing to buy yet.')}
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
                onClick={() => (earned ? setLook(entry.id) : toast(t('{item} comes with {plus}, which is not on sale yet.', { item: entry.name, plus: PLUS }), '✨'))}
                aria-label={earned ? entry.name : t('{name}, part of {plus}', { name: entry.name, plus: PLUS })}
              >
                {/* Squish wearing it, rather than a dot: a finish is the point, and a dot cannot show one. */}
                <Squish mood="excited" size={58} bob={false} look={entry.id} className="look-preview" label={t('Squish in {look}', { look: entry.name })} />
                <span className="tiny">{entry.name}</span>
              </button>
            );
          })}
        </div>

        <div className="divider" style={{ margin: '16px 0 12px' }} />

        <Wardrobe subscribed={subscribed} dark={(prefersDark && theme === 'system') || theme === 'dark'} />

        <div className="divider" style={{ margin: '16px 0 12px' }} />

        <ScenePicker subscribed={subscribed} dark={(prefersDark && theme === 'system') || theme === 'dark'} />

        <div className="divider" style={{ margin: '16px 0 12px' }} />

        <ShareCardLink />
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>{t('Your plates')}</h3>
        </div>
        {/* The single cheapest thing anyone can do for portion accuracy. A
            phone with a depth sensor measures the food; a photo has to measure
            it against something, and the plate is the ruler already in shot.

            Nothing is assumed, though. A wrong plate size is worse than none:
            the food gets scaled by the ratio, so a 27 cm guess about a 20 cm
            plate makes the portion almost twice what it was. */}
        <p className="tiny muted">
          {t('Measure a dinner plate across and tell Squish once. Most meals are eaten off the same few things, and a plate of known size is a ruler lying in every photo.')}
        </p>

        {measured ? (
          <>
            <div className="stack" style={{ marginTop: 10 }}>
              <div className="row-between">
                <span className="small">{t('Dinner plate')}</span>
                <Stepper
                  value={profile.plateCm ?? 27}
                  step={1}
                  min={15}
                  max={40}
                  onChange={(plateCm) => setProfile({ plateCm })}
                  suffix={t('cm across')}
                />
              </div>
              <div className="row-between">
                <span className="small">{t('Usual bowl')}</span>
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
                toast(t('Squish will judge portions on its own'), '🍽️');
              }}
            >
              {t('Forget my plate sizes')}
            </button>
          </>
        ) : (
          <>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              {rich('<b>Not set.</b> Squish is judging portions from the photo alone, which is what it has always done.', {}, { b: (text) => <b>{text}</b> })}
            </p>
            <button
              type="button"
              className="btn btn--soft btn--block"
              style={{ marginTop: 10 }}
              onClick={() => setProfile({ plateCm: 27, bowlMl: 400 })}
            >
              {t('Measure and set them')}
            </button>
          </>
        )}

        <p className="tiny muted" style={{ marginTop: 8 }}>
          {t('A standard dinner plate is about 27 cm; a side plate 20 cm. Only tell Squish a size you have actually measured — a wrong one makes portions worse, not better.')}
        </p>
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>{t('Meal reminders')}</h3>
          {reminders.on && <span className="badge badge--good">{t('On')}</span>}
        </div>

        {blocker === null ? (
          <p className="tiny muted">{t('Checking…')}</p>
        ) : blocker !== 'ok' ? (
          <p className="tiny muted">{explainBlocker(blocker)}</p>
        ) : (
          <>
            <p className="tiny muted">{t('A nudge at each mealtime, so a day does not quietly go unlogged.')}</p>
            <div className="stack" style={{ marginTop: 10 }}>
              {(['breakfast', 'lunch', 'dinner'] as const).map((meal) => (
                <div className="row-between" key={meal}>
                  <label className="small" htmlFor={`remind-${meal}`}>
                    {slotName(meal)}
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
              {savingReminders ? t('Just a moment…') : reminders.on ? t('Turn reminders off') : t('Turn reminders on')}
            </button>

            {reminders.on && (
              <p className="tiny muted" style={{ marginTop: 8 }}>
                {t('Changed a time? Press the button twice to send the new times over.')}
              </p>
            )}
          </>
        )}
      </section>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>{t('What the nutritionist remembers')}</h3>
          {nutritionistNotes.length > 0 && <span className="badge">{nutritionistNotes.length}</span>}
        </div>

        {nutritionistNotes.length === 0 ? (
          <p className="tiny muted">
            {t('Nothing yet. Tell it something worth keeping — an allergy, a food you will not eat, what you are training for — and it will note it down and remember next time.')}
          </p>
        ) : (
          <>
            <p className="tiny muted">{t('Its own notes, kept in this browser with everything else. Delete any of them.')}</p>
            <div className="stack" style={{ marginTop: 10 }}>
              {nutritionistNotes.map((note) => (
                <div className="row-between" key={note.id}>
                  <span className="small">{note.note}</span>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost"
                    aria-label={t('Forget: {note}', { note: note.note })}
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

      {/*
        Only where the server says so, and the server decides again on every
        request — hiding this is a convenience, never the lock.
      */}
      {standing.admin && (
        <section className="card card--quiet">
          <div className="card-title">
            <h3>{t('Dashboard')}</h3>
          </div>
          <p className="tiny muted">{t('Who is signed up, what they are on, and what it is costing.')}</p>
          <button type="button" className="btn btn--sm" style={{ marginTop: 12 }} onClick={() => go({ name: 'admin' })}>
            {t('Open the dashboard')}
          </button>
        </section>
      )}

      <PlanCard standing={standing} />

      <InviteCard />

      <SquadCard />

      <AccountCard enabled={backup.kind !== 'off'} />

      <BackupCard />

      <section className="card card--quiet">
        <div className="card-title">
          <h3>{t('Your data')}</h3>
        </div>
        <p className="small muted">
          {backup.kind === 'off'
            ? t('Everything lives in this browser. Nothing is uploaded except the photo you choose to analyse.')
            : t('Your diary lives in this browser. A copy is kept on the Squish server so you can get it back, along with any photo you choose to analyse. Nothing else leaves this device.')}
        </p>
        <div className="row" style={{ gap: 10, marginTop: 12 }}>
          <button type="button" className="btn btn--ghost grow" onClick={exportData}>
            {t('Export JSON')}
          </button>
          <button type="button" className="btn btn--danger grow" onClick={() => setConfirmReset(true)}>
            {t('Reset')}
          </button>
        </div>
        {/*
          Served by the server rather than routed inside the app, so it opens
          for somebody who has not installed the app or made an account —
          which is the whole point of publishing a policy.
        */}
        <p className="tiny muted" style={{ marginTop: 12 }}>
          {rich('<link>Privacy policy</link> — what is kept, where it goes, and how to get rid of it.', {}, {
            link: (text) => (
              <a href={apiUrl('/privacy')} target="_blank" rel="noopener noreferrer">
                {text}
              </a>
            ),
          })}
        </p>
      </section>

      <p className="script center you-footer">{t('Small steps. Big progress. ♡')}</p>

      <Sheet open={editing} onClose={() => setEditing(false)} title={t('About you')}>
        <div className="stack">
          <div className="field">
            <label htmlFor="you-name">{t('Name')}</label>
            <input id="you-name" className="input" value={profile.name} onChange={(e) => setProfile({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>{t('Goal')}</label>
            <Segmented<Goal>
              value={profile.goal}
              onChange={(goal) => setProfile({ goal })}
              options={[
                { value: 'lose', label: t('Lose') },
                { value: 'maintain', label: t('Eat healthy') },
                { value: 'gain', label: t('Gain') },
              ]}
            />
          </div>
          {profile.goal !== 'maintain' && (
            <div className="row-between">
              <span className="small">{t('Pace ({unit}/week)', { unit: weightUnitLabel(profile.units) })}</span>
              <Stepper
                value={paceIn(profile.pace, profile.units)}
                step={PACE_CHOICES[profile.units].step}
                min={PACE_CHOICES[profile.units].min}
                max={PACE_CHOICES[profile.units].max}
                onChange={(pace) => setProfile({ pace: paceToKg(pace, profile.units) })}
              />
            </div>
          )}
          <RegionField value={regionOf(profile)} onChange={(region) => setProfile({ region, energy: undefined })} />
          <LanguageField
            value={languageOf(profile)}
            onChange={(language) => {
              // The words are loaded before the app is drawn, so a new language starts it again.
              setProfile({ language });
              location.reload();
            }}
            hint={t('The whole app, and everything its AI writes. Changing it restarts Squish.')}
          />
          <div className="field">
            <label>{t('Units')}</label>
            <Segmented
              value={profile.units}
              onChange={(units) => setProfile(retuneForUnits(profile, units))}
              options={[
                { value: 'metric' as const, label: 'cm / kg' },
                { value: 'imperial' as const, label: imperialLabel() },
              ]}
            />
          </div>
          <div className="field">
            <label>{t('Energy')}</label>
            <Segmented<EnergyUnit>
              value={energyUnitOf(profile)}
              onChange={(energy) => setProfile({ energy: energy === REGIONS[regionOf(profile)].energy ? undefined : energy })}
              options={[
                { value: 'kcal', label: t('Calories (kcal)') },
                { value: 'kJ', label: t('Kilojoules (kJ)') },
              ]}
            />
          </div>
          <WeightField label={t('Weight')} kg={profile.weightKg} units={profile.units} onChange={(weightKg) => setProfile({ weightKg })} />
          <WeightField
            label={t('Goal weight')}
            kg={profile.targetWeightKg}
            units={profile.units}
            onChange={(targetWeightKg) => setProfile({ targetWeightKg })}
          />
          <HeightField cm={profile.heightCm} units={profile.units} onChange={(heightCm) => setProfile({ heightCm })} />
          <NumberField
            label={t('Age')}
            value={profile.age}
            suffix={t('yrs')}
            min={MIN_AGE}
            max={100}
            onChange={(age) => setProfile({ age })}
            onBelowMin={() => toast(t('Squish is for people aged {age} and over, so your age has not been changed.', { age: MIN_AGE }), '🫧')}
          />
          <div className="field">
            <label>{t('Sex (for the energy formula)')}</label>
            <Segmented<Sex>
              value={profile.sex}
              onChange={(sex) => setProfile({ sex })}
              options={[
                { value: 'female', label: t('Female') },
                { value: 'male', label: t('Male') },
                { value: 'other', label: t('Other') },
              ]}
            />
          </div>
          <div className="field">
            <label>{t('Activity')}</label>
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
          <button type="button" className="btn btn--block" onClick={() => { setEditing(false); toast(t('Plan updated'), '✅'); }}>
            {t('Done')}
          </button>
        </div>
      </Sheet>

      <Sheet open={editingTargets} onClose={() => setEditingTargets(false)} title={t('Adjust targets')}>
        <div className="stack">
          <p className="small muted">{t('Override anything Squish suggested — handy if a coach or dietitian set your numbers.')}</p>
          <div className="row-between">
            <span className="small">{energyUnitOf(profile) === 'kJ' ? t('Energy') : t('Calories')}</span>
            {energyUnitOf(profile) === 'kJ' ? (
              <Stepper
                value={energyValue(targets.calories, 'kJ')}
                step={200}
                min={4200}
                max={20900}
                onChange={(kj) => setTargets({ calories: toKcal(kj, 'kJ') })}
                suffix="kJ"
              />
            ) : (
              <Stepper value={targets.calories} step={50} min={1000} max={5000} onChange={(calories) => setTargets({ calories })} />
            )}
          </div>
          <div className="row-between">
            <span className="small">{t('Protein')}</span>
            <Stepper value={targets.protein} step={5} min={30} max={300} onChange={(protein) => setTargets({ protein })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">{t('Carbs')}</span>
            <Stepper value={targets.carbs} step={10} min={40} max={600} onChange={(carbs) => setTargets({ carbs })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">{t('Fat')}</span>
            <Stepper value={targets.fat} step={5} min={20} max={200} onChange={(fat) => setTargets({ fat })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">
              {t('Saturates')}
              <span className="tiny muted"> · {t('a daily limit')}</span>
            </span>
            <Stepper value={targets.satFat ?? 0} step={1} min={0} max={80} onChange={(satFat) => setTargets({ satFat })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">{MACRO_LABEL.fibre}</span>
            <Stepper value={targets.fibre} step={1} min={10} max={60} onChange={(fibre) => setTargets({ fibre })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">
              {t('Sugar')}
              <span className="tiny muted"> · {t('a daily limit')}</span>
            </span>
            <Stepper value={targets.sugar ?? 0} step={5} min={0} max={200} onChange={(sugar) => setTargets({ sugar })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">
              {t('Free sugars')}
              <span className="tiny muted"> · {t('added, honey and juice')}</span>
            </span>
            <Stepper value={targets.freeSugar ?? 0} step={5} min={0} max={200} onChange={(freeSugar) => setTargets({ freeSugar })} suffix="g" />
          </div>
          <div className="row-between">
            <span className="small">
              {saltLabel()}
              <span className="tiny muted"> · {t('a daily limit')}</span>
            </span>
            {showsSodium() ? (
              <Stepper
                value={saltShown(targets.sodium ?? 0)}
                step={100}
                min={0}
                max={6000}
                onChange={(sodium) => setTargets({ sodium: sodiumFromShown(sodium) })}
                suffix="mg"
              />
            ) : (
              <Stepper
                value={saltGrams(targets.sodium ?? 0)}
                step={0.5}
                min={0}
                max={15}
                onChange={(salt) => setTargets({ sodium: sodiumMg(salt) })}
                suffix="g"
              />
            )}
          </div>
          <div className="row-between">
            <span className="small">
              {t('Water')}
              <span className="tiny muted"> · {t('{ml} ml a glass', { ml: GLASS_ML })}</span>
            </span>
            <Stepper value={targets.water} min={4} max={20} onChange={(water) => setTargets({ water })} suffix={t('glasses')} />
          </div>
          <div className="row-between">
            <span className="small">{t('Steps')}</span>
            <Stepper value={targets.steps} step={500} min={2000} max={30000} onChange={(steps) => setTargets({ steps })} />
          </div>
          <button type="button" className="btn btn--block" onClick={() => setEditingTargets(false)}>
            {t('Done')}
          </button>
        </div>
      </Sheet>

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title={t('Start over?')}>
        <p className="small muted">
          {backup.kind === 'off'
            ? t('This clears every meal, day log and badge on this device. It cannot be undone.')
            : t('This clears every meal, day log and badge on this device, and deletes the backup too. It cannot be undone.')}
        </p>
        <div className="row" style={{ gap: 10, marginTop: 16 }}>
          <button type="button" className="btn btn--ghost grow" onClick={() => setConfirmReset(false)}>
            {t('Keep my data')}
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
              toast(t('All cleared'), '🧼');
            }}
          >
            {t('Delete everything')}
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
  const meals = useSquish((s) => s.meals);
  const here = useMemo(() => summariseDiary({ meals }), [meals]);

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
      toast(t('There is no backup to restore.'), '📦');
      return;
    }
    setBusy(true);
    adoptBackup(found);
    setBusy(false);
    toast(t('Restored from your backup.'), '📦');
  };

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>{t('Backup')}</h3>
        {state.kind === 'saving' && <span className="badge">{t('Saving…')}</span>}
        {state.kind === 'conflict' && <span className="badge badge--warn">{t('Paused')}</span>}
        {state.kind === 'failed' && <span className="badge badge--warn">{t('Offline')}</span>}
        {state.kind === 'too_big' && <span className="badge badge--bad">{t('Too large')}</span>}
      </div>

      {state.kind === 'too_big' ? (
        <p className="tiny muted">
          {t('Your diary has grown past what the backup will hold, so it has stopped. Nothing on this device has been lost and nothing is wrong with your connection — the copy on the server is simply older than your diary now. Deleting some older meals, particularly photographed ones, will let it start again.')}
        </p>
      ) : state.kind === 'conflict' ? (
        <>
          <p className="tiny muted">
            {t('Another device has backed up something this one has not seen. Squish will not merge two diaries — that means guessing whether two similar lunches are one lunch logged twice — so backing up has stopped until you say which to keep.')}
          </p>
          {remote && <Choices here={here} backup={summariseDiary(remote.state)} savedAt={remote.updatedAt} />}
        </>
      ) : (
        <p className="tiny muted">
          {t('A copy of your diary is kept so a cleared browser or a lost phone is an inconvenience rather than the end of it. Your diary still lives on this device; this is the spare.')}
        </p>
      )}

      {remote?.updatedAt && state.kind !== 'conflict' && (
        <p className="tiny muted" style={{ marginTop: 8 }}>
          {t('Last kept {date}.', { date: friendlyDate(remote.updatedAt.slice(0, 10)).toLocaleLowerCase() })}
        </p>
      )}

      {/* Two equal buttons for a choice between two diaries: neither is the one Squish would pick. */}
      <div className={state.kind === 'conflict' ? 'backup-actions backup-actions--choose' : 'row'} style={{ gap: 10, marginTop: 12 }}>
        <button type="button" className="btn btn--sm btn--ghost grow" disabled={busy || !remote} onClick={() => void restore()}>
          {state.kind === 'conflict'
            ? remote
              ? t('Use the backup ({meals})', { meals: mealCount(summariseDiary(remote.state).meals) })
              : t('Use the backup')
            : t('Restore from backup')}
        </button>
        {state.kind === 'conflict' && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => { resumeBackup(remote?.version ?? null); toast(t('Keeping this one.'), '📦'); }}>
            {t("Keep this device's ({meals})", { meals: mealCount(here.meals) })}
          </button>
        )}
      </div>
    </section>
  );
}

const mealCount = (n: number) => plural(n, { one: '{n} meal', other: '{n} meals' });

const lastLogged = (summary: DiarySummary) =>
  summary.latest ? t(', the latest {date}', { date: friendlyDate(summary.latest).toLocaleLowerCase() }) : '';

/**
 * The two diaries side by side, so choosing between them is a matter of
 * looking rather than going to find the other device. Where one of them is
 * empty, it says which to keep.
 */
function Choices({ here, backup, savedAt }: { here: DiarySummary; backup: DiarySummary; savedAt: string | null }) {
  const hint =
    here.meals === 0 && backup.meals > 0
      ? t('This device has no meals in it, so the backup is almost certainly the one to keep.')
      : backup.meals === 0 && here.meals > 0
        ? t('The backup has no meals in it, so this device’s diary is almost certainly the one to keep.')
        : t('Keep the one with your meals in it. The other is replaced, so anything only in that one is lost.');
  return (
    <div className="backup-choices">
      <dl>
        <div>
          <dt className="tiny muted">
            {savedAt ? t('The backup, saved {date}', { date: friendlyDate(savedAt.slice(0, 10)).toLocaleLowerCase() }) : t('The backup')}
          </dt>
          <dd className="small">
            <b>{mealCount(backup.meals)}</b>
            {lastLogged(backup)}
          </dd>
        </div>
        <div>
          <dt className="tiny muted">{t('This device')}</dt>
          <dd className="small">
            <b>{mealCount(here.meals)}</b>
            {lastLogged(here)}
          </dd>
        </div>
      </dl>
      <p className="tiny muted">{hint}</p>
    </div>
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
    { label: t('AI meal analyses'), kind: 'photo' },
    { label: t('Nutritionist questions'), kind: 'chat' },
    { label: t('Recipe imports'), kind: 'recipe' },
  ];

  return (
    <section className="card card--quiet">
      <div className="card-title">
        {/* Not "Your plan" — the targets card above already is. */}
        <h3>{t('Plan and usage')}</h3>
        <span className={`badge ${plus ? 'badge--good' : ''}`}>{plus ? PLUS : t('Free')}</span>
      </div>

      <div className="plan-rows">
        {rows.map((row) => (
          <div className="plan-row" key={row.kind}>
            <span className="tiny">{row.label}</span>
            <b className="small">
              {row.kind === 'photo' && standing.needsAccount ? (
                <span className="muted">{t('{n} free with an account', { n: standing.taste })}</span>
              ) : standing.allowance[row.kind] === 0 ? (
                <span className="muted">{PLUS}</span>
              ) : plus ? (
                t('{left} of {total} left', { left: standing.left[row.kind], total: standing.allowance[row.kind] })
              ) : (
                t('{left} of {total} free left', { left: standing.left[row.kind], total: standing.allowance[row.kind] })
              )}
            </b>
          </div>
        ))}
      </div>

      <p className="tiny muted" style={{ marginTop: 10 }}>
        {plus && standing.resets
          ? t('The month starts again on {date}.', { date: friendlyDate(standing.resets.slice(0, 10)).toLocaleLowerCase() })
          : standing.needsAccount
            ? t('Make a free account below to try {n} AI meal analyses.', { n: standing.taste })
            : t('The free analyses are a one-off taste of the AI; they do not reset.')}{' '}
        {t('Logging by hand, food search, your diary and the charts are free and always will be.')}
      </p>

      {standing.invites && <InviteBox signedIn={standing.account} />}
    </section>
  );
}

/**
 * Somewhere to type a code that turns Plus on.
 *
 * Only shown where codes exist, so an app with none does not advertise a box
 * that can never work. It needs an account first, and says so rather than
 * failing at the point of use — Plus lives on an account because a
 * subscription kept in a browser disappears when somebody clears it.
 */
function InviteBox({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const toast = useToast();

  if (!open) {
    return (
      <button type="button" className="linkish tiny plan-invite-open" onClick={() => setOpen(true)}>
        {t('I have a code')}
      </button>
    );
  }

  if (!signedIn) {
    return (
      <p className="tiny muted plan-invite">
        {t('Make an account first — that is where {plus} lives, so it follows you to a new phone instead of vanishing with this browser.', { plus: PLUS })}
      </p>
    );
  }

  const go = async () => {
    setBusy(true);
    setTrouble(null);
    const done = await redeemInvite(code);
    setBusy(false);
    if (!done.ok) {
      setTrouble(done.message);
      return;
    }
    setOpen(false);
    setCode('');
    toast(t('That is {plus} switched on. Enjoy.', { plus: PLUS }), '🎉');
  };

  return (
    <form
      className="plan-invite"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input grow"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder={t('Your code')}
          aria-label={t('Invite code')}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn--sm" disabled={busy || !code.trim()}>
          {busy ? '…' : t('Use it')}
        </button>
      </div>
      {trouble && (
        <p className="tiny account-trouble" role="alert">
          {trouble}
        </p>
      )}
    </form>
  );
}

/**
 * What Squish wears: one thing on the head, the face and the neck.
 *
 * Sorted by how you get them, not by slot: yours first, then what you can
 * earn, then Plus, then each pack. Every tile says what the item is; how to
 * get it is said once, in the heading, except where each item differs (what
 * to earn it with, which season). At the top, Squish in what is on now.
 */
function Wardrobe({ subscribed, dark }: { subscribed: boolean; dark: boolean }) {
  const outfit = useSquish((s) => s.outfit);
  const unlocked = useSquish((s) => s.unlocked);
  const setOutfit = useSquish((s) => s.setOutfit);
  const toast = useToast();
  const today = new Date();
  const entitlement = { unlocked, subscribed, today };
  const worn = wearable(outfit, entitlement);
  const wearing = SLOTS.map(({ id }) => accessoryById(worn[id])?.name).filter(Boolean);
  const items = ACCESSORIES.filter((item) => onShow(item, today));

  return (
    <>
      <h4 className="small">{t('What Squish wears')}</h4>
      <div className="wardrobe-now">
        <Squish mood="excited" size={84} bob={false} label={t('Squish in what it is wearing now')} />
        <div>
          <p className="small">{wearing.length ? listWords(wearing as string[]) : t('Nothing on yet')}</p>
          <p className="tiny muted">{t('One thing each on the head, face and neck. Tap something you have to put it on; tap it again to take it off.')}</p>
        </div>
      </div>
      {shelves(items, entitlement).map((shelf) => (
        <Shelf key={shelf.key} title={shelf.title} kind={shelf.kind} subscribed={subscribed}>
          {shelf.kind === 'pack' ? (
            <div className="packs">
              {packsAmong(shelf.items).map((contents) => (
                <PackTile key={contents.pack} contents={contents} dark={dark} onTap={() => toast(packLocked(contents), '✨')} />
              ))}
            </div>
          ) : (
            <div className="looks">
              {shelf.items.map((item) => {
                const mine = shelf.kind === 'yours';
                const on = mine && worn[item.slot] === item.id;
                const note = on ? t('Wearing') : shelf.kind === 'earn' ? item.how : lockedNote(item.unlock);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={mine ? on : undefined}
                    className={`look look--wear${on ? ' look--on' : ''}${mine ? '' : ' look--locked'}`}
                    onClick={() => (mine ? setOutfit(toggle(outfit, item)) : toast(whyLocked(item, PLUS), shelf.kind === 'earn' ? '🔒' : '✨'))}
                    aria-label={mine ? item.name : t('{name}, locked — {how}', { name: item.name, how: item.how })}
                  >
                    <Squish mood="excited" size={58} bob={false} outfit={{ [item.slot]: item.id }} className="look-preview" label="" />
                    <span className="tile-name">{item.name}</span>
                    {note && <span className="tile-note">{note}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </Shelf>
      ))}
    </>
  );
}

/**
 * The place behind Squish on Home, sorted the same way as the wardrobe. A
 * thumbnail of each, cropped the way the card crops it, in the theme the app
 * is in — a night scene is half the point of the dark one.
 */
function ScenePicker({ subscribed, dark }: { subscribed: boolean; dark: boolean }) {
  const chosen = useSquish((s) => s.scene);
  const unlocked = useSquish((s) => s.unlocked);
  const setScene = useSquish((s) => s.setScene);
  const toast = useToast();
  const today = new Date();
  const entitlement = { unlocked, subscribed, today };
  const shown = SCENES.filter((scene) => sceneOnShow(scene, today));
  const current = shown.find((scene) => scene.id === chosen && canUseScene(scene, entitlement))?.id ?? '';
  // The plain card is always theirs, so there is always a Yours shelf to put it on.
  const groups = shelves(shown, entitlement);
  if (groups[0]?.kind !== 'yours') groups.unshift({ key: 'yours', kind: 'yours', title: t('Yours'), items: [] });

  const plain = (
    <button key="plain" type="button" aria-pressed={current === ''} className={`scene-tile${current === '' ? ' look--on' : ''}`} onClick={() => setScene('')}>
      <span className="scene-thumb scene-thumb--plain" aria-hidden="true" />
      <span className="tile-name">{t('Plain')}</span>
      {current === '' && <span className="tile-note">{t('Showing')}</span>}
    </button>
  );

  return (
    <>
      <h4 className="small">{t('Home scene')}</h4>
      <p className="tiny muted">{t('The place behind Squish on Home.')}</p>
      {groups.map((shelf) => (
        <Shelf key={shelf.key} title={shelf.title} kind={shelf.kind} subscribed={subscribed}>
          {shelf.kind === 'pack' ? (
            <div className="packs">
              {packsAmong(shelf.items).map((contents) => (
                <PackTile key={contents.pack} contents={contents} dark={dark} onTap={() => toast(packLocked(contents), '✨')} />
              ))}
            </div>
          ) : (
            <div className="scenes">
              {shelf.kind === 'yours' && plain}
              {shelf.items.map((scene) => {
                const mine = shelf.kind === 'yours';
                const on = current === scene.id;
                const note = on ? t('Showing') : shelf.kind === 'earn' ? scene.how : lockedNote(scene.unlock);
                return (
                  <button
                    key={scene.id}
                    type="button"
                    aria-pressed={mine ? on : undefined}
                    className={`scene-tile${on ? ' look--on' : ''}${mine ? '' : ' look--locked'}`}
                    onClick={() => (mine ? setScene(scene.id) : toast(whyLocked(scene, PLUS), shelf.kind === 'earn' ? '🔒' : '✨'))}
                    aria-label={mine ? scene.name : t('{name}, locked — {how}', { name: scene.name, how: scene.how })}
                  >
                    <img className="scene-thumb" src={sceneUrl(scene.id, dark ? 'dark' : 'light')} alt="" />
                    <span className="tile-name">{scene.name}</span>
                    {note && <span className="tile-note">{note}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </Shelf>
      ))}
    </>
  );
}

/**
 * The way in to the share card from here, where the rest of the dressing-up
 * lives: frames and stickers are chosen on the card itself, and until now the
 * only door to it was on Insights, and only with a streak running.
 */
function ShareCardLink() {
  const meals = useSquish((s) => s.meals);
  const targets = useSquish((s) => s.targets);
  const [open, setOpen] = useState(false);
  const today = isoDate();
  // The same card Insights makes on its weekly view.
  const data = useMemo(
    () =>
      shareStory({
        streak: streakOf(meals, today),
        best: bestStreak(meals),
        mealCount: meals.length,
        summary: summarise(series(meals, lastDays(7, today), targets), targets),
      }),
    [meals, targets, today],
  );

  return (
    <>
      <div className="row-between share-link">
        <div>
          <h4 className="small">{t('Frames and stickers')}</h4>
          <p className="tiny muted">{t('They go on the card you share — pick them there.')}</p>
        </div>
        <button type="button" className="btn btn--soft" onClick={() => setOpen(true)}>
          <ShareIcon size={18} /> {t('Share a card')}
        </button>
      </div>
      <ShareSheet open={open} onClose={() => setOpen(false)} data={data} />
    </>
  );
}
