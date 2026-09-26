import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisResult, MealEntry, MealSlot, Route } from './types';
import { useSquish, MIN_AGE } from './store/useSquish';
import TooYoung from './components/TooYoung';
import { ToastProvider, useAppliedLook, useAppliedTheme, useToast } from './components/ui';
import AddSheet from './components/AddSheet';
import { DiaryIcon, HomeIcon, InsightsIcon, PlusIcon, YouIcon } from './components/icons';
import Waking from './screens/Waking';
import Home from './screens/Home';
import { lazyScreen } from './lib/lazyScreen';
import { isoDate, slotForNow } from './lib/date';
import { THUMB, aiStatus, reshrink, type AiStatus, type OutOfAllowance } from './lib/api';
import { adoptBackup, startBackup } from './lib/autobackup';
import { pullDiary } from './lib/backup';
import { arriveFromOldAddress } from './lib/identity';
import { apiUrl } from './lib/origin';
import { savePhoto, watchPhotos } from './lib/photos';
import { isOversized, rehomePhotos } from './lib/rehome';
import { refreshPlan, watchPlan } from './lib/plan';
import SquadSync from './components/squad/SquadSync';
import AchievementSync from './components/AchievementSync';
import { onPaywall } from './lib/paywall';
import { askForAccount, resetTokenInUrl } from './lib/account';

/*
 * Home and the waking screen arrive with the app, because they are the first
 * thing anybody sees. Everything else is fetched when first opened — see
 * lib/lazyScreen.ts for why, and for the one failure that comes with it.
 */
const Onboarding = lazyScreen(() => import('./screens/Onboarding'));
const Capture = lazyScreen(() => import('./screens/Capture'));
const Review = lazyScreen(() => import('./screens/Review'));
const Diary = lazyScreen(() => import('./screens/Diary'));
const Insights = lazyScreen(() => import('./screens/Insights'));
const You = lazyScreen(() => import('./screens/You'));
const Ask = lazyScreen(() => import('./screens/Ask'));
const Admin = lazyScreen(() => import('./screens/Admin'));
const AddFood = lazyScreen(() => import('./screens/AddFood'));
const Paywall = lazyScreen(() => import('./components/Paywall'));
const ResetPassword = lazyScreen(() => import('./screens/ResetPassword'));
const Partners = lazyScreen(() => import('./screens/Partners'));

const TABS: { name: Route['name']; label: string; Icon: typeof HomeIcon }[] = [
  { name: 'home', label: 'Home', Icon: HomeIcon },
  { name: 'meals', label: 'Diary', Icon: DiaryIcon },
  { name: 'insights', label: 'Insights', Icon: InsightsIcon },
  { name: 'you', label: 'You', Icon: YouIcon },
];

/**
 * The one question asked of the server at startup: are you there, and do you
 * keep anything?
 *
 * `null` while it is still being asked, which is what the waking screen is
 * for — a free-tier host asleep for fifteen minutes takes the best part of a
 * minute to answer, and a blank app for that long looks broken.
 */
function useServer(): { awake: boolean; keepsData: boolean } {
  const [status, setStatus] = useState<AiStatus | null>(null);

  useEffect(() => {
    let live = true;
    void aiStatus()
      .then((found) => live && setStatus(found))
      // A server that cannot be reached is not a reason to hold the app shut.
      // Squish works with no network at all; it simply keeps nothing.
      .catch(() => live && setStatus({ ok: false, ai: false, model: '' }));
    return () => {
      live = false;
    };
  }, []);

  return { awake: status !== null, keepsData: Boolean(status?.accounts) };
}

function Shell() {
  const onboarded = useSquish((s) => s.profile.onboarded);
  const tooYoung = useSquish((s) => s.profile.age < MIN_AGE);
  const setProfile = useSquish((s) => s.setProfile);
  const theme = useSquish((s) => s.theme);
  const look = useSquish((s) => s.look);
  useAppliedLook(look, useAppliedTheme(theme) === 'dark');
  const { awake, keepsData } = useServer();

  const [route, setRoute] = useState<Route>({ name: 'home' });

  useEffect(() => startBackup(keepsData), [keepsData]);

  // Somebody sent here from squish.online, the app's old address, with their
  // device on the way. Their diary is on the server under that device, so it
  // is fetched and, where this browser has nothing yet, becomes theirs.
  const toast = useToast();
  const arrived = useRef(false);
  useEffect(() => {
    if (!awake || arrived.current) return;
    arrived.current = true;
    void arriveFromOldAddress(apiUrl).then(async (result) => {
      if (result === 'none') return;
      if (result === 'kept') {
        toast('This browser already has a diary here, so the one from the old address was left where it was.', '📦');
        return;
      }
      if (result === 'expired') {
        toast('That link has been used or is too old. Go back to squish.online and press the button again.', '⏳');
        return;
      }
      await refreshPlan();
      const found = await pullDiary();
      const profile = (found?.state as { profile?: { onboarded?: boolean; name?: string } } | null)?.profile;
      if (found && profile?.onboarded) {
        adoptBackup(found);
        toast(`Welcome back${profile.name ? `, ${profile.name}` : ''}. Your diary moved with you.`, '🫧');
      }
    });
  }, [awake, toast]);

  // Which tier this person is on. Asked of the server, never of the browser.
  useEffect(() => watchPlan(keepsData), [keepsData]);

  // Raised by the API client, so no screen has to remember to show it.
  const [paywall, setPaywall] = useState<OutOfAllowance | null>(null);
  useEffect(() => {
    onPaywall(setPaywall);
    return () => onPaywall(null);
  }, []);

  // Photographs live outside the diary, in IndexedDB, so nothing removes one
  // just because its meal went. Reconciled here, where every way a meal can
  // leave — deleted, Reset, replaced by a restore — passes through the store.
  const meals = useSquish((s) => s.meals);
  useEffect(() => watchPhotos(() => useSquish.getState().meals.map((m) => m.id)), [meals]);

  // Once, for anybody whose diary still has full-size photographs inside it.
  // Until this runs their browser store is close to full and the next meal
  // may not save at all, so it goes early and is not waited on.
  useEffect(() => {
    const current = useSquish.getState().meals;
    if (!current.some((meal) => isOversized(meal.photo))) return;

    void rehomePhotos(current, (dataUrl) => reshrink(dataUrl, THUMB.maxSide, THUMB.quality), savePhoto).then((moved) => {
      if (!Object.keys(moved).length) return;
      useSquish.setState({
        // Read afresh rather than closing over `current`: rehoming decodes an
        // image per meal, and a diary edited while that happened must win.
        meals: useSquish.getState().meals.map((meal) => (moved[meal.id] ? { ...meal, photo: moved[meal.id] } : meal)),
      });
    });
  }, []);
  const [adding, setAdding] = useState(false);
  const isTab = useMemo(() => TABS.some((t) => t.name === route.name), [route]);

  // Keep the browser's back gesture working for the full-screen flows.
  useEffect(() => {
    if (isTab) return;
    window.history.pushState({ squish: route.name }, '');
    const onPop = () => setRoute({ name: 'home' });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isTab, route.name]);

  // Once Home is on screen, fetch the everyday screens in the background.
  // Splitting them out makes the first load faster; this makes the first tap
  // on Diary as quick as it was before, and puts them in the browser's cache
  // before anybody walks into a basement with no signal.
  useEffect(() => {
    if (!awake || !onboarded) return;
    const warm = () => {
      void import('./screens/Diary');
      void import('./screens/Insights');
      void import('./screens/You');
      void import('./screens/Capture');
      void import('./screens/AddFood');
      void import('./screens/Review');
    };
    const idle = (window as { requestIdleCallback?: (fn: () => void) => number }).requestIdleCallback;
    if (idle) idle(warm);
    else setTimeout(warm, 1500);
  }, [awake, onboarded]);

  if (!awake) return <Waking />;
  // Set up before the app asked for 18 or over: the same kind stop as a new
  // setup gets, with a way to put a mistyped age right.
  if (onboarded && tooYoung)
    return (
      <div className="app">
        <div className="screen">
          <TooYoung onCorrected={(age) => setProfile({ age })} />
        </div>
      </div>
    );
  if (!onboarded)
    return (
      <Suspense fallback={<div className="screen-loading" aria-busy="true" />}>
        <Onboarding accounts={keepsData} />
      </Suspense>
    );

  const go = (next: Route) => setRoute(next);
  const home = () => setRoute({ name: 'home' });

  const openReview = (
    analysis: AnalysisResult,
    options: { photo?: string; photoFull?: string; slot?: MealSlot; date?: string; editingId?: string } = {},
  ) =>
    setRoute({
      name: 'review',
      draft: {
        analysis,
        photo: options.photo,
        photoFull: options.photoFull,
        slot: options.slot ?? analysis.slot ?? slotForNow(),
        date: options.date ?? isoDate(),
        editingId: options.editingId,
      },
    });

  const editMeal = (meal: MealEntry) =>
    openReview(
      {
        title: meal.title,
        items: meal.items,
        nutrients: meal.nutrients,
        score: meal.score,
        coachNote: meal.coachNote ?? '',
        confidence: meal.aiConfidence ?? 'medium',
        slot: meal.slot,
      },
      { photo: meal.photo, slot: meal.slot, date: meal.date, editingId: meal.id },
    );

  return (
    // The dashboard is the one screen used sitting down at a desk, so it alone
    // is let out of the phone-width frame.
    <div className={route.name === 'admin' ? 'app app--wide' : 'app'}>
      {/*
        Around the screens and not the whole app, so the tab bar stays put
        while a screen's file arrives instead of the page going blank.
      */}
      <Suspense fallback={<div className="screen-loading" aria-busy="true" />}>
      {route.name === 'home' && <Home go={go} />}
      {route.name === 'meals' && <Diary go={go} onEditMeal={editMeal} />}
      {route.name === 'insights' && <Insights go={go} />}
      {route.name === 'you' && <You go={go} />}
      {route.name === 'capture' && (
        <Capture slot={route.slot} date={route.date} shot={route.shot} onCancel={home} onAnalysed={openReview} go={go} />
      )}
      {route.name === 'add' && (
        <AddFood slot={route.slot} date={route.date} initialTab={route.tab} onCancel={home} onReady={openReview} />
      )}
      {route.name === 'ask' && <Ask key={route.question ?? ''} onClose={home} question={route.question} />}
      {route.name === 'admin' && <Admin onClose={() => setRoute({ name: 'you' })} />}
      {route.name === 'review' && <Review draft={route.draft} onDone={home} onCancel={home} />}
      </Suspense>

      <AddSheet open={adding} onClose={() => setAdding(false)} go={go} />
      {keepsData && <SquadSync />}
      <AchievementSync />

      {isTab && (
        <nav className="tabbar" aria-label="Main">
          {TABS.slice(0, 2).map(({ name, label, Icon }) => (
            <button key={name} type="button" aria-current={route.name === name ? 'page' : undefined} onClick={() => go({ name } as Route)}>
              <Icon />
              {label}
            </button>
          ))}
          <button type="button" className="tab-fab" onClick={() => setAdding(true)} aria-label="Add food">
            <PlusIcon size={28} />
          </button>
          {TABS.slice(2).map(({ name, label, Icon }) => (
            <button key={name} type="button" aria-current={route.name === name ? 'page' : undefined} onClick={() => go({ name } as Route)}>
              <Icon />
              {label}
            </button>
          ))}
        </nav>
      )}

      {/* Only fetched the first time somebody actually runs out of something. */}
      {paywall && (
        <Suspense fallback={null}>
          <Paywall
            standing={paywall}
            onClose={() => setPaywall(null)}
            onCreateAccount={() => {
              setPaywall(null);
              askForAccount();
              setRoute({ name: 'you' });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

export default function App() {
  // A reset link is its own screen, not a sheet inside the app. Whoever
  // followed it may be on a phone with no diary on it yet, and has one thing
  // to do. Read once, at startup: nothing in the app changes the address bar.
  const resetToken = useMemo(() => resetTokenInUrl(), []);
  // The partner page is its own site in all but address: affiliates have no
  // diary and no reason to see the app's setup.
  const partnerPage = useMemo(() => location.pathname === '/partners' || location.pathname.startsWith('/partners/'), []);
  if (partnerPage)
    return (
      <ToastProvider>
        <Suspense fallback={<div className="screen-loading" aria-busy="true" />}>
          <Partners />
        </Suspense>
      </ToastProvider>
    );
  if (resetToken)
    return (
      <Suspense fallback={<div className="screen-loading" aria-busy="true" />}>
        <ResetPassword token={resetToken} />
      </Suspense>
    );

  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
