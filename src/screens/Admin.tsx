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
import {
  createInvite,
  deleteInvite,
  fetchOverview,
  fetchPeople,
  setInviteDisabled,
  setPlan,
  type AdminAction,
  type Invite,
  type Overview,
  type Person,
} from '../lib/admin';
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

          <Invites
            invites={overview.invites}
            suggestion={overview.suggestion}
            onChanged={() => void load(search)}
          />

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

/**
 * Making and retiring invite codes.
 *
 * These were an environment variable for about a day, which meant every
 * change was a deploy and a code could never know how many people had used
 * it. Here a code is a row: it has a length, a limit, a note saying who it
 * was for, and a count of who took it up.
 *
 * Switching one off is offered before deleting it, and deleting is offered
 * last, because off is almost always what somebody means — and deleting does
 * not take back what the code already bought.
 */
function Invites({
  invites,
  suggestion,
  onChanged,
}: {
  invites: Invite[];
  suggestion: string;
  onChanged: () => void;
}) {
  const [code, setCode] = useState(suggestion);
  const [days, setDays] = useState(365);
  const [uses, setUses] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const toast = useToast();

  const make = async () => {
    setBusy(true);
    setTrouble(null);
    const made = await createInvite({
      code,
      days,
      uses: uses.trim() ? Number(uses) : null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (!made.ok) {
      setTrouble(made.message);
      return;
    }
    toast(`${made.invite.code} is live.`, '🎟️');
    setCode('');
    setNote('');
    setUses('');
    onChanged();
  };

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>Invite codes</h3>
      </div>

      {invites.length === 0 ? (
        <p className="tiny muted">None yet. Make one below and hand it to whoever should have Plus.</p>
      ) : (
        <div className="admin-invites">
          {invites.map((invite) => (
            <div className={`admin-invite${invite.disabled ? ' admin-invite--off' : ''}`} key={invite.code}>
              <div className="admin-invite-head">
                <code>{invite.code}</code>
                <span className="tiny muted">
                  {invite.used} used{invite.usesLeft !== null && ` · ${invite.usesLeft} left`}
                </span>
              </div>
              <p className="tiny muted">
                {invite.days} days{invite.note && ` · ${invite.note}`}
                {invite.disabled && ' · off'}
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={async () => {
                    await setInviteDisabled(invite.code, !invite.disabled);
                    onChanged();
                  }}
                >
                  {invite.disabled ? 'Turn on' : 'Turn off'}
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--quiet-danger"
                  onClick={async () => {
                    await deleteInvite(invite.code);
                    toast('Code deleted. Anybody who used it keeps their Plus.', '🗑️');
                    onChanged();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        className="admin-new-invite"
        onSubmit={(event) => {
          event.preventDefault();
          void make();
        }}
      >
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input grow"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="CODE"
            aria-label="New code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setCode(suggestion)}>
            Suggest
          </button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="tiny muted grow">
            Days
            <input
              className="input"
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              aria-label="Days each code is worth"
            />
          </label>
          <label className="tiny muted grow">
            Uses (blank = any)
            <input
              className="input"
              type="number"
              min={1}
              value={uses}
              onChange={(event) => setUses(event.target.value)}
              aria-label="How many times it can be used"
            />
          </label>
        </div>
        <input
          className="input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What it is for — only you see this"
          aria-label="Note"
        />
        {trouble && (
          <p className="tiny account-trouble" role="alert">
            {trouble}
          </p>
        )}
        <button type="submit" className="btn btn--sm" disabled={busy || !code.trim()}>
          {busy ? 'One moment…' : 'Make this code'}
        </button>
      </form>
    </section>
  );
}
