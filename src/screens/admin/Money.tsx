/**
 * Money: a month's profit and loss, the months before it, what Squish costs
 * to exist, and the numbers the sums are done with.
 *
 * Revenue comes only from the payments ledger — what the App Store and Google
 * Play report — so until Plus is on sale it is nought, and the page says so
 * rather than filling the gap with a guess. The one guess on the page is
 * labelled a projection and kept apart from the statement.
 */
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../components/ui';
import { PLUS } from '../../lib/plan';
import {
  addCost,
  fetchFinance,
  removeCost,
  saveSettings,
  updateCost,
  type CostInput,
  type Finance,
  type FinanceSettings,
  type FixedCost,
} from '../../lib/admin';
import { Chart } from './charts';
import { KIND_LABEL, count, monthName, percent, pounds, shiftMonth, shortMonth } from './format';
import { BreakEven } from './Overview';
import { Alert } from './Tiles';

export default function Money({ initial, onChanged }: { initial: Finance | null; onChanged: () => void }) {
  const [finance, setFinance] = useState<Finance | null>(initial);
  const [month, setMonth] = useState<string | null>(initial?.month.month ?? null);
  const thisMonth = initial?.month.month ?? new Date().toISOString().slice(0, 7);

  const load = useCallback(async (which: string | null) => {
    const next = await fetchFinance(which ?? undefined);
    if (next) setFinance(next);
  }, []);

  useEffect(() => {
    void load(month);
  }, [load, month]);

  const refresh = () => {
    void load(month);
    onChanged();
  };

  if (!finance) return <p className="tiny muted">Loading…</p>;
  const f = finance;
  const p = f.month;

  return (
    <div className="admin-section">
      <div className="month-picker">
        <button type="button" className="btn btn--sm btn--ghost" aria-label="The month before" onClick={() => setMonth(shiftMonth(p.month, -1))}>
          ‹
        </button>
        <b>{monthName(p.month)}</b>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          aria-label="The month after"
          disabled={p.month >= thisMonth}
          onClick={() => setMonth(shiftMonth(p.month, 1))}
        >
          ›
        </button>
        {p.current && <span className="tiny muted">so far</span>}
      </div>

      {!f.onSale && (
        <Alert tone="info" title={`${PLUS} is not on sale yet, so there is no revenue to show`}>
          The costs here are real. Revenue will arrive from the App Store and Google Play once the phone apps are out,
          and appear here by itself.
        </Alert>
      )}

      <div className="admin-cols">
        <section className="card card--quiet">
          <div className="card-title">
            <h3>Profit and loss</h3>
          </div>
          <table className="pnl">
            <tbody>
              <Line label={`Sales, ${count(p.payments)} payments`} pence={p.grossPence} />
              <Line label={`VAT (${percent(f.settings.vat)})`} pence={-p.vatPence} sub />
              <Line label="App Store and Google Play fees" pence={-p.storeFeePence} sub />
              {p.refundsPence > 0 && <Line label="Refunds" pence={-p.refundsPence} sub />}
              <Line label="Revenue" pence={p.netPence} total />
              <Line label="Affiliate commission" pence={-p.commissionPence} sub />
              {p.aiByKind.length === 0 ? (
                <Line label="AI" pence={0} sub />
              ) : (
                p.aiByKind.map((k) => (
                  <Line key={k.kind} label={`AI — ${KIND_LABEL[k.kind] ?? k.kind} (${count(k.calls)})`} pence={-k.pence} sub />
                ))
              )}
              <Line label="Hosting, fees and subscriptions" pence={-p.fixedPence} sub />
              <Line label={p.profitPence >= 0 ? 'Profit' : 'Loss'} pence={p.profitPence} total strong />
            </tbody>
          </table>
          <p className="tiny muted admin-note">
            Sales are what customers paid; revenue is what reached Industry Logic. AI is what Anthropic charged, call by
            call, at {f.settings.usdToGbp} pounds to the dollar. Hosting and fees are the list below, as a month's share.
            Before corporation tax.
          </p>
        </section>

        <div className="admin-col">
          <section className="card card--quiet">
            <div className="card-title">
              <h3>Subscribers</h3>
            </div>
            <div className="glance">
              <div className="glance-item">
                <span className="tiny muted">Paying now</span>
                <b>{count(f.paying.accounts)}</b>
                <span className="tiny muted">
                  {count(f.paying.monthly)} monthly · {count(f.paying.yearly)} yearly
                </span>
              </div>
              <div className="glance-item">
                <span className="tiny muted">Monthly recurring revenue</span>
                <b>{pounds(f.paying.mrrPence)}</b>
                <span className="tiny muted">yearly counted as a twelfth</span>
              </div>
              <div className="glance-item">
                <span className="tiny muted">{PLUS}, given</span>
                <b>{count(f.compedPlus)}</b>
                <span className="tiny muted">invite codes and grants</span>
              </div>
            </div>
            <BreakEven finance={f} />
          </section>

          {!f.onSale && f.projection.plusAccounts > 0 && (
            <section className="card card--quiet projection">
              <div className="card-title">
                <h3>A projection, not revenue</h3>
              </div>
              <p className="small">
                If the {count(f.projection.plusAccounts)} people on {PLUS} now were paying at list price, they would bring
                in about <b>{pounds(f.projection.perMonthPence)}</b> a month after VAT and store fees.
              </p>
              <p className="tiny muted">Assumes 60% on the yearly plan, as the costing does. Most people given Plus would not pay for it.</p>
            </section>
          )}
        </div>
      </div>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>Profit and loss by month</h3>
          <span className="tiny muted">the six months to {shortMonth(p.month)}</span>
        </div>
        <Chart
          title="Profit or loss each month"
          kind="bars"
          labels={f.history.map((h) => h.month)}
          series={[{ key: 'profit', label: 'Profit or loss', color: 'var(--dv-single)' }]}
          values={f.history.map((h) => [h.profitPence])}
          format={(v) => pounds(v)}
          axisFormat={(v) => pounds(v, { whole: true })}
          xFormat={shortMonth}
          xLong={monthName}
          partial={(label) => label === thisMonth}
        />
        <p className="tiny muted admin-note">
          The month still going is hatched. Each month carries today's list of fixed costs — change a price below and the
          past months move with it.
        </p>
      </section>

      <div className="admin-cols">
        <Costs fixed={f.fixed} onChanged={refresh} />
        <Settings settings={f.settings} onChanged={refresh} />
      </div>
    </div>
  );
}

function Line({ label, pence, sub, total, strong }: { label: string; pence: number; sub?: boolean; total?: boolean; strong?: boolean }) {
  return (
    <tr className={[sub && 'pnl-sub', total && 'pnl-total', strong && 'pnl-strong'].filter(Boolean).join(' ')}>
      <th scope="row">{label}</th>
      <td>{pounds(pence)}</td>
    </tr>
  );
}

/* ---------------- Fixed costs ---------------- */

const BLANK: CostInput = { label: '', amount: 0, currency: 'GBP', period: 'month', active: true };

function Costs({ fixed, onChanged }: { fixed: FixedCost[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const toast = useToast();
  const total = fixed.filter((c) => c.active).reduce((s, c) => s + c.monthlyPence, 0);

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>What it costs to exist</h3>
        <span className="badge">{pounds(total)} a month</span>
      </div>
      <div className="costs">
        {fixed.map((cost) =>
          editing === cost.id ? (
            <CostForm
              key={cost.id}
              initial={cost}
              onCancel={() => setEditing(null)}
              onSave={async (input) => {
                const done = await updateCost(cost.id, input);
                if (done.ok) {
                  setEditing(null);
                  onChanged();
                }
                return done;
              }}
            />
          ) : (
            <div className={cost.active ? 'cost' : 'cost cost--off'} key={cost.id}>
              <div className="cost-text">
                <span className="small">{cost.label}</span>
                <span className="tiny muted">
                  {cost.currency === 'USD' ? '$' : '£'}
                  {cost.amount.toFixed(2)} a {cost.period}
                  {!cost.active && ' · off'}
                </span>
              </div>
              <b className="small">{pounds(cost.monthlyPence)}</b>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing(cost.id)}>
                Edit
              </button>
              <button
                type="button"
                className="btn btn--sm btn--quiet-danger"
                aria-label={`Remove ${cost.label}`}
                onClick={async () => {
                  if (!window.confirm(`Remove ${cost.label}? It comes off every month's P&L, past ones included.`)) return;
                  await removeCost(cost.id);
                  toast('Removed.', '🗑️');
                  onChanged();
                }}
              >
                Remove
              </button>
            </div>
          ),
        )}
      </div>
      {editing === 'new' ? (
        <CostForm
          initial={BLANK}
          onCancel={() => setEditing(null)}
          onSave={async (input) => {
            const done = await addCost(input);
            if (done.ok) {
              setEditing(null);
              onChanged();
            }
            return done;
          }}
        />
      ) : (
        <button type="button" className="btn btn--sm btn--ghost" style={{ marginTop: 12 }} onClick={() => setEditing('new')}>
          Add a cost
        </button>
      )}
      <p className="tiny muted admin-note">
        Anything paid whether or not anybody uses Squish. Dollar prices are turned into pounds at the rate in the
        settings; yearly ones count as a twelfth a month. Switch one off rather than removing it to keep it for later.
      </p>
    </section>
  );
}

function CostForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: CostInput;
  onSave: (input: CostInput) => Promise<{ ok: boolean; message?: string }>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({ ...initial, amount: initial.amount ? String(initial.amount) : '' });
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="cost-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const done = await onSave({ ...draft, amount: Number(draft.amount) });
        setBusy(false);
        if (!done.ok) setTrouble(done.message ?? 'That did not save.');
      }}
    >
      <input
        className="input"
        value={draft.label}
        placeholder="What it is — Render, Apple, the domain…"
        aria-label="What the cost is"
        onChange={(event) => setDraft({ ...draft, label: event.target.value })}
      />
      <div className="row" style={{ gap: 8 }}>
        <select className="input" aria-label="Currency" value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as 'GBP' | 'USD' })}>
          <option value="GBP">£</option>
          <option value="USD">$</option>
        </select>
        <input
          className="input grow"
          inputMode="decimal"
          value={draft.amount}
          placeholder="0.00"
          aria-label="Amount"
          onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
        />
        <select className="input" aria-label="How often" value={draft.period} onChange={(event) => setDraft({ ...draft, period: event.target.value as 'month' | 'year' })}>
          <option value="month">a month</option>
          <option value="year">a year</option>
        </select>
      </div>
      <label className="checkline small">
        <input type="checkbox" checked={draft.active !== false} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
        Counts in the P&amp;L
      </label>
      {trouble && (
        <p className="tiny account-trouble" role="alert">
          {trouble}
        </p>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn--sm" disabled={busy || !draft.label.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ---------------- The numbers the sums use ---------------- */

const FIELDS: { key: keyof FinanceSettings; label: string; hint: string; percent?: boolean }[] = [
  { key: 'priceMonthly', label: 'Monthly price, £', hint: 'What the stores charge, VAT included' },
  { key: 'priceYearly', label: 'Yearly price, £', hint: 'VAT included' },
  { key: 'storeCut', label: 'Store fee, %', hint: '15 on the small-business programmes, 30 above $1m a year', percent: true },
  { key: 'vat', label: 'VAT, %', hint: 'Taken off before the store takes its share', percent: true },
  { key: 'usdToGbp', label: 'Pounds to the dollar', hint: 'For AI and hosting, which are billed in dollars' },
];

function Settings({ settings, onChanged }: { settings: FinanceSettings; onChanged: () => void }) {
  const shown = (s: FinanceSettings) =>
    Object.fromEntries(FIELDS.map((f) => [f.key, String(f.percent ? Math.round(s[f.key] * 1000) / 10 : s[f.key])])) as Record<keyof FinanceSettings, string>;
  const [draft, setDraft] = useState(() => shown(settings));
  const [trouble, setTrouble] = useState<string | null>(null);
  const toast = useToast();

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>The numbers the sums use</h3>
      </div>
      <form
        className="settings-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setTrouble(null);
          const values = Object.fromEntries(FIELDS.map((f) => [f.key, Number(draft[f.key]) / (f.percent ? 100 : 1)]));
          const done = await saveSettings(values);
          if (!done.ok) {
            setTrouble(done.message);
            return;
          }
          toast('Saved. Every figure uses these now.', '💷');
          onChanged();
        }}
      >
        {FIELDS.map((field) => (
          <label key={field.key} className="tiny muted">
            {field.label}
            <input
              className="input"
              inputMode="decimal"
              value={draft[field.key]}
              onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}
            />
            <span className="tiny muted">{field.hint}</span>
          </label>
        ))}
        {trouble && (
          <p className="tiny account-trouble" role="alert">
            {trouble}
          </p>
        )}
        <button type="submit" className="btn btn--sm">
          Save
        </button>
      </form>
      <p className="tiny muted admin-note">
        The prices here are for the sums — the break-even and the projection. What people are actually charged is set in
        App Store Connect and the Play Console.
      </p>
    </section>
  );
}
