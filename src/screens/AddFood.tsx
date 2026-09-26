import { useMemo, useState } from 'react';
import type { AnalysisResult, FoodItem, MealSlot } from '../types';
import Squish from '../components/Squish';
import EmptyState from '../components/EmptyState';
import DictateButton from '../components/DictateButton';
import { Segmented, Stepper, useToast } from '../components/ui';
import { CloseIcon, HeartIcon, PlusIcon, SearchIcon, SparkIcon } from '../components/icons';
import { useSquish } from '../store/useSquish';
import { searchFoods, toFoodItem } from '../lib/foods';
import { qualityScore, scaleNutrients, sumNutrients, ultraProcessedShare } from '../lib/nutrition';
import { analyseText, importRecipe, isPaywalled, SquishApiError, type RecipeImport } from '../lib/api';
import { slotForNow } from '../lib/date';
import './addfood.css';
import { describePortion } from '../lib/units';
import { currentEnergyUnit, energyValue, formatEnergy, toKcal } from '../lib/region';
import { plural, t } from '../lib/i18n';

type Tab = 'search' | 'describe' | 'recipe' | 'favourites';

/**
 * The heading says which of the four you are on, not that you are adding food.
 *
 * "Add food" was right when these tabs were how you chose. The add sheet does
 * that now, so arriving here having already chosen and being offered the same
 * four choices under the same word read as a menu you had somehow not got past.
 * Naming the tab confirms you landed where you meant to, and leaves the tabs
 * as what they actually are — a way to change your mind, not a decision.
 */
const TITLES: Record<Tab, string> = {
  search: t('Search foods'),
  describe: t('Describe a meal'),
  recipe: t('Import a recipe'),
  favourites: t('Saved meals'),
};

interface Props {
  slot?: MealSlot;
  date?: string;
  initialTab?: Tab;
  onCancel: () => void;
  onReady: (analysis: AnalysisResult, options: { slot?: MealSlot; date?: string }) => void;
}

const EXAMPLES = [
  t('two scrambled eggs on wholemeal toast with avocado'),
  t('chicken burrito and a diet cola'),
  t('porridge with blueberries and a spoon of peanut butter'),
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
  const [recipeUrl, setRecipeUrl] = useState('');
  const [recipe, setRecipe] = useState<RecipeImport | null>(null);
  const [helpings, setHelpings] = useState(1);
  // Whether any of the description was spoken, for the "Say it" badge.
  const [dictated, setDictated] = useState(false);

  const mealSlot = slot ?? slotForNow();
  const results = useMemo(() => searchFoods(query, 20), [query]);
  const totals = useMemo(() => sumNutrients(basket), [basket]);

  const add = (item: FoodItem) => {
    setBasket((list) => [...list, item]);
    toast(t('{food} added', { food: item.name }), '➕');
  };

  const reviewBasket = () => {
    if (!basket.length) return;
    onReady(
      {
        title: basket.length === 1 ? basket[0].name : t('{first} +{count} more', { first: basket[0].name, count: basket.length - 1 }),
        items: basket,
        nutrients: totals,
        score: qualityScore(totals, ultraProcessedShare(basket)),
        coachNote: '',
        confidence: 'high',
        slot: mealSlot,
      },
      { slot: mealSlot, date },
    );
  };

  const readRecipe = async () => {
    if (!recipeUrl.trim() || busy) return;
    setBusy(true);
    setRecipe(null);
    try {
      const imported = await importRecipe(recipeUrl.trim(), mealSlot);
      setRecipe(imported);
      setHelpings(1);
      useSquish.getState().unlock('first-recipe');
    } catch (error) {
      if (!isPaywalled(error)) toast(error instanceof SquishApiError ? error.message : t('That recipe could not be read.'), '📖');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The import is one serving. Multiply it by however many they actually had,
   * grams and all — a portion whose weight does not move with its nutrition is
   * the bug that made scanned meals so hard to edit.
   */
  const helping = (item: FoodItem): FoodItem => ({
    ...item,
    // "1/2 leek" stops being true the moment it is multiplied, so past a
    // single helping the weight speaks on its own.
    portion: helpings === 1 ? item.portion : '',
    grams: item.grams === undefined ? undefined : Math.round(item.grams * helpings),
    nutrients: scaleNutrients(item.nutrients, helpings),
  });

  const useRecipe = () => {
    if (!recipe) return;
    onReady(
      {
        ...recipe,
        items: recipe.items.map((item) => ({ ...helping(item), id: `${item.id}-${Math.random().toString(36).slice(2, 8)}` })),
        nutrients: scaleNutrients(recipe.nutrients, helpings),
      },
      { slot, date },
    );
  };

  const describe = async () => {
    const text = description.trim();
    if (text.length < 3) {
      toast(t('Tell me a little more about it.'), '✍️');
      return;
    }
    setBusy(true);
    try {
      const analysis = await analyseText(text, mealSlot);
      if (!analysis.items.length) {
        toast(t('I could not place that one — try the search tab.'), '😅');
        setBusy(false);
        return;
      }
      if (dictated) useSquish.getState().unlock('first-voice');
      onReady(analysis, { slot: analysis.slot ?? mealSlot, date });
    } catch (error) {
      if (!isPaywalled(error)) toast(error instanceof SquishApiError ? error.message : t('That did not work — give it another go.'), '😕');
      setBusy(false);
    }
  };

  if (busy) {
    return (
      <div className="screen addfood-busy">
        <Squish mood="thinking" size={150} />
        <h2>{t('Working out the numbers…')}</h2>
        <p className="muted small center">{t('Breaking your description into foods and portions.')}</p>
      </div>
    );
  }

  return (
    <div className="screen addfood">
      <header className="row-between">
        <button type="button" className="btn--quiet" onClick={onCancel} aria-label={t('Close')}>
          <CloseIcon />
        </button>
        <h2>{TITLES[tab]}</h2>
        <span style={{ width: 28 }} />
      </header>

      <Segmented<Tab>
        label={t('How would you like to add it?')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'search', label: t('Search') },
          { value: 'describe', label: t('Describe') },
          { value: 'recipe', label: t('Recipe') },
          { value: 'favourites', label: t('Saved') },
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
              placeholder={t('Search foods — rice, salmon, latte…')}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={t('Search foods')}
            />
          </div>

          <div className="stack">
            {results.map((food) => (
              <button key={food.id} type="button" className="meal-card" onClick={() => add(toFoodItem(food))}>
                <span className="thumb thumb--emoji" aria-hidden="true">{food.emoji}</span>
                <span className="meal-card-body">
                  <span className="meal-card-title">{food.name}</span>
                  <span className="tiny muted">
                    {describePortion(food.serving, food.servingG, food.tags.includes('drink'))} ·{' '}
                    {formatEnergy((food.per100.calories * food.servingG) / 100)}
                  </span>
                </span>
                <PlusIcon size={18} />
              </button>
            ))}
            {results.length === 0 && (
              <div className="empty">
                <p>{t('No match for “{query}”.', { query })}</p>
                <button type="button" className="btn btn--soft btn--sm" style={{ marginTop: 10 }} onClick={() => { setDescription(query); setTab('describe'); }}>
                  {t('Let Squish work it out instead')}
                </button>
              </div>
            )}
          </div>

          <div className="card quick-add">
            <h3>{t('Quick add')}</h3>
            <p className="tiny muted">{t('Know the numbers already? Pop them straight in.')}</p>
            <div className="row-between" style={{ marginTop: 10 }}>
              <span className="small">{currentEnergyUnit() === 'kJ' ? t('Energy') : t('Calories')}</span>
              {currentEnergyUnit() === 'kJ' ? (
                <Stepper value={energyValue(quickKcal)} step={200} min={0} max={12600} onChange={(kj) => setQuickKcal(toKcal(kj))} suffix="kJ" />
              ) : (
                <Stepper value={quickKcal} step={50} min={0} max={3000} onChange={setQuickKcal} suffix="kcal" />
              )}
            </div>
            <div className="row-between" style={{ marginTop: 8 }}>
              <span className="small">{t('Protein')}</span>
              <Stepper value={quickProtein} step={5} min={0} max={200} onChange={setQuickProtein} suffix="g" />
            </div>
            <button
              type="button"
              className="btn btn--soft btn--block btn--sm"
              style={{ marginTop: 12 }}
              onClick={() =>
                add({
                  id: `quick-${Date.now()}`,
                  name: t('Quick add'),
                  emoji: '⚡',
                  portion: t('1 entry'),
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
              {t('Add {energy}', { energy: formatEnergy(quickKcal) })}
            </button>
          </div>
        </>
      )}

      {tab === 'describe' && (
        <div className="stack">
          <div className="describe-hero">
            <Squish mood="excited" size={92} bob={false} />
            <p className="speech">{t("Tell me what you ate in your own words — I'll turn it into calories and macros.")}</p>
          </div>
          <textarea
            className="textarea"
            value={description}
            autoFocus
            rows={4}
            placeholder={t('e.g. chicken salad wrap, an apple and a flat white')}
            onChange={(e) => setDescription(e.target.value)}
            aria-label={t('Describe your meal')}
          />
          {/* Appended rather than replacing: people dictate the bulk of it and
              then tidy up the bit it misheard. */}
          <DictateButton
            label={t('your meal')}
            onText={(text) => {
              setDictated(true);
              setDescription((current) => (current ? `${current.trim()} ${text}` : text));
            }}
            onError={(message) => toast(message, '🎤')}
          />
          <div className="row wrap" style={{ gap: 8 }}>
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="chip" onClick={() => setDescription(example)}>
                {example.split(' ').slice(0, 3).join(' ')}…
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--block" onClick={() => void describe()}>
            <SparkIcon size={18} /> {t('Work it out')}
          </button>
        </div>
      )}

      {tab === 'recipe' && (
        <div className="stack">
          <div className="describe-hero">
            <Squish mood="excited" size={92} bob={false} />
            <p className="speech">{t("Paste a recipe from anywhere on the web and I'll work out what one helping of it comes to.")}</p>
          </div>
          <input
            className="input"
            type="url"
            inputMode="url"
            value={recipeUrl}
            placeholder="https://…"
            aria-label={t('Recipe web address')}
            onChange={(e) => setRecipeUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void readRecipe();
              }
            }}
          />
          <button type="button" className="btn btn--block" disabled={!recipeUrl.trim() || busy} onClick={() => void readRecipe()}>
            <SparkIcon size={18} /> {busy ? t('Reading…') : t('Read the recipe')}
          </button>

          {recipe && (
            <section className="card recipe-result">
              <div className="card-title">
                <h3>{recipe.title}</h3>
                <span className="tiny muted">
                  {plural(recipe.servings, { one: 'makes {n} serving', other: 'makes {n} servings' })}
                </span>
              </div>

              <div className="row-between">
                <span className="small">{t('How many did you have?')}</span>
                <Stepper value={helpings} step={0.5} min={0.5} max={10} onChange={setHelpings} suffix="×" />
              </div>

              <div className="divider" />
              <div className="row-between">
                <b style={{ fontSize: 22 }}>{formatEnergy(recipe.nutrients.calories * helpings)}</b>
                <span className="tiny muted">
                  {t('P{protein} C{carbs} F{fat}', {
                    protein: Math.round(recipe.nutrients.protein * helpings),
                    carbs: Math.round(recipe.nutrients.carbs * helpings),
                    fat: Math.round(recipe.nutrients.fat * helpings),
                  })}
                </span>
              </div>

              {/* Shown exactly as it will be logged, weights and all — a list
                  whose calories move with the stepper and whose grams do not
                  is the kind of thing nobody notices until they do. */}
              <div className="card card--tint card--flat" style={{ marginTop: 10 }}>
                {recipe.items.map((item) => {
                  const scaled = helping(item);
                  return (
                    <div className="list-row" key={item.id}>
                      <span className="thumb thumb--emoji" aria-hidden="true">{item.emoji ?? '🍽️'}</span>
                      <span className="grow">
                        <b className="small">{item.name}</b>
                        <p className="tiny muted">{describePortion(scaled.portion, scaled.grams, scaled.liquid)}</p>
                      </span>
                      <span className="small">{formatEnergy(scaled.nutrients.calories)}</span>
                    </div>
                  );
                })}
              </div>

              {/* An estimate off somebody else's ingredient list is a rung
                  further from the truth than a photo of the actual plate, and
                  it should not pretend otherwise. */}
              <p className="tiny muted" style={{ marginTop: 10 }}>
                {t('Worked out from the ingredients on the page — check it against what you actually put in.')}
              </p>

              <button type="button" className="btn btn--block" style={{ marginTop: 10 }} onClick={useRecipe}>
                <PlusIcon size={18} /> {t('Use this')}
              </button>
            </section>
          )}
        </div>
      )}

      {tab === 'favourites' && (
        <div className="stack">
          {favourites.length === 0 ? (
            <EmptyState mood="calm">
              {t('No favourites yet. Tap the heart on any food you log and it will live here.')}
            </EmptyState>
          ) : (
            favourites.map((item) => (
              <button key={item.id} type="button" className="meal-card" onClick={() => add({ ...item, id: `${item.id}-${Date.now()}` })}>
                <span className="thumb thumb--emoji" aria-hidden="true">{item.emoji ?? '❤️'}</span>
                <span className="meal-card-body">
                  <span className="meal-card-title">{item.name}</span>
                  <span className="tiny muted">
                    {describePortion(item.portion, item.grams, item.liquid)} · {formatEnergy(item.nutrients.calories)}
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
            <b>{plural(basket.length, { one: '{n} item', other: '{n} items' })}</b>
            <span className="tiny muted"> · {formatEnergy(totals.calories)}</span>
          </div>
          <button type="button" className="btn btn--sm" onClick={reviewBasket}>
            {t('Review')}
          </button>
        </div>
      )}
    </div>
  );
}
