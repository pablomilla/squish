import { useMemo } from 'react';
import type { Route } from '../types';
import Squish from './Squish';
import { SparkIcon } from './icons';
import { useSquish } from '../store/useSquish';
import { useNutritionistAccess } from './useSubscribed';
import { isoDate } from '../lib/date';
import { suggestedQuestions } from '../lib/askSuggestions';
import './nutritionist-card.css';

/**
 * The nutritionist, on Home, where it can be seen.
 *
 * It used to be one button among the logging ones, labelled with its own
 * name, which is the name of a thing nobody has tried. This is the card for
 * it: Squish thinking, a line on what it does, and two or three questions
 * about their own day that a tap asks — so the first thing anybody sees is
 * what they would get, not that they could ask.
 */
export default function NutritionistCard({ go }: { go: (route: Route) => void }) {
  const meals = useSquish((s) => s.meals);
  const targets = useSquish((s) => s.targets);
  const access = useNutritionistAccess();
  const today = isoDate();
  const questions = useMemo(() => suggestedQuestions(meals, targets, today, new Date().getHours(), 3), [meals, targets, today]);

  return (
    <section className="card nutri-card" aria-labelledby="nutri-title">
      <div className="nutri-head">
        <Squish mood="thinking" size={58} bob={false} label="" />
        <div className="nutri-head-text">
          <h3 id="nutri-title">Your nutritionist</h3>
          <p className="tiny">Reads your diary before it answers</p>
        </div>
        {access.label && <span className="badge nutri-badge">{access.label}</span>}
      </div>
      <div className="nutri-questions">
        {questions.map((question) => (
          <button key={question} type="button" className="nutri-q" onClick={() => go({ name: 'ask', question })}>
            {question}
          </button>
        ))}
      </div>
      <button type="button" className="nutri-ask" onClick={() => go({ name: 'ask' })}>
        <SparkIcon size={16} /> What’s on your mind?
      </button>
    </section>
  );
}
