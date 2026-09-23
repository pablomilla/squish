/**
 * The partner page, at /partners: where an affiliate signs in and sees how
 * their link is doing.
 *
 * Shown instead of the app, as the reset page is. A partner may never have
 * used Squish, and has no business being walked through setting it up to see
 * what they are owed. Signing in is by a link sent to their email address —
 * no password to forget between one month's visit and the next.
 *
 * It shows counts and money only. Who signed up is never on this page, and
 * the server would not send it if it were asked.
 */
import { useCallback, useEffect, useState } from 'react';
import { Wordmark } from '../components/Wordmark';
import Squish from '../components/Squish';
import { useAppliedTheme, useToast } from '../components/ui';
import { PLUS } from '../lib/plan';
import { askForLink, claimLink, fetchMine, linkTokenInUrl, signOut, signedIn, type PartnerView } from '../lib/partner';
import { friendlyDate } from '../lib/date';
import { Chart } from './admin/charts';
import { count, longDay, monthName, percent, pounds, shortDay, shortMonth } from './admin/format';
import { Tile } from './admin/Tiles';
import './admin.css';
import './partners.css';

type State =
  | { kind: 'loading' }
  | { kind: 'signin'; trouble?: string }
  | { kind: 'mine'; view: PartnerView }
  | { kind: 'error'; message: string };

export default function Partners() {
  useAppliedTheme('system');
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    const answer = await fetchMine();
    if ('view' in answer) setState({ kind: 'mine', view: answer.view });
    else if (answer.signedOut) setState({ kind: 'signin' });
    else setState({ kind: 'error', message: answer.message ?? 'Something went wrong.' });
  }, []);

  useEffect(() => {
    void (async () => {
      const token = linkTokenInUrl();
      if (token) {
        const claimed = await claimLink(token);
        if (!claimed.ok && !signedIn()) {
          setState({ kind: 'signin', trouble: claimed.message });
          return;
        }
      }
      await load();
    })();
  }, [load]);

  return (
    <div className="partners">
      <header className="partners-top">
        <a href="/" aria-label="Squish" className="partners-brand">
          <Wordmark width={112} />
          <span className="partners-tag">Partners</span>
        </a>
        {state.kind === 'mine' && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={async () => {
              await signOut();
              setState({ kind: 'signin' });
            }}
          >
            Sign out
          </button>
        )}
      </header>

      <main className="partners-main">
        {state.kind === 'loading' && <p className="muted small partners-wait">Loading…</p>}
        {state.kind === 'signin' && <SignIn trouble={state.trouble} />}
        {state.kind === 'error' && (
          <div className="card partners-narrow">
            <p>{state.message}</p>
            <button type="button" className="btn btn--sm" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}
        {state.kind === 'mine' && <Mine view={state.view} />}
      </main>

      <footer className="partners-foot tiny muted">
        Squish is made by Industry Logic Limited. Questions about your partnership:{' '}
        <a href="mailto:support@squish.online">support@squish.online</a>
      </footer>
    </div>
  );
}

function SignIn({ trouble }: { trouble?: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<null | { mail: boolean }>(null);
  const [problem, setProblem] = useState<string | null>(trouble ?? null);

  return (
    <section className="card partners-narrow partners-signin">
      <Squish mood="excited" size={96} />
      <h1>Your partner page</h1>
      <p className="muted">
        For people who share Squish with a link of their own. See the visits, sign-ups and subscribers your link has
        brought, and what you have earned.
      </p>
      {sent ? (
        sent.mail ? (
          <p className="partners-sent" role="status">
            If that address belongs to a Squish partner, a link to sign in is on its way. It works once, for 30 minutes —
            check your spam folder if it has not arrived in a minute or two.
          </p>
        ) : (
          <p className="partners-sent" role="status">
            Squish cannot send email just now. Ask us for a sign-in link at{' '}
            <a href="mailto:support@squish.online">support@squish.online</a> and we will send you one directly.
          </p>
        )
      ) : (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setProblem(null);
            const done = await askForLink(email);
            setBusy(false);
            if (!done.ok) setProblem(done.message);
            else setSent({ mail: done.mail });
          }}
        >
          <label className="tiny muted" htmlFor="partner-email">
            The email address we have for you
          </label>
          <input
            id="partner-email"
            className="input"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {problem && (
            <p className="tiny account-trouble" role="alert">
              {problem}
            </p>
          )}
          <button type="submit" className="btn btn--block" disabled={busy || !email.includes('@')}>
            {busy ? 'One moment…' : 'Email me a link'}
          </button>
        </form>
      )}
      <p className="tiny muted">
        Not a partner yet, and would like to be? Write to{' '}
        <a href="mailto:support@squish.online">support@squish.online</a>.
      </p>
    </section>
  );
}

function Mine({ view: v }: { view: PartnerView }) {
  const toast = useToast();
  const thisMonth = v.byMonth[v.byMonth.length - 1]?.month;
  const last30 = v.days.reduce((s, d) => ({ clicks: s.clicks + d.clicks, signups: s.signups + d.signups }), { clicks: 0, signups: 0 });
  const perMonthly = Math.round(495 * v.rate);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(v.link);
      toast('Link copied.', '🔗');
    } catch {
      toast('Select the link and copy it.', '🔗');
    }
  };

  return (
    <div className="partners-mine">
      <section className="partners-hello">
        <div>
          <h1>Hello, {v.name}</h1>
          <p className="muted">
            You earn <b>{percent(v.rate)}</b> of what each subscriber you bring pays for {PLUS} — after VAT and the app
            store's fee — for their first <b>{v.months} months</b>. On a £6.99 monthly subscription that is about{' '}
            {pounds(perMonthly)} a month each.
          </p>
        </div>
      </section>

      {!v.active && (
        <div className="alert alert--warn" role="status">
          <span className="alert-icon" aria-hidden="true">
            ⚠️
          </span>
          <div className="alert-text">
            <b className="small">Your link is switched off</b>
            <p className="tiny">New sign-ups through it no longer count. Everything you have earned is still yours.</p>
          </div>
        </div>
      )}

      <section className="card partners-link">
        <div className="card-title">
          <h3>Your link</h3>
          <code className="affiliate-code">{v.code}</code>
        </div>
        <div className="affiliate-link">
          <input className="input" readOnly value={v.link} aria-label="Your link" onFocus={(event) => event.target.select()} />
          <button type="button" className="btn btn--sm" onClick={() => void copy()}>
            Copy
          </button>
          {'share' in navigator && (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={() => void navigator.share({ title: 'Squish', text: 'Snap your meal, and Squish works out the nutrition.', url: v.link }).catch(() => {})}
            >
              Share
            </button>
          )}
        </div>
        <p className="tiny muted admin-note">
          Anybody who follows it and makes a free account within 30 days, in the same browser, is yours — for good. If
          they subscribe to {PLUS}, you earn your share.
        </p>
      </section>

      <div className="tiles">
        <Tile label="Visits to your link" value={count(v.totals.clicks)} note={`${count(last30.clicks)} in the last 30 days`} />
        <Tile label="Sign-ups" value={count(v.totals.signups)} note={`${count(last30.signups)} in the last 30 days`} />
        <Tile label="Subscribed now" value={count(v.totals.paying)} note={`${PLUS} subscribers from your link`} />
        <Tile label="Earned" value={pounds(v.totals.earnedPence)} note={`since ${friendlyDate(v.since.slice(0, 10))}`} />
        <Tile label="Paid to you" value={pounds(v.totals.paidPence)} note={`${v.payouts.length} payment${v.payouts.length === 1 ? '' : 's'}`} />
        <Tile label="Still to come" value={pounds(Math.max(0, v.totals.owedPence))} note="earned and not yet paid" />
      </div>

      <div className="admin-cols">
        <section className="card card--quiet">
          <div className="card-title">
            <h3>Visits</h3>
            <span className="tiny muted">a day, last 30 days</span>
          </div>
          <Chart
            title="Visits to your link each day, last 30 days"
            kind="line"
            labels={v.days.map((d) => d.day)}
            series={[{ key: 'clicks', label: 'Visits', color: 'var(--dv-single)' }]}
            values={v.days.map((d) => [d.clicks])}
            format={count}
            xFormat={shortDay}
            xLong={longDay}
          />
        </section>
        <section className="card card--quiet">
          <div className="card-title">
            <h3>Sign-ups</h3>
            <span className="tiny muted">a day, last 30 days</span>
          </div>
          <Chart
            title="Sign-ups from your link each day, last 30 days"
            kind="bars"
            labels={v.days.map((d) => d.day)}
            series={[{ key: 'signups', label: 'Sign-ups', color: 'var(--dv-single)' }]}
            values={v.days.map((d) => [d.signups])}
            format={count}
            xFormat={shortDay}
            xLong={longDay}
          />
        </section>
      </div>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>Earned each month</h3>
          <span className="tiny muted">the last 12 months</span>
        </div>
        <Chart
          title="Commission earned each month, last 12 months"
          kind="bars"
          labels={v.byMonth.map((m) => m.month)}
          series={[{ key: 'earned', label: 'Earned', color: 'var(--dv-single)' }]}
          values={v.byMonth.map((m) => [m.earnedPence])}
          format={(p) => pounds(p)}
          axisFormat={(p) => pounds(p, { whole: true })}
          xFormat={shortMonth}
          xLong={monthName}
          partial={(label) => label === thisMonth}
        />
        <p className="tiny muted admin-note">
          This month is hatched: it is still going. Earnings appear when the App Store or Google Play tells us a
          subscriber has paid, and come off again if a payment is refunded.
        </p>
      </section>

      <div className="admin-cols">
        <section className="card card--quiet">
          <div className="card-title">
            <h3>Payments to you</h3>
          </div>
          {v.payouts.length === 0 ? (
            <p className="tiny muted">None yet. Payments are made by bank transfer, and each one appears here.</p>
          ) : (
            <div className="admin-rows">
              {v.payouts.map((p, i) => (
                <div className="admin-row" key={`${p.paidAt}-${i}`}>
                  <span className="tiny">{friendlyDate(p.paidAt.slice(0, 10))}</span>
                  <span className="tiny muted">{p.note ?? ''}</span>
                  <b className="small">{pounds(p.amountPence)}</b>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="card card--quiet">
          <div className="card-title">
            <h3>Sharing it well</h3>
          </div>
          <ul className="how small">
            <li>
              <b>Say it is an ad.</b> Because you are paid for sign-ups, UK advertising rules need posts with your link to be
              labelled clearly — “Ad” or “#ad” at the start.
            </li>
            <li>
              <b>Keep to what Squish does.</b> It estimates the nutrition in a meal; it is not medical advice and does not
              promise weight loss. Please do not say it will.
            </li>
            <li>
              <b>It is for adults.</b> Squish is for people aged 18 and over, so please do not aim your link at under-18s.
            </li>
            <li>
              <b>No paid search on our name,</b> no spam, and no offers of your own — rewards for signing up, say — without
              asking us first.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
