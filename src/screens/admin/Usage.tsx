/**
 * AI usage: the one cost that grows with every person, so the one worth
 * watching day by day. Every figure is what Anthropic charged, added up call
 * by call — not a count multiplied by a guess.
 */
import { useEffect, useState } from 'react';
import { PLUS } from '../../lib/plan';
import { fetchWeekPlans, type Finance, type Metrics, type Overview, type PlanRecord } from '../../lib/admin';
import { Chart } from './charts';
import { KINDS, KIND_COLOR, KIND_LABEL, count, longDay, monthName, perCall, pounds, shortDay } from './format';
import { Tile } from './Tiles';

export default function Usage({ metrics, finance, overview }: { metrics: Metrics | null; finance: Finance | null; overview: Overview | null }) {
  const m = metrics;
  const f = finance;
  const perActive = m && m.totals.active > 0 ? m.totals.aiPence / m.totals.active : 0;
  const perAnalysis = m && m.totals.analyses > 0 ? m.series.reduce((s, d) => s + d.aiPence.photo, 0) / m.totals.analyses : 0;

  return (
    <div className="admin-section">
      {m && (
        <div className="tiles">
          <Tile label={`AI cost, ${m.days} days`} value={pounds(m.totals.aiPence)} now={m.totals.aiPence} before={m.previous.aiPence} days={m.days} />
          <Tile
            label="Meal analyses"
            value={count(m.totals.analyses)}
            now={m.totals.analyses}
            before={m.previous.analyses}
            days={m.days}
            spark={m.series.map((d) => d.analyses)}
          />
          <Tile label="Per meal analysis" value={perCall(perAnalysis)} note="photos and descriptions together" />
          <Tile label="Per active person" value={perCall(perActive)} note={`over the ${m.days} days`} />
        </div>
      )}

      {m && (
        <section className="card card--quiet">
          <div className="card-title">
            <h3>Cost a day, by feature</h3>
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
            height={220}
          />
        </section>
      )}

      <div className="admin-cols">
        {m && (
          <section className="card card--quiet">
            <div className="card-title">
              <h3>Meal analyses</h3>
              <span className="tiny muted">a day</span>
            </div>
            <Chart
              title={`Meal analyses a day, last ${m.days} days`}
              kind="bars"
              labels={m.series.map((d) => d.day)}
              series={[{ key: 'analyses', label: 'Meal analyses', color: 'var(--dv-single)' }]}
              values={m.series.map((d) => [d.analyses])}
              format={count}
              xFormat={shortDay}
              xLong={longDay}
            />
          </section>
        )}

        {f && (
          <section className="card card--quiet">
            <div className="card-title">
              <h3>{monthName(f.month.month)}, by feature</h3>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  <th scope="col">Calls</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Each</th>
                </tr>
              </thead>
              <tbody>
                {KINDS.map((kind) => {
                  const row = f.month.aiByKind.find((k) => k.kind === kind) ?? { calls: 0, pence: 0 };
                  return (
                    <tr key={kind}>
                      <th scope="row">
                        <span className="chart-swatch" style={{ background: KIND_COLOR[kind] }} />
                        {KIND_LABEL[kind]}
                      </th>
                      <td>{count(row.calls)}</td>
                      <td>{pounds(row.pence)}</td>
                      <td>{row.calls ? perCall(row.pence / row.calls) : '—'}</td>
                    </tr>
                  );
                })}
                <tr className="data-total">
                  <th scope="row">All</th>
                  <td>{count(f.month.aiByKind.reduce((s, k) => s + k.calls, 0))}</td>
                  <td>{pounds(f.month.aiPence)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            {overview && (
              <p className="tiny muted admin-note">
                Allowances: free accounts get a one-off taste of {overview.allowances.free.photo} meal analyses. {PLUS} gets{' '}
                {overview.allowances.plus.photo} analyses, {overview.allowances.plus.chat} questions and{' '}
                {overview.allowances.plus.recipe} recipe imports a month.
              </p>
            )}
          </section>
        )}
      </div>

      <WeekPlans />
    </div>
  );
}

const minutes = (seconds: number) => (seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`);
const STATUS: Record<PlanRecord['status'], string> = { done: 'Made', failed: 'Failed', working: 'Being made' };

/**
 * The latest weekly plans, one line each: when, whose, how it went and how
 * long it took. A plan takes minutes and runs in the background, so this is
 * the one place that says what happened to one somebody never saw — a failure
 * with its reason, or a restart part-way (more than one try). Never what was
 * planned.
 */
function WeekPlans() {
  const [plans, setPlans] = useState<PlanRecord[] | null>(null);
  useEffect(() => {
    void fetchWeekPlans().then((found) => setPlans(found?.plans ?? []));
  }, []);
  if (!plans) return null;

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>Weekly plans</h3>
        <span className="tiny muted">latest {plans.length || ''}</span>
      </div>
      {plans.length === 0 ? (
        <p className="tiny muted">None asked for in the last day.</p>
      ) : (
        <div className="admin-plans">
          {plans.map((plan) => (
            <div className="admin-plan" key={plan.at + (plan.email ?? '')}>
              <div className="admin-plan-head">
                <span className={`badge ${plan.status === 'done' ? 'badge--good' : plan.status === 'failed' ? 'badge--bad' : ''}`}>{STATUS[plan.status]}</span>
                <span className="small admin-plan-who">{plan.email ?? 'Somebody without an account'}</span>
              </div>
              <p className="tiny muted">
                {new Date(plan.at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {plan.days !== null && ` · ${plan.days} days`} · {minutes(plan.seconds)}
                {plan.attempts > 1 && ` · ${plan.attempts} tries`}
              </p>
              {plan.error && <p className="tiny">{plan.error}</p>}
            </div>
          ))}
        </div>
      )}
      <p className="tiny muted admin-note">
        Kept for a day. A failed plan gives its question back. More than one try means the server restarted while it
        was being made — a deploy — and another picked it up.
      </p>
    </section>
  );
}
