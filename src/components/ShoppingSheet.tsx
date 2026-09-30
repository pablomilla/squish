import { useMemo, useState } from 'react';
import { Segmented, Sheet, useToast } from './ui';
import HouseholdPicker from './HouseholdPicker';
import { CloseIcon } from './icons';
import { useSquish } from '../store/useSquish';
import { addDays, friendlyDate, isoDate } from '../lib/date';
import { AISLES, listAsText, shoppingList } from '../lib/shopping';
import './shopping.css';
import { plural, t } from '../lib/i18n';

type Range = '3' | '7';

/**
 * The shopping list: every food in the meals planned for the next few days,
 * added up and in aisle order, with a box to tick as it goes in the basket
 * and a line for the things no plan knows about (washing-up liquid, say).
 *
 * Nothing here is saved but the ticks and the hand-added lines: the list
 * itself is made fresh from the plans every time it opens, so planning
 * another dinner puts its food straight on it.
 *
 * Opened from a day ahead in the diary, it starts from that day: looking at
 * Saturday and opening the list is shopping for the weekend.
 */
export default function ShoppingSheet({ open, onClose, from: fromDay }: { open: boolean; onClose: () => void; from?: string }) {
  const plans = useSquish((s) => s.plans);
  const shopping = useSquish((s) => s.shopping);
  const household = useSquish((s) => s.household);
  const { toggleShoppingTick, addShoppingExtra, removeShoppingExtra, clearShoppingTicked } = useSquish.getState();
  const toast = useToast();
  const [range, setRange] = useState<Range>('7');
  const [adding, setAdding] = useState('');

  const today = isoDate();
  // Nothing is bought for a day gone: a day before today starts from today.
  const from = fromDay && fromDay > today ? fromDay : today;
  const until = addDays(from, Number(range) - 1);
  const lines = useMemo(() => shoppingList(plans, from, until, household), [plans, from, until, household]);
  const planned = plans.filter((p) => p.date >= from && p.date <= until).length;
  const days = (n: number) => (from === today ? t('Next {n} days', { n }) : plural(n, { one: '{n} day', other: '{n} days' }));
  const ticked = new Set(shopping.ticked);
  const left = lines.filter((l) => !ticked.has(l.key)).length + shopping.extras.filter((e) => !ticked.has(`extra:${e.id}`)).length;

  const share = async () => {
    const text = listAsText(lines, shopping.extras, ticked);
    try {
      if (navigator.share) {
        await navigator.share({ title: t('Shopping list'), text });
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(t('Shopping list copied'), '📋');
    } catch {
      toast(t('Could not copy the list on this device'), '😕');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('Shopping list')}>
      <div className="shopping">
        {from !== today && (
          <p className="small shopping-from">
            {t('Starting {day}', { day: from === addDays(today, 1) ? friendlyDate(from).toLocaleLowerCase() : friendlyDate(from) })}
          </p>
        )}
        <Segmented<Range>
          label={t('How far ahead')}
          value={range}
          onChange={setRange}
          options={[
            { value: '3', label: days(3) },
            { value: '7', label: days(7) },
          ]}
        />
        <HouseholdPicker />
        <p className="tiny muted">
          {planned
            ? plural(planned, {
                one: 'From {n} planned meal. Amounts are what the plans add up to — check the cupboard first.',
                other: 'From {n} planned meals. Amounts are what the plans add up to — check the cupboard first.',
              })
            : t('Nothing planned for these days yet. Plan meals in your diary and their food appears here.')}
        </p>

        {AISLES.map((aisle) => {
          const here = lines.filter((line) => line.aisle === aisle.id);
          if (!here.length) return null;
          return (
            <div key={aisle.id} className="shopping-aisle">
              <h4 className="tiny">{aisle.title}</h4>
              <ul>
                {here.map((line) => {
                  const done = ticked.has(line.key);
                  return (
                    <li key={line.key}>
                      <label className={`shopping-line${done ? ' is-done' : ''}`}>
                        <input type="checkbox" checked={done} onChange={() => toggleShoppingTick(line.key)} />
                        <span className="shopping-text">
                          <span className="shopping-name" dir="auto">{line.name}</span>
                          <span className="tiny muted">
                            {line.amount} · {line.meals.join(', ')}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        <div className="shopping-aisle">
          <h4 className="tiny">{t('Also')}</h4>
          {shopping.extras.length > 0 && (
            <ul>
              {shopping.extras.map((extra) => {
                const key = `extra:${extra.id}`;
                const done = ticked.has(key);
                return (
                  <li key={extra.id} className="shopping-extra">
                    <label className={`shopping-line${done ? ' is-done' : ''}`}>
                      <input type="checkbox" checked={done} onChange={() => toggleShoppingTick(key)} />
                      <span className="shopping-name">{extra.name}</span>
                    </label>
                    <button type="button" className="icon-btn" aria-label={t('Remove {item}', { item: extra.name })} onClick={() => removeShoppingExtra(extra.id)}>
                      <CloseIcon size={15} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <form
            className="shopping-add"
            onSubmit={(event) => {
              event.preventDefault();
              addShoppingExtra(adding);
              setAdding('');
            }}
          >
            <input className="input" value={adding} maxLength={60} placeholder={t('Add something else…')} aria-label={t('Add to the list')} onChange={(e) => setAdding(e.target.value)} />
            <button type="submit" className="btn btn--sm btn--soft" disabled={!adding.trim()}>
              {t('Add')}
            </button>
          </form>
        </div>

        <div className="shopping-actions">
          <button type="button" className="btn btn--block" disabled={left === 0} onClick={() => void share()}>
            {left ? t('Share the list ({n})', { n: left }) : t('Share the list')}
          </button>
          {shopping.ticked.length > 0 && (
            <button
              type="button"
              className="btn--quiet small"
              onClick={() => {
                clearShoppingTicked();
                toast(t('Ticked items cleared'), '🧺');
              }}
            >
              {t('Done shopping — clear ticked')}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
