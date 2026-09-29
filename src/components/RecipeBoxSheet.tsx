import { useCallback, useMemo, useRef, useState } from 'react';
import type { CookSteps, MealSlot, Recipe } from '../types';
import Squish from './Squish';
import { Segmented, Sheet, useToast } from './ui';
import { ChevronIcon, SearchIcon } from './icons';
import { CookMode, Ingredients, MethodSection, ServesStepper, useMethod } from './cookParts';
import { useSquish } from '../store/useSquish';
import { friendlyDate, isoDate, slotForNow } from '../lib/date';
import { planDays, servingsFor } from '../lib/planner';
import { madeOf, orderRecipes, searchRecipes } from '../lib/recipes';
import { formatEnergy } from '../lib/region';
import { plural, t } from '../lib/i18n';
import { slotName } from '../lib/words';
import './recipe-box.css';

/**
 * The recipe box: meals kept to make again, the most made first.
 *
 * One sheet that turns from the list to a recipe and back, rather than a sheet
 * on a sheet. A recipe here is what a planned meal is — its ingredients, its
 * method written once and kept, cooking it a step at a time — with the two
 * things a box is for: plan it for a day, or say it was made today.
 */
export default function RecipeBoxSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const recipes = useSquish((s) => s.recipes);
  const meals = useSquish((s) => s.meals);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const ordered = useMemo(() => orderRecipes(recipes, meals), [recipes, meals]);
  const shown = useMemo(() => searchRecipes(ordered, query), [ordered, query]);
  const recipe = openId ? recipes.find((r) => r.id === openId) : undefined;

  const close = () => {
    setOpenId(null);
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={t('My recipes')}>
      {recipe ? (
        <RecipeView key={recipe.id} recipe={recipe} onBack={() => setOpenId(null)} onDone={close} />
      ) : recipes.length === 0 ? (
        <div className="recipe-box-empty">
          <Squish mood="calm" size={88} />
          <p className="small muted">
            {t('Nothing saved yet. Tap Save on a planned meal or on a meal in your diary, or save a recipe you import, and it lives here — ready to plan again.')}
          </p>
        </div>
      ) : (
        <div className="recipe-box">
          {recipes.length > 6 && (
            <label className="recipe-box-search">
              <SearchIcon size={18} />
              <input type="search" value={query} placeholder={t('Search your recipes')} aria-label={t('Search your recipes')} onChange={(e) => setQuery(e.target.value)} />
            </label>
          )}
          {shown.length === 0 && <p className="small muted center">{t('Nothing in your recipes matches that.')}</p>}
          <ul className="recipe-box-list">
            {shown.map((r) => {
              const made = madeOf(r, meals);
              return (
                <li key={r.id}>
                  <button type="button" className="recipe-row" onClick={() => setOpenId(r.id)}>
                    <span className="recipe-row-emoji" aria-hidden="true">{r.items[0]?.emoji ?? '🍽️'}</span>
                    <span className="recipe-row-text">
                      <span className="recipe-row-title" dir="auto">{r.title}</span>
                      <span className="tiny muted">
                        {formatEnergy(r.nutrients.calories)} · {t('P{protein}', { protein: Math.round(r.nutrients.protein) })} ·{' '}
                        {made.times ? plural(made.times, { one: 'made once', other: 'made {n} times' }) : t('not made yet')}
                      </span>
                    </span>
                    <ChevronIcon size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function RecipeView({ recipe, onBack, onDone }: { recipe: Recipe; onBack: () => void; onDone: () => void }) {
  const { meals, household, addPlan, addMeal, removeRecipe, setRecipeCook } = useSquish();
  const toast = useToast();
  const today = isoDate();
  const [servings, setServings] = useState(() => servingsFor({ slot: recipe.slot }, household));
  // For checking that steps coming back are for the number it serves now.
  const servingsNow = useRef(servings);
  const serve = (n: number) => {
    servingsNow.current = n;
    setServings(n);
  };
  const [planning, setPlanning] = useState(false);
  const [day, setDay] = useState(today);
  const [slot, setSlot] = useState<MealSlot>(recipe.slot);
  const [removing, setRemoving] = useState(false);
  const [cooking, setCooking] = useState(false);
  const made = madeOf(recipe, meals);

  const keep = useCallback((steps: CookSteps) => setRecipeCook(recipe.id, steps), [recipe.id, setRecipeCook]);
  const current = useCallback(() => {
    const now = useSquish.getState().recipes.find((r) => r.id === recipe.id);
    return now && { title: now.title, servings: servingsNow.current };
  }, [recipe.id]);
  const method = useMethod({ id: recipe.id, meal: recipe, servings, stored: recipe.cook, open: true, keep, current });

  const madeIt = () => {
    addMeal({ slot: slotForNow(), title: recipe.title, items: recipe.items, nutrients: recipe.nutrients, score: recipe.score, source: 'favourite' });
    toast(t('Squished it — {energy} logged.', { energy: formatEnergy(recipe.nutrients.calories) }), '🎉');
    onDone();
  };

  const plan = () => {
    const usual = servingsFor({ slot }, household);
    addPlan({
      date: day,
      slot,
      title: recipe.title,
      items: recipe.items,
      nutrients: recipe.nutrients,
      score: recipe.score,
      source: 'favourite',
      ...(recipe.cook ? { cook: recipe.cook } : {}),
      ...(servings !== usual ? { servings } : {}),
    });
    toast(t('Planned for {day} — and on your shopping list.', { day: friendlyDate(day).toLocaleLowerCase() }), '🗓️');
    onDone();
  };

  return (
    <div className="cook">
      <button type="button" className="btn--quiet small recipe-back" onClick={onBack}>
        ‹ {t('All recipes')}
      </button>
      <div>
        <h3 className="recipe-title" dir="auto">{recipe.title}</h3>
        <p className="tiny muted cook-meta">
          {slotName(recipe.slot)} · {formatEnergy(recipe.nutrients.calories)} · {t('P{protein}', { protein: Math.round(recipe.nutrients.protein) })}
          {method.steps && ` · ${t('about {minutes} min', { minutes: method.steps.minutes })}`}
          {' · '}
          {made.times
            ? plural(made.times, { one: 'made once, {last}', other: 'made {n} times, last {last}' }, { last: friendlyDate(made.last!).toLocaleLowerCase() })
            : t('not made yet')}
        </p>
        {recipe.sourceUrl && (
          <a className="tiny recipe-source" href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer">
            {t('From {site}', { site: hostOf(recipe.sourceUrl) })} ↗
          </a>
        )}
      </div>

      {planning ? (
        <section className="recipe-plan">
          <h3 className="cook-head">{t('When?')}</h3>
          <div className="week-chips">
            {planDays(today).map((d) => (
              <button key={d} type="button" className={`chip${d === day ? ' chip--on' : ''}`} aria-pressed={d === day} onClick={() => setDay(d)}>
                {friendlyDate(d)}
              </button>
            ))}
          </div>
          <Segmented<MealSlot> label={t('Which meal')} value={slot} onChange={setSlot} options={SLOTS.map((s) => ({ value: s, label: slotName(s) }))} />
          <div className="cook-actions">
            <button type="button" className="btn btn--block" onClick={plan}>
              {t('Plan it for {day}', { day: friendlyDate(day).toLocaleLowerCase() })}
            </button>
            <button type="button" className="btn--quiet small" onClick={() => setPlanning(false)}>
              {t('Cancel')}
            </button>
          </div>
        </section>
      ) : (
        <>
          <section>
            <div className="row-between">
              <h3 className="cook-head">{t('Ingredients')}</h3>
              <ServesStepper servings={servings} onChange={serve} />
            </div>
            <Ingredients items={recipe.items} servings={servings} />
            <p className="tiny muted">
              {servings === 1
                ? t('For one, as you had it. These amounts are what gets logged.')
                : t('For {n}. Your portion is one of them — {energy} — and that is what gets logged.', { n: servings, energy: formatEnergy(recipe.nutrients.calories) })}
            </p>
          </section>

          <MethodSection method={method} />

          <div className="cook-actions">
            <button type="button" className="btn btn--block" onClick={() => setPlanning(true)}>
              {t('Plan it')}
            </button>
            {method.steps && (
              <button type="button" className="btn btn--soft btn--block" onClick={() => setCooking(true)}>
                {t('Start cooking')}
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--block" onClick={madeIt}>
              {t('I made this today')}
            </button>
            {removing ? (
              <div className="week-discard" role="alertdialog" aria-labelledby="recipe-remove-q">
                <p className="small" id="recipe-remove-q">
                  {t('Take {meal} out of your recipes? Meals in your diary stay as they are.', { meal: recipe.title })}
                </p>
                <div className="row" style={{ gap: 10 }}>
                  <button type="button" className="btn btn--sm btn--ghost grow" onClick={() => setRemoving(false)}>
                    {t('Keep it')}
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--danger grow"
                    onClick={() => {
                      removeRecipe(recipe.id);
                      toast(t('Taken out of your recipes.'), '📕');
                      onBack();
                    }}
                  >
                    {t('Take it out')}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn--quiet small recipe-remove" onClick={() => setRemoving(true)}>
                {t('Take it out of my recipes')}
              </button>
            )}
          </div>
        </>
      )}

      {cooking && method.steps && <CookMode plan={recipe} steps={method.steps.steps} onClose={() => setCooking(false)} onDone={madeIt} />}
    </div>
  );
}

/** The site a recipe came from, without the "www.". */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
