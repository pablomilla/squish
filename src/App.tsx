import { useEffect, useMemo, useState } from 'react';
import type { AnalysisResult, MealEntry, MealSlot, Route } from './types';
import { useSquish } from './store/useSquish';
import { ToastProvider, useAppliedLook, useAppliedTheme } from './components/ui';
import AddSheet from './components/AddSheet';
import { DiaryIcon, HomeIcon, InsightsIcon, PlusIcon, YouIcon } from './components/icons';
import Onboarding from './screens/Onboarding';
import Waking from './screens/Waking';
import Home from './screens/Home';
import Capture from './screens/Capture';
import Review from './screens/Review';
import Diary from './screens/Diary';
import Insights from './screens/Insights';
import You from './screens/You';
import Ask from './screens/Ask';
import Admin from './screens/Admin';
import AddFood from './screens/AddFood';
import { isoDate, slotForNow } from './lib/date';
import { THUMB, aiStatus, reshrink, type AiStatus, type OutOfAllowance } from './lib/api';
import { startBackup } from './lib/autobackup';
import { savePhoto, watchPhotos } from './lib/photos';
import { isOversized, rehomePhotos } from './lib/rehome';
import { watchPlan } from './lib/plan';
import { onPaywall } from './lib/paywall';
import Paywall from './components/Paywall';
import { resetTokenInUrl } from './lib/account';
import ResetPassword from './screens/ResetPassword';

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
  const theme = useSquish((s) => s.theme);
  const look = useSquish((s) => s.look);
  useAppliedLook(look, useAppliedTheme(theme) === 'dark');
  const { awake, keepsData } = useServer();

  const [route, setRoute] = useState<Route>({ name: 'home' });

  useEffect(() => startBackup(keepsData), [keepsData]);

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

  if (!awake) return <Waking />;
  if (!onboarded) return <Onboarding />;

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
    <div className="app">
      {route.name === 'home' && <Home go={go} />}
      {route.name === 'meals' && <Diary go={go} onEditMeal={editMeal} />}
      {route.name === 'insights' && <Insights />}
      {route.name === 'you' && <You go={go} />}
      {route.name === 'capture' && (
        <Capture slot={route.slot} date={route.date} shot={route.shot} onCancel={home} onAnalysed={openReview} go={go} />
      )}
      {route.name === 'add' && (
        <AddFood slot={route.slot} date={route.date} initialTab={route.tab} onCancel={home} onReady={openReview} />
      )}
      {route.name === 'ask' && <Ask onClose={home} />}
      {route.name === 'admin' && <Admin onClose={() => setRoute({ name: 'you' })} />}
      {route.name === 'review' && <Review draft={route.draft} onDone={home} onCancel={home} />}

      <AddSheet open={adding} onClose={() => setAdding(false)} go={go} />

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

      <Paywall standing={paywall} onClose={() => setPaywall(null)} />
    </div>
  );
}

export default function App() {
  // A reset link is its own screen, not a sheet inside the app. Whoever
  // followed it may be on a phone with no diary on it yet, and has one thing
  // to do. Read once, at startup: nothing in the app changes the address bar.
  const resetToken = useMemo(() => resetTokenInUrl(), []);
  if (resetToken) return <ResetPassword token={resetToken} />;

  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
