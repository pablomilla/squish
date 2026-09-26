import Squish from './Squish';
import './nutritionist-pitch.css';
import { t } from '../lib/i18n';
import { rich } from '../lib/i18n-react';

/**
 * What the nutritionist is, shown rather than described.
 *
 * A single made-up exchange — labelled as one — because "an AI nutritionist"
 * is a phrase everybody has read and nobody pictures. What makes this one
 * different is that it looked in *their* diary before answering, so the
 * example shows it doing exactly that: the lookup, then an answer with their
 * numbers in it. Used on the upgrade sheet and wherever the nutritionist is
 * locked.
 */
export default function NutritionistPitch({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`pitch${compact ? ' pitch--compact' : ''}`}>
      <p className="tiny pitch-label">{t('For example')}</p>
      <div className="pitch-thread" aria-label={t('An example conversation with the nutritionist')}>
        <p className="pitch-me">{t('Why am I always starving by 11?')}</p>
        <div className="pitch-them">
          <Squish mood="thinking" size={34} bob={false} label="" />
          <div>
            <p className="pitch-looked">{t('Looked at your last 7 breakfasts')}</p>
            <p>
              {t('They’ve averaged 9 g of protein — mostly toast and jam. Porridge made with milk and a spoonful of Greek yoghurt is nearer 25 g, and should carry you to lunch.')}
            </p>
          </div>
        </div>
      </div>
      {!compact && (
        <ul className="pitch-points">
          <li>
            {rich('<b>Reads your diary before it answers</b> — every meal, every day, every vitamin Squish tracks', {}, { b: (text) => <b>{text}</b> })}
          </li>
          <li>
            {rich('<b>Plans your week</b> — meals around your targets, with the shopping list to match', {}, { b: (text) => <b>{text}</b> })}
          </li>
          <li>
            {rich('<b>Remembers what matters</b> — an allergy, a food you avoid, what you’re training for', {}, { b: (text) => <b>{text}</b> })}
          </li>
        </ul>
      )}
    </div>
  );
}
