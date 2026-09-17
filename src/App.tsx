import { useEffect, useMemo, useState } from 'react';
import type { AnalysisResult, MealEntry, MealSlot } from './types';
import { useSquish } from './store/useSquish';
import { ToastProvider, useAppliedTheme } from './components/ui';
import { CameraIcon, HomeIcon, InsightsIcon, MealsIcon, YouIcon } from './components/icons';
import Lock from './screens/Lock';
import Onboarding from './screens/Onboarding';
import Waking from './screens/Waking';
import Home from './screens/Home';
import Capture from './screens/Capture';
import Review from './screens/Review';
import Diary from './screens/Diary';
import Insights from './screens/Insights';
import You from './screens/You';
import AddFood from './screens/AddFood';
import { isoDate, slotForNow } from './lib/date';
import { aiStatus, onLocked, storedPasscode } from './lib/api';

export interface Draft {
  analysis: AnalysisResult;
  photo?: string;
  slot: MealSlot;
  date: string;
  /** Set when editing a meal that is already in the diary. */
  editingId?: string;
}

export type Route =
  | { name: 'home' }
  | { name: 'meals' }
  | { name: 'insights' }
  | { name: 'you' }
  | { name: 'capture'; slot?: MealSlot; date?: string }
  | { name: 'add'; slot?: MealSlot; date?: string; tab?: 'search' | 'describe' | 'favourites' }
  | { name: 'review'; draft: Draft };

const TABS: { name: Route['name']; label: string; Icon: typeof HomeIcon }[] = [
  { name: 'home', label: 'Home', Icon: HomeIcon },
  { name: 'meals', label: 'Meals', Icon: MealsIcon },
  { name: 'insights', label: 'Insights', Icon: InsightsIcon },
  { name: 'you', label: 'You', Icon: YouIcon },
];

/** undefined while we are still asking the server whether a passcode is needed. */
function useLockState(): [boolean | undefined, () => void] {
  const [locked, setLocked] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let live = true;
    onLocked(() => setLocked(true));
    aiStatus().then((status) => {
      if (live) setLocked(Boolean(status.locked) && !storedPasscode());
    });
    return () => {
      live = false;
    };
  }, []);

  return [locked, () => setLocked(false)];
}

function Shell() {
  const onboarded = useSquish((s) => s.profile.onboarded);
  const theme = useSquish((s) => s.theme);
  useAppliedTheme(theme);
  const [locked, unlockApp] = useLockState();

  const [route, setRoute] = useState<Route>({ name: 'home' });
  const isTab = useMemo(() => TABS.some((t) => t.name === route.name), [route]);

  // Keep the browser's back gesture working for the full-screen flows.
  useEffect(() => {
    if (isTab) return;
    window.history.pushState({ squish: route.name }, '');
    const onPop = () => setRoute({ name: 'home' });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isTab, route.name]);

  if (locked === undefined) return <Waking />;
  if (locked) return <Lock onUnlocked={unlockApp} />;
  if (!onboarded) return <Onboarding />;

  const go = (next: Route) => setRoute(next);
  const home = () => setRoute({ name: 'home' });

  const openReview = (analysis: AnalysisResult, options: { photo?: string; slot?: MealSlot; date?: string; editingId?: string } = {}) =>
    setRoute({
      name: 'review',
      draft: {
        analysis,
        photo: options.photo,
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
      {route.name === 'you' && <You />}
      {route.name === 'capture' && (
        <Capture slot={route.slot} date={route.date} onCancel={home} onAnalysed={openReview} go={go} />
      )}
      {route.name === 'add' && (
        <AddFood slot={route.slot} date={route.date} initialTab={route.tab} onCancel={home} onReady={openReview} />
      )}
      {route.name === 'review' && <Review draft={route.draft} onDone={home} onCancel={home} />}

      {isTab && (
        <nav className="tabbar" aria-label="Main">
          {TABS.slice(0, 2).map(({ name, label, Icon }) => (
            <button key={name} type="button" aria-current={route.name === name ? 'page' : undefined} onClick={() => go({ name } as Route)}>
              <Icon />
              {label}
            </button>
          ))}
          <button type="button" className="tab-fab" onClick={() => go({ name: 'capture' })} aria-label="Log a meal">
            <CameraIcon size={24} />
          </button>
          {TABS.slice(2).map(({ name, label, Icon }) => (
            <button key={name} type="button" aria-current={route.name === name ? 'page' : undefined} onClick={() => go({ name } as Route)}>
              <Icon />
              {label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
