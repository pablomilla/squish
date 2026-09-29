import { Segmented } from './ui';
import { useSquish } from '../store/useSquish';
import { MAX_SERVINGS } from '../lib/planner';
import { plural, t } from '../lib/i18n';

/**
 * Who they cook for: how many, and whether that is just dinner or every
 * meal. Scales the recipes and the shopping list; the diary still gets one
 * portion. The same setting wherever it is shown — the shopping list and the
 * week's plan both ask, since both are where it matters.
 */
export default function HouseholdPicker() {
  const household = useSquish((s) => s.household);
  const setHousehold = useSquish((s) => s.setHousehold);
  return (
    <div className="household">
      <div className="row-between">
        <span className="small">{t('Cooking for')}</span>
        <div className="stepper">
          <button type="button" aria-label={t('Fewer people')} disabled={household.people <= 1} onClick={() => setHousehold({ ...household, people: household.people - 1 })}>
            −
          </button>
          <span aria-live="polite">{household.people === 1 ? t('Just me') : plural(household.people, { one: '{n} person', other: '{n} people' })}</span>
          <button type="button" aria-label={t('More people')} disabled={household.people >= MAX_SERVINGS} onClick={() => setHousehold({ ...household, people: household.people + 1 })}>
            +
          </button>
        </div>
      </div>
      {household.people > 1 && (
        <Segmented<'dinner' | 'all'>
          label={t('Which meals are shared')}
          value={household.shared}
          onChange={(shared) => setHousehold({ ...household, shared })}
          options={[
            { value: 'dinner', label: t('Dinners together') },
            { value: 'all', label: t('Every meal') },
          ]}
        />
      )}
    </div>
  );
}
