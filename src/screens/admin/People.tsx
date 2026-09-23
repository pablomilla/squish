/**
 * People: who is signing up, what plan they are on, how far they get with
 * the free taste — and the list itself, for giving somebody Plus.
 */
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../components/ui';
import { PLUS } from '../../lib/plan';
import {
  createInvite,
  deleteInvite,
  fetchInvites,
  fetchPeople,
  setInviteDisabled,
  setPlan,
  type Invite,
  type Metrics,
  type Person,
} from '../../lib/admin';
import { friendlyDate } from '../../lib/date';
import { Chart, Funnel, SplitBar } from './charts';
import { count, longDay, pounds, shortDay } from './format';
import { Tile } from './Tiles';

const day = (iso: string | null) => (iso ? friendlyDate(iso.slice(0, 10)) : '—');
const usd = (value: number) => `$${value.toFixed(value < 1 ? 4 : 2)}`;

export default function People({ metrics, usdToGbp }: { metrics: Metrics | null; usdToGbp: number }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [invites, setInvites] = useState<{ invites: Invite[]; suggestion: string } | null>(null);
  const toast = useToast();

  const load = useCallback(async (q: string) => {
    const list = await fetchPeople(q);
    if (list) setPeople(list.people);
  }, []);

  const loadInvites = useCallback(async () => {
    const next = await fetchInvites();
    if (next) setInvites(next);
  }, []);

  useEffect(() => {
    void load(search);
  }, [load, search]);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

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

  const m = metrics;

  return (
    <div className="admin-section">
      {m && (
        <>
          <div className="tiles">
            <Tile label="Accounts" value={count(m.plans.accounts)} note="Everybody who has made one" />
            <Tile
              label={`New in ${m.days} days`}
              value={count(m.totals.signups)}
              now={m.totals.signups}
              before={m.previous.signups}
              days={m.days}
              spark={m.series.map((d) => d.signups)}
            />
            <Tile
              label="Using it without an account"
              value={count(m.plans.signedOutActive)}
              note={`Browsers seen in ${m.days} days`}
            />
          </div>

          <div className="admin-cols">
            <section className="card card--quiet">
              <div className="card-title">
                <h3>New accounts</h3>
                <span className="tiny muted">a day</span>
              </div>
              <Chart
                title={`New accounts a day, last ${m.days} days`}
                kind="bars"
                labels={m.series.map((d) => d.day)}
                series={[{ key: 'signups', label: 'New accounts', color: 'var(--dv-single)' }]}
                values={m.series.map((d) => [d.signups])}
                format={count}
                xFormat={shortDay}
                xLong={longDay}
              />
            </section>

            <section className="card card--quiet">
              <div className="card-title">
                <h3>Plans</h3>
              </div>
              <SplitBar
                label="Accounts by plan"
                parts={[
                  { key: 'free', label: 'Free', value: m.plans.free, color: 'var(--dv-muted)' },
                  { key: 'comped', label: `${PLUS}, given`, value: m.plans.compedPlus, color: 'var(--dv-2)' },
                  { key: 'paying', label: `${PLUS}, paying`, value: m.plans.payingPlus, color: 'var(--dv-1)' },
                ]}
              />
              <p className="tiny muted admin-note">
                Given means an invite code or a grant from here — testers, friends, press. Paying comes from the App Store
                and Google Play once {PLUS} is on sale.
              </p>
            </section>
          </div>

          <section className="card card--quiet">
            <div className="card-title">
              <h3>From account to paying</h3>
              <span className="tiny muted">everyone, all time</span>
            </div>
            <Funnel
              steps={[
                { label: 'Made an account', value: m.funnel.accounts, note: 'Where the taste starts' },
                { label: 'Tried a meal analysis', value: m.funnel.triedAi },
                { label: 'Used the whole free taste', value: m.funnel.usedTaste },
                { label: `On ${PLUS} now`, value: m.funnel.plus },
                { label: 'Have ever paid', value: m.funnel.paying },
              ]}
            />
            <p className="tiny muted admin-note">
              The taste is a one-off few analyses with an account. Somebody who uses all of it and does not upgrade is
              the person the upgrade screen is for; if many try it and few finish it, the analyses themselves are the
              thing to look at.
            </p>
          </section>
        </>
      )}

      <div className="admin-cols admin-cols--wide-first">
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
                  <b className="small">
                    {person.email}
                    {!person.verified && <span className="tiny muted admin-unconfirmed"> · unconfirmed</span>}
                  </b>
                  <span className={`badge ${person.plan === 'plus' ? 'badge--good' : ''}`}>
                    {person.plan === 'plus' ? PLUS : 'Free'}
                  </span>
                </div>
                <p className="tiny muted">
                  Joined {day(person.joined)}
                  {person.plan === 'plus' && ` · until ${day(person.plusUntil)}`} · {person.used.photo} photos,{' '}
                  {person.used.chat} questions this month · {usd(person.usd)} (≈{pounds(Math.round(person.usd * usdToGbp * 100))})
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


        {invites && (
          <Invites invites={invites.invites} suggestion={invites.suggestion} onChanged={() => void loadInvites()} />
        )}
      </div>
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

