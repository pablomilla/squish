/**
 * Which model does each AI job, for admins and for everybody, and which ones
 * back it up (server/routing.ts).
 *
 * Admins' routes are for trying things on their own meals; everybody's are
 * what is proven. On everybody's side a job that carries somebody's data can
 * only use Claude until SQUISH_GEMINI_FOR_EVERYONE is on — the server holds
 * to that whatever is sent, and this screen says so rather than offering it.
 */
import { useEffect, useState } from 'react';
import { useToast } from '../../components/ui';
import { fetchModelSettings, saveModelRoutes, type ModelAudience, type ModelRoutes, type ModelSettings } from '../../lib/admin';
import { modelLabel } from '../../lib/models';

const AUDIENCE_LABEL: Record<ModelAudience, string> = {
  admins: 'You and other admins',
  everyone: 'Everybody else',
};
const SLOT_LABEL = ['Model', 'Backup', 'Second backup'];
const dollars = (n: number) => `$${n < 1 ? n.toFixed(2) : n % 1 ? n.toFixed(2) : n}`;

export default function Models() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [draft, setDraft] = useState<ModelRoutes | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    void fetchModelSettings().then((found) => {
      if (!found) return;
      setSettings(found);
      setDraft(found.routes);
    });
  }, []);
  if (!settings || !draft) return null;

  const changed = JSON.stringify(draft) !== JSON.stringify(settings.routes);
  const model = (id: string) => settings.models.find((m) => m.id === id);

  /** Why a model cannot go in this place, or nothing. */
  const blocked = (id: string, personal: boolean, audience: ModelAudience): string | null => {
    const m = model(id);
    if (!m) return 'unknown';
    if (!m.ready) return m.provider === 'google' ? 'no GEMINI_API_KEY' : 'no Anthropic key';
    if (m.provider === 'google' && audience === 'everyone' && personal && !settings.everyoneMayUseGemini) return 'not on for everybody';
    return null;
  };

  const setSlot = (feature: keyof ModelRoutes, audience: ModelAudience, slot: number, id: string) => {
    const chain = [...draft[feature][audience]];
    chain[slot] = id;
    // "None" ends the chain there; a model already higher up is not asked twice.
    const next = chain.slice(0, id ? undefined : slot).filter((m, i, all) => m && all.indexOf(m) === i);
    setDraft({ ...draft, [feature]: { ...draft[feature], [audience]: next } });
  };

  const save = async () => {
    setBusy(true);
    const done = await saveModelRoutes(draft);
    setBusy(false);
    if (!done.ok) {
      toast(done.message, '⚠️');
      return;
    }
    setSettings({ ...settings, routes: done.routes });
    setDraft(done.routes);
    toast('Saved. The next request uses the new models.', '✅');
  };

  return (
    <section className="card card--quiet admin-models">
      <div className="card-title">
        <h3>AI models</h3>
        <span className="tiny muted">per job, with backups</span>
      </div>
      <p className="tiny muted">
        Each job asks its model first. If that fails — an outage, an overload, an answer that does not make sense — the backup is asked,
        then the second backup, so a bad hour at one company is a slower answer rather than a guess. Admins&rsquo; choices apply to your own
        accounts only, to try a model on your own meals; everybody else gets theirs.
        {!settings.everyoneMayUseGemini &&
          ' For everybody, jobs with their data stay on Claude until Gemini is switched on for everybody (SQUISH_GEMINI_FOR_EVERYONE=on in Render). The privacy policy already names Google.'}
      </p>

      <div className="admin-models-list">
        {settings.features.map((feature) => {
          const failures = settings.failures.filter((f) => f.feature === feature.id);
          return (
            <details className="admin-model-row" key={feature.id}>
              <summary className="admin-model-summary">
                <b className="small">{feature.label}</b>
                {(['admins', 'everyone'] as const).map((audience) => (
                  <span className="tiny muted" key={audience}>
                    {audience === 'admins' ? 'Admins' : 'Everybody'}: {draft[feature.id][audience].map(modelLabel).join(' → ')}
                  </span>
                ))}
                {failures.length > 0 && (
                  <span className="tiny admin-model-failed">⚠️ {failures.reduce((n, f) => n + f.failures, 0)} failed this week</span>
                )}
              </summary>
              <div className="admin-model-edit">
                <div className="admin-model-what">
                  <span className="tiny muted">{feature.detail}</span>
                  {failures.map((f) => (
                    <span className="tiny admin-model-failed" key={f.model} title={f.lastError}>
                      ⚠️ {modelLabel(f.model)} failed {f.failures}× this week
                      {f.rescued
                        ? `, ${f.rescued === f.failures ? 'every time' : `${f.rescued}×`} saved by a backup`
                        : ', with no backup to save it'}
                      {' — '}
                      {f.lastError}
                    </span>
                  ))}
                </div>
                {(['admins', 'everyone'] as const).map((audience) => (
                  <fieldset className="admin-model-chain" key={audience}>
                    <legend className="tiny muted">{AUDIENCE_LABEL[audience]}</legend>
                    {SLOT_LABEL.map((slotLabel, slot) => {
                      const chain = draft[feature.id][audience];
                      // A backup only once there is something to back up.
                      if (slot > chain.length) return null;
                      const value = chain[slot] ?? '';
                      return (
                        <label className="admin-model-slot" key={slot}>
                          <span className="tiny muted">{slotLabel}</span>
                          <select
                            className="input"
                            value={value}
                            onChange={(event) => setSlot(feature.id, audience, slot, event.target.value)}
                          >
                            {slot > 0 && <option value="">None</option>}
                            {(['anthropic', 'google'] as const).map((provider) => (
                              <optgroup key={provider} label={provider === 'anthropic' ? 'Claude (Anthropic)' : 'Gemini (Google)'}>
                                {settings.models
                                  .filter((m) => m.provider === provider)
                                  .map((m) => {
                                    const why = blocked(m.id, feature.personal, audience);
                                    return (
                                      <option key={m.id} value={m.id} disabled={Boolean(why) && m.id !== value}>
                                        {modelLabel(m.id)}
                                        {m.price ? ` · ${dollars(m.price.input)} / ${dollars(m.price.output)}` : ''}
                                        {why ? ` — ${why}` : ''}
                                      </option>
                                    );
                                  })}
                              </optgroup>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </fieldset>
                ))}
              </div>
            </details>
          );
        })}
      </div>

      <div className="row admin-models-actions">
        <span className="tiny muted">
          Prices are dollars per million tokens, in / out. Tap a job to change it. Changes are written to &ldquo;What has been done&rdquo;.
        </span>
        <button type="button" className="btn btn--sm" disabled={!changed || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save models'}
        </button>
      </div>
    </section>
  );
}
