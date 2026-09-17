import { useMemo, useState } from 'react';
import type { AnalysisResult, FoodItem, MealSlot } from '../types';
import Squish from '../components/Squish';
import { Segmented, Stepper, useToast } from '../components/ui';
import { CloseIcon, HeartIcon, PlusIcon, SearchIcon, SparkIcon } from '../components/icons';
import { useSquish } from '../store/useSquish';
import { searchFoods, toFoodItem } from '../lib/foods';
import { qualityScore, sumNutrients } from '../lib/nutrition';
import { analyseText, SquishApiError } from '../lib/api';
import { slotForNow } from '../lib/date';
import './addfood.css';

type Tab = 'search' | 'describe' | 'favourites';

interface Props {
  slot?: MealSlot;
  date?: string;
  initialTab?: Tab;
  onCancel: () => void;
  onReady: (analysis: AnalysisResult, options: { slot?: MealSlot; date?: string }) => void;
}

const EXAMPLES = [
  'two scrambled eggs on wholemeal toast with avocado',
  'chicken burrito and a diet cola',
  'porridge with blueberries and a spoon of peanut butter',
];

export default function AddFood({ slot, date, initialTab = 'search', onCancel, onReady }: Props) {
  const toast = useToast();
  const favourites = useSquish((s) => s.favourites);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState('');
  const [basket, setBasket] = useState<FoodItem[]>([]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [quickKcal, setQuickKcal] = useState(250);
  const [quickProtein, setQuickProtein] = useState(10);

  const mealSlot = slot ?? slotForNow();
  const results = useMemo(() => searchFoods(query, 20), [query]);
  const totals = useMemo(() => sumNutrients(basket), [basket]);

  const add = (item: FoodItem) => {
    setBasket((list) => [...list, item]);
    toast(`${item.name} added`, '➕');
  };

  const reviewBasket = () => {
    if (!basket.length) return;
    onReady(
      {
        title: basket.length === 1 ? basket[0].name : `${basket[0].name} +${basket.length - 1}`,
        items: basket,
        nutrients: totals,
        score: qualityScore(totals),
        coachNote: '',
        confidence: 'high',
        slot: mealSlot,
      },
      { slot: mealSlot, date },
    );
  };

  const describe = async () => {
    const text = description.trim();
    if (text.length < 3) {
      toast('Tell me a little more about it.', '✍️');
      return;
    }
    setBusy(true);
    try {
      const analysis = await analyseText(text, mealSlot);
      if (!analysis.items.length) {
        toast('I could not place that one — try the search tab.', '😅');
        setBusy(false);
        return;
      }
      onReady(analysis, { slot: analysis.slot ?? mealSlot, date });
    } catch (error) {
      toast(error instanceof SquishApiError ? error.message : 'That did not work — give it another go.', '😕');
      setBusy(false);
    }
  };

  if (busy) {
    return (
      <div className="screen addfood-busy">
        <Squish mood="thinking" size={150} />
        <h2>Working out the numbers…</h2>
        <p className="muted small center">Breaking your description into foods and portions.</p>
      </div>
    );
  }

  return (
    <div className="screen addfood">
      <header className="row-between">
        <button type="button" className="btn--quiet" onClick={onCancel} aria-label="Close">
          <CloseIcon />
        </button>
        <h2>Add food</h2>
        <span style={{ width: 28 }} />
      </header>

      <Segmented<Tab>
        label="How would you like to add it?"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'search', label: 'Search' },
          { value: 'describe', label: 'Describe' },
          { value: 'favourites', label: 'Saved' },
        ]}
      />

      {tab === 'search' && (
        <>
          <div className="search-wrap">
            <SearchIcon />
            <input
              className="input"
              value={query}
              autoFocus
              placeholder="Search foods — rice, salmon, latte…"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search foods"
            />
          </div>

          <div className="stack">
            {results.map((food) => (
              <button key={food.id} type="button" className="meal-card" onClick={() => add(toFoodItem(food))}>
                <span className="thumb thumb--emoji" aria-hidden="true">{food.emoji}</span>
                <span className="meal-card-body">
                  <span className="meal-card-title">{food.name}</span>
                  <span className="tiny muted">
                    {food.serving} · {Math.round((food.per100.calories * food.servingG) / 100)} kcal · P{' '}
                    {Math.round((food.per100.protein * food.servingG) / 100)}g
                  </span>
                </span>
                <PlusIcon size={18} />
              </button>
            ))}
            {results.length === 0 && (
              <div className="empty">
                <p>No match for "{query}".</p>
                <button type="button" className="btn btn--soft btn--sm" style={{ marginTop: 10 }} onClick={() => { setDescription(query); setTab('describe'); }}>
                  Let Squish work it out instead
                </button>
              </div>
            )}
          </div>

          <div className="card quick-add">
            <h3>Quick add</h3>
            <p className="tiny muted">Know the numbers already? Pop them straight in.</p>
            <div className="row-between" style={{ marginTop: 10 }}>
              <span className="small">Calories</span>
              <Stepper value={quickKcal} step={50} min={0} max={3000} onChange={setQuickKcal} suffix="kcal" />
            </div>
            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="small">Protein</span>
              <Stepper value={quickProtein} step={5} min={0} max={200} onChange={setQuickProtein} suffix="g" />
            </div>
            <button
              type="button"
              className="btn btn--soft btn--block btn--sm"
              style={{ marginTop: 12 }}
              onClick={() =>
                add({
                  id: `quick-${Date.now()}`,
                  name: 'Quick add',
                  emoji: '⚡',
                  portion: '1 entry',
                  nutrients: {
                    calories: quickKcal,
                    protein: quickProtein,
                    carbs: Math.max(0, Math.round((quickKcal - quickProtein * 4) / 8)),
                    fat: Math.max(0, Math.round((quickKcal - quickProtein * 4) / 18)),
                    fibre: 0,
                    sugar: 0,
                    sodium: 0,
                  },
                })
              }
            >
              Add {quickKcal} kcal
            </button>
          </div>
        </>
      )}

      {tab === 'describe' && (
        <div className="stack">
          <div className="describe-hero">
            <Squish mood="excited" size={92} bob={false} />
            <p className="speech">Tell me what you ate in your own words — I'll turn it into calories and macros.</p>
          </div>
          <textarea
            className="textarea"
            value={description}
            autoFocus
            rows={4}
            placeholder="e.g. chicken salad wrap, an apple and a flat white"
            onChange={(e) => setDescription(e.target.value)}
            aria-label="Describe your meal"
          />
          <div className="row wrap" style={{ gap: 8 }}>
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="chip" onClick={() => setDescription(example)}>
                {example.split(' ').slice(0, 3).join(' ')}…
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--block" onClick={() => void describe()}>
            <SparkIcon size={18} /> Work it out
          </button>
        </div>
      )}

      {tab === 'favourites' && (
        <div className="stack">
          {favourites.length === 0 ? (
            <div className="empty">
              <Squish mood="calm" size={92} bob={false} />
              <p style={{ marginTop: 8 }}>No favourites yet. Tap the heart on any food you log and it will live here.</p>
            </div>
          ) : (
            favourites.map((item) => (
              <button key={item.id} type="button" className="meal-card" onClick={() => add({ ...item, id: `${item.id}-${Date.now()}` })}>
                <span className="thumb thumb--emoji" aria-hidden="true">{item.emoji ?? '❤️'}</span>
                <span className="meal-card-body">
                  <span className="meal-card-title">{item.name}</span>
                  <span className="tiny muted">
                    {item.portion} · {Math.round(item.nutrients.calories)} kcal
                  </span>
                </span>
                <HeartIcon size={17} />
              </button>
            ))
          )}
        </div>
      )}

      {basket.length > 0 && (
        <div className="basket">
          <div>
            <b>
              {basket.length} item{basket.length === 1 ? '' : 's'}
            </b>
            <span className="tiny muted"> · {Math.round(totals.calories)} kcal</span>
          </div>
          <button type="button" className="btn btn--sm" onClick={reviewBasket}>
            Review
          </button>
        </div>
      )}
    </div>
  );
}
