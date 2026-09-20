import { useEffect, useMemo, useRef, useState } from 'react';
import Squish from '../components/Squish';
import DictateButton from '../components/DictateButton';
import { CloseIcon, SparkIcon } from '../components/icons';
import { useToast } from '../components/ui';
import { useSquish } from '../store/useSquish';
import { askSquish, SquishApiError, type ChatTurn } from '../lib/api';
import { isoDate, lastDays } from '../lib/date';
import { mealsOn, series, streakOf, summarise, totalsOn } from '../lib/selectors';
import { saltGrams } from '../lib/units';
import './ask.css';

const OPENERS = [
  'How am I doing this week?',
  "What's missing from my diet?",
  'Ideas for more protein at breakfast',
  'Why is my day scoring low?',
];

/**
 * Ask Squish.
 *
 * The conversation lives here and nowhere else — not in the store, not on the
 * server. Close the screen and it is gone. That is deliberate: a chat about
 * what somebody eats is the most personal thing in this app, and the least
 * useful to keep.
 */
export default function Ask({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { profile, targets, meals } = useSquish();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const today = isoDate();

  // Everything the answer is grounded in, rebuilt only when the diary moves.
  const context = useMemo(() => {
    const todayTotals = totalsOn(meals, today);
    const mealCount = mealsOn(meals, today).length;
    const week = summarise(series(meals, lastDays(7, today), targets), targets);
    const salt = saltGrams(todayTotals.sodium ?? 0);

    return {
      goal: profile.goal,
      calorieTarget: targets.calories,
      proteinTarget: targets.protein,
      today: todayTotals.calories
        ? `${Math.round(todayTotals.calories)} kcal, ${Math.round(todayTotals.protein)} g protein, ` +
          `${Math.round(todayTotals.fibre)} g fibre, ${salt} g salt, across ${mealCount} meal${mealCount === 1 ? '' : 's'}`
        : 'nothing logged yet',
      week: week.loggedDays
        ? `${week.loggedDays} of 7 days logged, averaging ${week.avgCalories} kcal, ` +
          `${week.avgProtein} g protein and ${week.avgFibre} g fibre, quality score ${week.avgScore}`
        : 'nothing logged',
      streak: streakOf(meals, today),
      recentMeals: meals.slice(-8).map((m) => `${m.title} (${Math.round(m.nutrients.calories)} kcal)`),
    };
  }, [meals, targets, profile.goal, today]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, thinking]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || thinking) return;

    const next: ChatTurn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setDraft('');
    setThinking(true);

    try {
      const reply = await askSquish(next, context);
      setTurns([...next, { role: 'assistant', content: reply }]);
    } catch (error) {
      // The question stays on screen so it can be tried again rather than
      // retyped, and the failure is said out loud rather than swallowed.
      setTurns(next);
      toast(error instanceof SquishApiError ? error.message : 'I could not answer just then.', '💭');
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="screen ask">
      <header className="screen-head">
        <div>
          <h1>Ask Squish</h1>
          <p>Questions about your own diary</p>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </header>

      <div className="ask-thread">
        {turns.length === 0 && (
          <div className="ask-empty">
            <Squish mood="calm" size={104} />
            <p className="speech">
              Ask me anything about what you have been eating. I can see your diary, but I am an app — for anything
              medical, see a GP or a dietitian.
            </p>
            <div className="ask-openers">
              {OPENERS.map((opener) => (
                <button key={opener} type="button" className="chip" onClick={() => void ask(opener)}>
                  {opener}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <div key={`${turn.role}-${index}`} className={`ask-turn ask-turn--${turn.role}`}>
            {turn.content.split('\n').filter(Boolean).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ))}

        {thinking && (
          <div className="ask-turn ask-turn--assistant ask-thinking" aria-live="polite">
            <span className="ask-dot" />
            <span className="ask-dot" />
            <span className="ask-dot" />
            <span className="visually-hidden">Squish is thinking</span>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="ask-composer">
        <div className="fix-row">
          <input
            className="input"
            value={draft}
            disabled={thinking}
            placeholder="Ask about your diary…"
            aria-label="Your question"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void ask(draft);
              }
            }}
          />
          <button type="button" className="btn btn--soft" disabled={!draft.trim() || thinking} onClick={() => void ask(draft)}>
            <SparkIcon size={17} />
          </button>
        </div>
        <DictateButton
          label="your question"
          onText={(text) => setDraft((current) => (current ? `${current.trim()} ${text}` : text))}
          onError={(message) => toast(message, '🎤')}
        />
      </div>
    </div>
  );
}
