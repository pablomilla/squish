import Squish from './Squish';
import { useNutritionistAccess } from './useSubscribed';
import './nutritionist-card.css';

/**
 * "Ask the nutritionist" beside the thing somebody is looking at — the day's
 * score, a meal, the week — with the question already written. The moment
 * somebody wonders why is the moment the nutritionist is worth most, and the
 * easiest moment to find out it exists.
 */
export default function AskLink({ question, onAsk, label = 'Ask the nutritionist' }: { question: string; onAsk: (question: string) => void; label?: string }) {
  const access = useNutritionistAccess();
  return (
    <button type="button" className="ask-link" onClick={() => onAsk(question)}>
      <Squish mood="thinking" size={32} bob={false} label="" />
      <span className="ask-link-text">
        <span className="ask-link-label">
          {label}
          {access.label && <span className="ask-link-badge">{access.label}</span>}
        </span>
        <span className="ask-link-q">“{question}”</span>
      </span>
    </button>
  );
}
