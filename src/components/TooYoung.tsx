/**
 * What somebody under 18 sees instead of Squish.
 *
 * Kind, short and not a telling-off: they have done nothing wrong by being
 * curious about what they eat. It says why, points to people who can help,
 * and lets somebody who simply mistyped their age put it right.
 *
 * Nothing about them is kept: the age they typed is not saved anywhere.
 */
import { useState } from 'react';
import Squish from './Squish';
import { NumberField } from './fields';
import { MIN_AGE } from '../store/useSquish';
import './too-young.css';
import { t } from '../lib/i18n';
import { rich } from '../lib/i18n-react';

/**
 * Where a young person can turn, in their own country: the national eating
 * disorder charity, each with support aimed at young people.
 */
const HELP: Record<Region, { name: string; site: string }> = {
  GB: { name: 'Beat', site: 'beateatingdisorders.org.uk' },
  IE: { name: 'Bodywhys', site: 'bodywhys.ie' },
  US: { name: 'ANAD', site: 'anad.org' },
  CA: { name: 'NEDIC', site: 'nedic.ca' },
  AU: { name: 'Butterfly Foundation', site: 'butterfly.org.au' },
  NZ: { name: 'EDANZ', site: 'ed.org.nz' },
};
import { currentRegion, type Region } from '../lib/region';

export default function TooYoung({
  onBack,
  onCorrected,
}: {
  /** During setup: back to the form, to fix a typo. */
  onBack?: () => void;
  /** For a profile already saved with an age under 18: put the right one in. */
  onCorrected?: (age: number) => void;
}) {
  const [fixing, setFixing] = useState(false);
  const [age, setAge] = useState(MIN_AGE);
  const help = HELP[currentRegion().id];

  return (
    <div className="too-young" role="region" aria-labelledby="too-young-title">
      <Squish mood="calm" size={120} bob={false} />
      <h1 id="too-young-title">{t('Squish is for grown-ups')}</h1>
      <p>
        {t('Squish is made for people aged {age} and over. It works with calorie targets and diet feedback, which are not right for a body that is still growing.', { age: MIN_AGE })}
      </p>
      <p>
        {rich('If you would like help with eating well, a parent or carer, your school nurse or your doctor is a great place to start. And if food or your body ever feels like a worry, <b>{charity}</b>, an eating disorder charity in {country}, has help for young people at {link}.', {
          charity: help.name,
          country: t(currentRegion().name),
          link: (
            <a href={`https://${help.site}`} target="_blank" rel="noopener noreferrer">
              {help.site}
            </a>
          ),
        }, { b: (text) => <b>{text}</b> })}
      </p>

      {onBack && (
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          {t('I typed my age wrong')}
        </button>
      )}

      {onCorrected &&
        (fixing ? (
          <form
            className="too-young-fix"
            onSubmit={(event) => {
              event.preventDefault();
              onCorrected(age);
            }}
          >
            <NumberField label={t('Your age')} value={age} suffix={t('yrs')} min={MIN_AGE} max={100} onChange={setAge} />
            <button type="submit" className="btn">
              {t('Save')}
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => setFixing(true)}>
            {t('My age is wrong')}
          </button>
        ))}
    </div>
  );
}
