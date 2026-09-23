/**
 * The front page: is Squish healthy, is it growing, what is it costing, and
 * does anything want doing. Everything else is one click from here.
 */
import { PLUS } from '../../lib/plan';
import type { Finance, Metrics, Overview as OverviewData, TwoFactorState } from '../../lib/admin';
import { Chart } from './charts';
import { KINDS, KIND_COLOR, KIND_LABEL, count, longDay, monthName, pounds, shortDay } from './format';
import { Alert, Tile } from './Tiles';
import type { Section } from './sections';

export default function Overview({
  metrics,
  finance,
  overview,
  owedPence,
  twoFactor,
  go,
}: {
  metrics: Metrics | null;
  finance: Finance | null;
  overview: OverviewData | null;
  owedPence: number;
  twoFactor: TwoFactorState;
  go: (section: Section) => void;
}) {
  const m = metrics;
  const f = finance;
  const aiDaily = m?.series.map((d) => d.aiPence.photo + d.aiPence.chat + d.aiPence.recipe) ?? [];

  // Today's AI spend against the week before it: worth a look at three times
  // the usual, once it is enough money to matter.
  const today = aiDaily[aiDaily.length - 1] ?? 0;
  const week = aiDaily.slice(-8, -1);
  const usual = week.length ? week.reduce((s, v) => s + v, 0) / week.length : 0;
  const spike = today > 100 && today > usual * 3;

  const alerts = [
    overview && !overview.mailReady && (
      <Alert key="mail" tone="warn" title="Email is not set up" action={<GoButton onClick={() => go('settings')} />}>
        Nobody can reset a password or confirm their address until it is.
      </Alert>
    ),
    twoFactor.recoveryLeft <= 3 && (
      <Alert key="codes" tone="warn" title={`${twoFactor.recoveryLeft} recovery codes left`} action={<GoButton onClick={() => go('settings')} />}>
        Make a new set before you run out, and keep them somewhere safe.
      </Alert>
    ),
    spike && (
      <Alert key="spike" tone="warn" title={`AI spend today is ${pounds(today)}`} action={<GoButton onClick={() => go('usage')} />}>
        About {Math.round(today / Math.max(1, usual))}× a usual day this week ({pounds(Math.round(usual))}). Worth a look at who is using it.
      </Alert>
    ),
    owedPence > 0 && (
      <Alert key="owed" tone="info" title={`${pounds(owedPence)} owed to affiliates`} action={<GoButton onClick={() => go('affiliates')} />}>
        Pay by bank transfer, then record the payment so the balance comes down.
      </Alert>
    ),
    f && f.month.profitPence < 0 && !f.onSale && (
      <Alert key="presale" tone="info" title={`${PLUS} is not on sale yet`}>
        So this month shows costs and no revenue — expected until the iPhone and Android apps are out.
      </Alert>
    ),
  ].filter(Boolean);

  return (
    <div className="admin-section">
      {alerts.length > 0 && <div className="alerts">{alerts}</div>}

      {m && f && (
        <div className="tiles tiles--6">
          <Tile
            label="Active people"
            value={count(m.totals.active)}
            now={m.totals.active}
            before={m.previous.active}
            days={m.days}
            spark={m.series.map((d) => d.active)}
            onClick={() => go('people')}
          />
          <Tile
            label="New accounts"
            value={count(m.totals.signups)}
            now={m.totals.signups}
            before={m.previous.signups}
            days={m.days}
            spark={m.series.map((d) => d.signups)}
            onClick={() => go('people')}
          />
          <Tile
            label={`On ${PLUS}`}
            value={count(m.plans.payingPlus + m.plans.compedPlus)}
            note={`${count(m.plans.payingPlus)} paying · ${count(m.plans.compedPlus)} given`}
            onClick={() => go('people')}
          />
          <Tile
            label="Monthly recurring revenue"
            value={pounds(f.paying.mrrPence)}
            note={f.onSale ? `${count(f.paying.accounts)} subscribers, after VAT and store fees` : 'Not on sale yet'}
            onClick={() => go('money')}
          />
          <Tile
            label="AI cost"
            value={pounds(m.totals.aiPence)}
            now={m.totals.aiPence}
            before={m.previous.aiPence}
            days={m.days}
            spark={aiDaily}
            onClick={() => go('usage')}
          />
          <Tile
            label={f.month.current ? 'Profit so far this month' : 'Profit this month'}
            value={pounds(f.month.profitPence)}
            note={`${monthName(f.month.month)}, after every cost`}
            onClick={() => go('money')}
          />
        </div>
      )}

      {m && (
        <div className="admin-cols">
          <section className="card card--quiet">
            <div className="card-title">
              <h3>Active people</h3>
              <span className="tiny muted">a day</span>
            </div>
            <Chart
              title={`People who used Squish each day, last ${m.days} days`}
              kind="line"
              labels={m.series.map((d) => d.day)}
              series={[{ key: 'active', label: 'Active people', color: 'var(--dv-single)' }]}
              values={m.series.map((d) => [d.active])}
              format={count}
              xFormat={shortDay}
              xLong={longDay}
            />
            <Since since={m.recordedSince} />
          </section>

          <section className="card card--quiet">
            <div className="card-title">
              <h3>AI cost</h3>
              <span className="tiny muted">a day, in pounds</span>
            </div>
            <Chart
              title={`AI cost a day by feature, last ${m.days} days`}
              kind="stacked"
              labels={m.series.map((d) => d.day)}
              series={KINDS.map((k) => ({ key: k, label: KIND_LABEL[k], color: KIND_COLOR[k] }))}
              values={m.series.map((d) => KINDS.map((k) => d.aiPence[k]))}
              format={(v) => pounds(v)}
              axisFormat={(v) => pounds(v, { whole: v >= 1000 || v === 0 })}
              xFormat={shortDay}
              xLong={longDay}
            />
          </section>
        </div>
      )}

      {f && (
        <section className="card card--quiet">
          <div className="card-title">
            <h3>{monthName(f.month.month)} so far</h3>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => go('money')}>
              The full P&amp;L
            </button>
          </div>
          <div className="glance">
            <Glance label="Came in" value={pounds(f.month.netPence)} note="after VAT, store fees and refunds" />
            <Glance label="AI" value={pounds(-f.month.aiPence)} />
            <Glance label="Hosting and fees" value={pounds(-f.month.fixedPence)} />
            <Glance label="Affiliates" value={pounds(-f.month.commissionPence)} />
            <Glance label="Profit" value={pounds(f.month.profitPence)} strong />
          </div>
          <BreakEven finance={f} />
        </section>
      )}
    </div>
  );
}

function GoButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="btn btn--sm btn--ghost" onClick={onClick}>
      Open
    </button>
  );
}

function Glance({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={strong ? 'glance-item glance-item--strong' : 'glance-item'}>
      <span className="tiny muted">{label}</span>
      <b>{value}</b>
      {note && <span className="tiny muted">{note}</span>}
    </div>
  );
}

/**
 * How many paying subscribers this month's costs need — the one number that
 * says how far off covering its own costs Squish is.
 */
export function BreakEven({ finance }: { finance: Finance }) {
  const s = finance.settings;
  const perSub = (0.4 * (s.priceMonthly / (1 + s.vat)) * (1 - s.storeCut) + 0.6 * ((s.priceYearly / (1 + s.vat)) * (1 - s.storeCut)) / 12) * 100;
  const costs = finance.month.fixedPence + finance.month.aiPence;
  if (perSub <= 0) return null;
  const need = Math.ceil(costs / perSub);
  return (
    <p className="tiny muted admin-note">
      Break-even: about <b>{count(need)}</b> paying subscribers would cover this month's hosting, fees and AI at today's
      prices (each brings in about {pounds(Math.round(perSub))} a month, with 60% on the yearly plan). Now:{' '}
      <b>{count(finance.paying.accounts)}</b>.
    </p>
  );
}

export function Since({ since }: { since: string | null }) {
  if (!since) return <p className="tiny muted admin-note">Nobody has been counted yet — the count starts with the next visit.</p>;
  return <p className="tiny muted admin-note">Counted from {longDay(since)}, when the dashboard started keeping a daily record.</p>;
}
