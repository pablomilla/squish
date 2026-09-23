/**
 * The dashboard.
 *
 * Built for the person running Squish rather than the person using it: is it
 * growing, is it making money, what is the AI costing, who is signed up, who
 * sent them — and the switches for running it. Laid out like a shop's back
 * office: a menu down the side on a desk, tabs along the top on a phone.
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
import { TwoFactorPrompt, TwoFactorSetup } from '../components/TwoFactor';
import {
  fetchAffiliates,
  fetchFinance,
  fetchMetrics,
  fetchOverview,
  fetchTwoFactor,
  lockDashboard,
  type Finance,
  type Metrics,
  type Overview,
  type TwoFactorState,
} from '../lib/admin';
import { SECTIONS, isSection, type Section } from './admin/sections';
import { useEvery } from './admin/charts';
import OverviewSection from './admin/Overview';
import Money from './admin/Money';
import People from './admin/People';
import Usage from './admin/Usage';
import Affiliates from './admin/Affiliates';
import Settings from './admin/Settings';
import './admin.css';

/**
 * The door. Nothing below is fetched until the server says this device has
 * passed the second step — and the server says no to every dashboard request
 * until it has, so this is the app keeping up, not the lock.
 */
export default function Admin({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<TwoFactorState | null>(null);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    const next = await fetchTwoFactor();
    setFailed(!next);
    setState(next);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (state?.passed) {
    return <Dashboard onClose={onClose} twoFactor={state} onRecheck={check} />;
  }

  return (
    <div className="screen admin">
      <Head subtitle="Two-step sign-in" onClose={onClose} />
      {!state ? (
        <p className="tiny muted admin-foot">{failed ? 'Could not reach Squish just now.' : 'Loading…'}</p>
      ) : state.enrolled ? (
        <TwoFactorPrompt onPassed={() => void check()} />
      ) : (
        <TwoFactorSetup onDone={() => void check()} />
      )}
    </div>
  );
}

function Head({
  subtitle,
  onClose,
  onLock,
  children,
}: {
  subtitle: string;
  onClose: () => void;
  onLock?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <header className="screen-head admin-head">
      <div>
        <h1>Dashboard</h1>
        <p>{subtitle}</p>
      </div>
      <div className="row admin-head-actions" style={{ gap: 8 }}>
        {children}
        {onLock && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onLock}>
            Lock
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </div>
    </header>
  );
}

const SECTION_KEY = 'squish-admin-section';
const RANGES = [7, 30, 90] as const;

function remembered(): Section {
  try {
    const saved = localStorage.getItem(SECTION_KEY);
    return isSection(saved) ? saved : 'overview';
  } catch {
    return 'overview';
  }
}

function Dashboard({
  onClose,
  twoFactor,
  onRecheck,
}: {
  onClose: () => void;
  twoFactor: TwoFactorState;
  onRecheck: () => void;
}) {
  const [section, setSection] = useState<Section>(remembered);
  const [days, setDays] = useState<number>(30);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [owed, setOwed] = useState(0);
  const [updated, setUpdated] = useState<Date | null>(null);

  // Everything the headline figures need, together, so they agree with each
  // other. Re-asked every minute while the page is open.
  const load = useCallback(async () => {
    const [m, f, o, a] = await Promise.all([fetchMetrics(days), fetchFinance(), fetchOverview(), fetchAffiliates()]);
    // Most likely the twelve hours are up. Asking again puts the code box back
    // if so, and changes nothing if it was only a blip.
    if (!o) {
      onRecheck();
      return;
    }
    setOverview(o);
    if (m) setMetrics(m);
    if (f) setFinance(f);
    if (a) setOwed(a.affiliates.reduce((s, x) => s + Math.max(0, x.owedPence), 0));
    setUpdated(new Date());
  }, [days, onRecheck]);

  useEffect(() => {
    void load();
  }, [load]);
  useEvery(load, 60);

  const go = (next: Section) => {
    setSection(next);
    try {
      localStorage.setItem(SECTION_KEY, next);
    } catch {
      // Remembering the page is a nicety.
    }
    window.scrollTo({ top: 0 });
  };

  const current = SECTIONS.find((s) => s.key === section)!;
  const ranged = section === 'overview' || section === 'people' || section === 'usage';

  return (
    <div className="screen admin admin--shell">
      <Head
        subtitle={updated ? `${current.label} · updated ${updated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Loading…'}
        onClose={onClose}
        onLock={async () => {
          await lockDashboard();
          onRecheck();
        }}
      >
        {ranged && (
          <div className="segmented" role="group" aria-label="Period">
            {RANGES.map((range) => (
              <button key={range} type="button" aria-pressed={days === range} onClick={() => setDays(range)}>
                {range} days
              </button>
            ))}
          </div>
        )}
      </Head>

      <div className="admin-layout">
        <nav className="admin-nav" aria-label="Dashboard">
          {SECTIONS.map((s) => (
            <button key={s.key} type="button" aria-current={section === s.key ? 'page' : undefined} onClick={() => go(s.key)}>
              <span aria-hidden="true">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>

        <main className="admin-main">
          {section === 'overview' && (
            <OverviewSection metrics={metrics} finance={finance} overview={overview} owedPence={owed} twoFactor={twoFactor} go={go} />
          )}
          {section === 'money' && <Money key={finance ? 'ready' : 'waiting'} initial={finance} onChanged={() => void load()} />}
          {section === 'people' && <People metrics={metrics} usdToGbp={finance?.settings.usdToGbp ?? 0.78} />}
          {section === 'usage' && <Usage metrics={metrics} finance={finance} overview={overview} />}
          {section === 'affiliates' && <Affiliates mailReady={overview?.mailReady ?? false} onChanged={() => void load()} />}
          {section === 'settings' && <Settings mailReady={overview?.mailReady ?? false} twoFactor={twoFactor} onRecheck={onRecheck} />}

          <p className="tiny muted admin-foot">
            Counts and totals only. Nobody's diary is readable from here, by design — see docs/privacy.md.
          </p>
        </main>
      </div>
    </div>
  );
}
