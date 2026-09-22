/**
 * The dashboard.
 *
 * Built for the person running Squish rather than the person using it, which
 * means it answers three questions and does not try to be a product: what is
 * this costing, who is signed up, and give that person Plus.
 *
 * Costs are what Anthropic actually charged, accumulated per call, not counts
 * multiplied by an assumed price. That distinction is the whole reason it is
 * worth looking at: "Plus is priced right" should be a measurement.
 *
 * It cannot show anybody's diary, and the server would not serve one if it
 * asked. Running a service means knowing somebody used eleven analyses; it
 * does not mean reading their lunch.
 */
import { useCallback, useEffect, useState } from 'react';
import { CloseIcon } from '../components/icons';
import { useToast } from '../components/ui';
import { PLUS } from '../lib/plan';
import { fetchOverview, fetchPeople, setPlan, type AdminAction, type Overview, type Person } from '../lib/admin';
import { friendlyDate } from '../lib/date';
import './admin.css';

const money = (usd: number) => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
const day = (iso: string | null) => (iso ? friendlyDate(iso.slice(0, 10)) : '—');

const KIND: Record<string, string> = { photo: 'Photo analyses', chat: 'Nutritionist', recipe: 'Recipe imports' };

export default function Admin({ onClose }: { onClose: () => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async (q: string) => {
    const [head, list] = await Promise.all([fetchOverview(), fetchPeople(q)]);
    if (head) setOverview(head);
    if (list) {
      setPeople(list.people);
      setActions(list.actions);
    }
  }, []);

  useEffect(() => {
    void load(search);
  }, [load, search]);

  const change = async (email: string, days: number) => {
    setBusy(email);
    const done = await setPlan(email, days);
    setBusy(null);
    if (!done.ok) {
      toast(done.message, '⚠️');
      return;
    }
    toast(days > 0 ? `${email} is on ${PLUS}.` : `${email} is back on free.`, days > 0 ? '🎉' : '↩️');
    await load(search);
  };

  return (
    <div className="screen admin">
      <header className="screen-head">
        <div>
          <h1>Dashboard</h1>
          <p>{overview ? `This month, ${overview.month}` : 'Loading…'}</p>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </header>

      {overview && (
        <>
          <section className="card card--quiet">
            <div className="admin-figures">
              <Figure label="Accounts" value={overview.accounts} />
              <Figure label={PLUS} value={overview.plus} />
              <Figure label="Devices" value={overview.devices} />
              <Figure label="Active" value={overview.activeThisMonth} />
            </div>
          </section>

          <section className="card card--quiet">
            <div className="card-title">
              <h3>What it cost</h3>
              <span className="badge">{money(overview.totalUsd)}</span>
            </div>
            {overview.spend.length === 0 ? (
              <p className="tiny muted">Nothing yet this month.</p>
            ) : (
              <div className="admin-rows">
                {overview.spend.map((row) => (
                  <div className="admin-row" key={row.kind}>
                    <span className="tiny">{KIND[row.kind] ?? row.kind}</span>
                    <span className="tiny muted">{row.calls} calls</span>
                    <b className="small">{money(row.usd)}</b>
                  </div>
                ))}
              </div>
            )}
            <p className="tiny muted" style={{ marginTop: 10 }}>
              What Anthropic charged, added up per call — not an estimate. Free gets{' '}
              {overview.allowances.free.photo} photos a month; {PLUS} gets {overview.allowances.plus.photo} and{' '}
              {overview.allowances.plus.chat} questions.
            </p>
          </section>

          <section className="card card--quiet">
            <div className="card-title">
              <h3>Invite codes</h3>
              <span className="badge">{overview.inviteDays} days each</span>
            </div>
            {overview.invites.length === 0 ? (
              <p className="tiny muted">
                None set. Add <code>SQUISH_INVITE_CODES</code> in the host's dashboard and they appear here.
              </p>
            ) : (
              <div className="admin-codes">
                {overview.invites.map((code) => (
                  <code key={code}>{code}</code>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <section className="card card--quiet">
        <div className="card-title">
          <h3>People</h3>
        </div>
        <input
          className="input"
          value={search}
          placeholder="Search by email…"
          aria-label="Search people"
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="admin-people">
          {people.length === 0 && <p className="tiny muted">Nobody yet.</p>}
          {people.map((person) => (
            <div className="admin-person" key={person.id}>
              <div className="admin-person-head">
                <b className="small">{person.email}</b>
                <span className={`badge ${person.plan === 'plus' ? 'badge--good' : ''}`}>
                  {person.plan === 'plus' ? PLUS : 'Free'}
                </span>
              </div>
              <p className="tiny muted">
                Joined {day(person.joined)}
                {person.plan === 'plus' && ` · until ${day(person.plusUntil)}`} · {person.used.photo} photos,{' '}
                {person.used.chat} questions this month · {money(person.usd)}
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  disabled={busy === person.email}
                  onClick={() => void change(person.email, 30)}
                >
                  +30 days
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  disabled={busy === person.email}
                  onClick={() => void change(person.email, 365)}
                >
                  +1 year
                </button>
                {person.plan === 'plus' && (
                  <button
                    type="button"
                    className="btn btn--sm btn--quiet-danger"
                    disabled={busy === person.email}
                    onClick={() => void change(person.email, 0)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {actions.length > 0 && (
        <section className="card card--quiet">
          <div className="card-title">
            <h3>What has been done</h3>
          </div>
          <div className="admin-rows">
            {actions.map((entry, index) => (
              <div className="admin-row" key={`${entry.at}-${index}`}>
                <span className="tiny">
                  {entry.action} {entry.subject}
                </span>
                <span className="tiny muted">{entry.detail ?? ''}</span>
                <span className="tiny muted">{day(entry.at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="tiny muted admin-foot">
        Counts and totals only. Nobody's diary is readable from here, by design — see docs/privacy.md.
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-figure">
      <b>{value}</b>
      <span className="tiny muted">{label}</span>
    </div>
  );
}
