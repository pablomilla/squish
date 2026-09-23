/**
 * Affiliates: people paid a share of what the subscribers they bring pay.
 *
 * Kept here rather than in an affiliate service because those services see
 * card payments through Stripe, and Squish is paid through the App Store and
 * Google Play, which tell nobody where a customer came from. So each
 * affiliate has a link; the account made from it remembers who sent it; and
 * commission is worked out from the payments the stores report. Money itself
 * moves by bank transfer — this is the book it is kept in.
 */
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../components/ui';
import { PLUS } from '../../lib/plan';
import { createAffiliate, fetchAffiliates, recordPayout, updateAffiliate, type Affiliate, type Payout } from '../../lib/admin';
import { friendlyDate } from '../../lib/date';
import { count, percent, pounds } from './format';
import { Tile } from './Tiles';

export default function Affiliates({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<{ affiliates: Affiliate[]; payouts: Payout[]; linkBase: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const next = await fetchAffiliates();
    if (next) setData(next);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changed = () => {
    void load();
    onChanged();
  };

  if (!data) return <p className="tiny muted">Loading…</p>;
  const all = data.affiliates;
  const sum = (pick: (a: Affiliate) => number) => all.reduce((s, a) => s + pick(a), 0);
  const names = Object.fromEntries(all.map((a) => [a.id, a.name]));

  return (
    <div className="admin-section">
      <div className="tiles">
        <Tile label="Affiliates" value={count(all.filter((a) => a.active).length)} note={`${count(all.length)} ever`} />
        <Tile label="Sign-ups from links" value={count(sum((a) => a.signups))} note={`from ${count(sum((a) => a.clicks))} visits`} />
        <Tile label="Paying through them" value={count(sum((a) => a.paying))} note={`${pounds(sum((a) => a.revenuePence))} brought in`} />
        <Tile label="Owed now" value={pounds(sum((a) => a.owedPence))} note={`${pounds(sum((a) => a.paidPence))} paid so far`} />
      </div>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>People who send people</h3>
          {!adding && (
            <button type="button" className="btn btn--sm" onClick={() => setAdding(true)}>
              Add an affiliate
            </button>
          )}
        </div>

        {adding && (
          <AffiliateForm
            onCancel={() => setAdding(false)}
            onSaved={() => {
              setAdding(false);
              changed();
            }}
          />
        )}

        {all.length === 0 && !adding ? (
          <p className="tiny muted">
            Nobody yet. Add somebody — a creator, a nutritionist, a friend with an audience — and they get a link of their
            own to share.
          </p>
        ) : (
          <div className="affiliates">
            {all.map((affiliate) => (
              <AffiliateCard key={affiliate.id} affiliate={affiliate} link={`${data.linkBase}${affiliate.code}`} onChanged={changed} />
            ))}
          </div>
        )}
      </section>

      <div className="admin-cols">
        <section className="card card--quiet">
          <div className="card-title">
            <h3>How it works</h3>
          </div>
          <ol className="how small">
            <li>Each affiliate gets a link: squish.online/r/THEIRCODE.</li>
            <li>Somebody who follows it has the code remembered in their browser for 30 days.</li>
            <li>If they make an account in that time, the account is credited to the affiliate — for good, and only to the first one.</li>
            <li>
              When that account pays for {PLUS}, the affiliate earns their share of what reaches Industry Logic, after VAT
              and the store's fee, for as many months as their terms say.
            </li>
            <li>Pay them by bank transfer, then record it here. What they are owed comes down by itself.</li>
          </ol>
          <p className="tiny muted admin-note">
            Affiliates see nothing from here and get no login: send them their numbers when you pay them. A code cannot be
            changed once made, because it is already printed in their links; switching somebody off stops new sign-ups
            counting, and keeps what they have earned.
          </p>
        </section>

        <section className="card card--quiet">
          <div className="card-title">
            <h3>Payments made</h3>
          </div>
          {data.payouts.length === 0 ? (
            <p className="tiny muted">None yet.</p>
          ) : (
            <div className="admin-rows">
              {data.payouts.map((payout) => (
                <div className="admin-row" key={payout.id}>
                  <span className="tiny">
                    {names[payout.affiliateId] ?? 'Someone'}
                    {payout.note && <span className="muted"> · {payout.note}</span>}
                  </span>
                  <b className="small">{pounds(payout.amountPence)}</b>
                  <span className="tiny muted">{friendlyDate(payout.paidAt.slice(0, 10))}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function AffiliateCard({ affiliate: a, link, onChanged }: { affiliate: Affiliate; link: string; onChanged: () => void }) {
  const [mode, setMode] = useState<'view' | 'pay' | 'edit'>('view');
  const toast = useToast();

  return (
    <article className={a.active ? 'affiliate' : 'affiliate affiliate--off'}>
      <div className="affiliate-head">
        <div>
          <b>{a.name}</b>
          <p className="tiny muted">
            {percent(a.rate)} for {a.months} months{a.email && ` · ${a.email}`}
            {!a.active && ' · switched off'}
          </p>
        </div>
        <code className="affiliate-code">{a.code}</code>
      </div>

      <div className="affiliate-link">
        <input className="input" readOnly value={link} aria-label={`${a.name}'s link`} onFocus={(event) => event.target.select()} />
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              toast('Link copied.', '🔗');
            } catch {
              toast('Select the link and copy it.', '🔗');
            }
          }}
        >
          Copy
        </button>
      </div>

      <dl className="affiliate-stats">
        <div>
          <dt>Visits</dt>
          <dd>{count(a.clicks)}</dd>
        </div>
        <div>
          <dt>Sign-ups</dt>
          <dd>{count(a.signups)}</dd>
        </div>
        <div>
          <dt>Paying</dt>
          <dd>{count(a.paying)}</dd>
        </div>
        <div>
          <dt>Brought in</dt>
          <dd>{pounds(a.revenuePence)}</dd>
        </div>
        <div>
          <dt>Earned</dt>
          <dd>{pounds(a.earnedPence)}</dd>
        </div>
        <div>
          <dt>Owed</dt>
          <dd>
            <b>{pounds(a.owedPence)}</b>
          </dd>
        </div>
      </dl>
      {a.note && <p className="tiny muted">{a.note}</p>}

      {mode === 'pay' && (
        <PayoutForm
          affiliate={a}
          onCancel={() => setMode('view')}
          onSaved={() => {
            setMode('view');
            onChanged();
          }}
        />
      )}
      {mode === 'edit' && (
        <AffiliateForm
          existing={a}
          onCancel={() => setMode('view')}
          onSaved={() => {
            setMode('view');
            onChanged();
          }}
        />
      )}
      {mode === 'view' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setMode('pay')}>
            Record a payment
          </button>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setMode('edit')}>
            Edit
          </button>
          <button
            type="button"
            className={a.active ? 'btn btn--sm btn--quiet-danger' : 'btn btn--sm btn--ghost'}
            onClick={async () => {
              if (a.active && !window.confirm(`Switch ${a.name} off? New sign-ups from their link stop counting; what they have earned stays theirs.`)) return;
              const done = await updateAffiliate(a.id, { active: !a.active });
              if (!done.ok) toast(done.message, '⚠️');
              onChanged();
            }}
          >
            {a.active ? 'Switch off' : 'Switch on'}
          </button>
        </div>
      )}
    </article>
  );
}

function PayoutForm({ affiliate, onSaved, onCancel }: { affiliate: Affiliate; onSaved: () => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(affiliate.owedPence > 0 ? (affiliate.owedPence / 100).toFixed(2) : '');
  const [note, setNote] = useState('');
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  return (
    <form
      className="inline-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const done = await recordPayout(affiliate.id, Number(amount), note);
        setBusy(false);
        if (!done.ok) {
          setTrouble(done.message);
          return;
        }
        toast(`Recorded £${Number(amount).toFixed(2)} to ${affiliate.name}.`, '💷');
        onSaved();
      }}
    >
      <div className="row" style={{ gap: 8 }}>
        <label className="tiny muted grow">
          Paid, £
          <input className="input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label className="tiny muted grow">
          Note
          <input className="input" value={note} placeholder="Bank transfer, 30 Sep" onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      {trouble && (
        <p className="tiny account-trouble" role="alert">
          {trouble}
        </p>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn--sm" disabled={busy || !(Number(amount) > 0)}>
          {busy ? 'Saving…' : 'Record it'}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AffiliateForm({ existing, onSaved, onCancel }: { existing?: Affiliate; onSaved: () => void; onCancel: () => void }) {
  const [draft, setDraft] = useState({
    name: existing?.name ?? '',
    code: existing?.code ?? '',
    email: existing?.email ?? '',
    rate: String(Math.round((existing?.rate ?? 0.3) * 1000) / 10),
    months: String(existing?.months ?? 12),
    note: existing?.note ?? '',
  });
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (change: Partial<typeof draft>) => setDraft({ ...draft, ...change });

  return (
    <form
      className="inline-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setTrouble(null);
        const input = { ...draft, rate: Number(draft.rate) / 100, months: Number(draft.months) };
        const done = existing ? await updateAffiliate(existing.id, input) : await createAffiliate(input);
        setBusy(false);
        if (!done.ok) {
          setTrouble(done.message);
          return;
        }
        toast(existing ? 'Saved.' : `${draft.name} is set up. Copy their link below.`, '🤝');
        onSaved();
      }}
    >
      <div className="row" style={{ gap: 8 }}>
        <label className="tiny muted grow">
          Name
          <input className="input" value={draft.name} onChange={(event) => set({ name: event.target.value })} />
        </label>
        <label className="tiny muted grow">
          Code {existing && '(fixed)'}
          <input
            className="input"
            value={draft.code}
            disabled={Boolean(existing)}
            placeholder="SAM"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
          />
        </label>
      </div>
      <label className="tiny muted">
        Email, for your records
        <input className="input" type="email" value={draft.email} onChange={(event) => set({ email: event.target.value })} />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <label className="tiny muted grow">
          Share, %
          <input className="input" inputMode="decimal" value={draft.rate} onChange={(event) => set({ rate: event.target.value })} />
        </label>
        <label className="tiny muted grow">
          For how many months
          <input className="input" inputMode="numeric" value={draft.months} onChange={(event) => set({ months: event.target.value })} />
        </label>
      </div>
      <label className="tiny muted">
        Note — only you see this
        <input className="input" value={draft.note} onChange={(event) => set({ note: event.target.value })} />
      </label>
      <p className="tiny muted">
        The share is of what reaches Industry Logic after VAT and the store's fee — on a £6.99 month, about{' '}
        {pounds(Math.round(495 * (Number(draft.rate) / 100 || 0)))}.
      </p>
      {trouble && (
        <p className="tiny account-trouble" role="alert">
          {trouble}
        </p>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn--sm" disabled={busy || !draft.name.trim() || !draft.code.trim()}>
          {busy ? 'Saving…' : existing ? 'Save' : 'Add them'}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
