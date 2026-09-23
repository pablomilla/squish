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

  return (
    <div className="too-young" role="region" aria-labelledby="too-young-title">
      <Squish mood="calm" size={120} bob={false} />
      <h1 id="too-young-title">Squish is for grown-ups</h1>
      <p>
        Squish is made for people aged {MIN_AGE} and over. It works with calorie targets and diet feedback, which are
        not right for a body that is still growing.
      </p>
      <p>
        If you would like help with eating well, a parent or carer, your school nurse or your GP is a great place to
        start. And if food or your body ever feels like a worry, <b>Beat</b>, the UK's eating disorder charity, has a
        helpline just for young people at{' '}
        <a href="https://www.beateatingdisorders.org.uk" target="_blank" rel="noopener noreferrer">
          beateatingdisorders.org.uk
        </a>
        .
      </p>

      {onBack && (
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          I typed my age wrong
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
            <NumberField label="Your age" value={age} suffix="yrs" min={MIN_AGE} max={100} onChange={setAge} />
            <button type="submit" className="btn">
              Save
            </button>
          </form>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => setFixing(true)}>
            My age is wrong
          </button>
        ))}
    </div>
  );
}
