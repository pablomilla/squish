import { useEffect, useMemo, useRef, useState } from 'react';
import Squish from '../components/Squish';
import DictateButton from '../components/DictateButton';
import { CloseIcon, SparkIcon, TrashIcon } from '../components/icons';
import { useToast } from '../components/ui';
import { useSquish } from '../store/useSquish';
import { askNutritionist, SquishApiError, type ChatMessage } from '../lib/api';
import { runTool, type Diary, type ToolCall } from '../lib/nutritionist-tools';
import { isoDate, lastDays } from '../lib/date';
import { mealsOn, series, streakOf, summarise, totalsOn } from '../lib/selectors';
import { saltGrams } from '../lib/units';
import './ask.css';

const OPENERS = [
  'What am I short of?',
  'How were my weekends?',
  'When did I last eat fish?',
  'Is my protein getting better?',
];

/** What is on screen, as opposed to what is on the wire. */
interface Bubble {
  role: 'user' | 'assistant';
  text: string;
  /** The lookups that went into this answer, shown above it. */
  lookups?: string[];
}

/**
 * Squish Nutritionist.
 *
 * The difference between this and a chat box is that it can go and look. It
 * is given tools for the diary — days, meals, vitamins and minerals — and it
 * uses them before answering, so "how were my weekends" is a question about
 * your weekends rather than about weekends in general. The lookups run here,
 * in the browser, against the store; they are shown as they happen, because a
 * thing that reads your food diary should say so while it does it.
 *
 * The conversation lives in this component and nowhere else — not in the
 * store, not on the server. Close the screen and it is gone. What does
 * survive is the handful of notes it writes about you, which are listed on
 * the You screen and can be deleted one by one.
 */
export default function Ask({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { profile, targets, meals, nutritionistNotes } = useSquish();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [wire, setWire] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [lookups, setLookups] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const today = isoDate();

  // The outline it gets for free, so an easy question needs no lookup at all.
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
  }, [bubbles, thinking, lookups]);

  /**
   * Answer a lookup out of the live store.
   *
   * `getState` rather than the values above on purpose: a conversation can
   * outlast several renders, and a snapshot taken when the screen opened would
   * answer today's question with this morning's diary.
   */
  const run = (call: ToolCall) => {
    const state = useSquish.getState();
    const diary: Diary = {
      meals: state.meals,
      days: state.days,
      profile: state.profile,
      targets: state.targets,
      notes: state.nutritionistNotes,
      today: isoDate(),
    };
    return runTool(call, diary, {
      remember: (note) => state.rememberNote(note),
      forget: (id) => state.forgetNote(id),
    });
  };

  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || thinking) return;

    const nextWire: ChatMessage[] = [...wire, { role: 'user', content: text }];
    setBubbles((current) => [...current, { role: 'user', text }]);
    setWire(nextWire);
    setDraft('');
    setThinking(true);
    setLookups([]);

    // Collected across rounds so the finished answer can show what it read.
    const used: string[] = [];

    try {
      const { reply, messages } = await askNutritionist({
        messages: nextWire,
        context,
        notes: () => useSquish.getState().nutritionistNotes,
        run,
        onLookup: (labels) => {
          used.push(...labels);
          setLookups(labels);
        },
      });
      setWire([...messages, { role: 'assistant', content: reply }]);
      setBubbles((current) => [...current, { role: 'assistant', text: reply, lookups: used.length ? used : undefined }]);
    } catch (error) {
      // The question goes back into the box rather than staying stranded in
      // the thread, so it can be sent again with one press. The failure is
      // said out loud rather than swallowed.
      setWire(wire);
      setBubbles((current) => current.filter((b, i) => !(i === current.length - 1 && b.role === 'user')));
      setDraft(text);
      toast(error instanceof SquishApiError ? error.message : 'I could not answer just then.', '💭');
    } finally {
      setThinking(false);
      setLookups([]);
    }
  };

  return (
    <div className="screen ask">
      <header className="screen-head">
        <div>
          <h1>Squish Nutritionist</h1>
          <p>Reads your diary before it answers</p>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </header>

      <div className="ask-thread">
        {bubbles.length === 0 && (
          <div className="ask-empty">
            <Squish mood="calm" size={104} />
            <p className="speech">
              Ask me anything about what you have been eating. I can look up any day, any meal and every vitamin
              Squish tracks — but I am an app, so for anything medical see a GP or a dietitian.
            </p>
            <div className="ask-openers">
              {OPENERS.map((opener) => (
                <button key={opener} type="button" className="chip" onClick={() => void ask(opener)}>
                  {opener}
                </button>
              ))}
            </div>
            {nutritionistNotes.length > 0 && (
              <div className="ask-memory">
                <h2>What I remember about you</h2>
                <ul>
                  {nutritionistNotes.map((note) => (
                    <li key={note.id}>
                      <span>{note.note}</span>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        aria-label={`Forget: ${note.note}`}
                        onClick={() => {
                          useSquish.getState().forgetNote(note.id);
                          toast('Forgotten.', '🧠');
                        }}
                      >
                        <TrashIcon size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {bubbles.map((bubble, index) => (
          <div key={`${bubble.role}-${index}`} className={`ask-turn ask-turn--${bubble.role}`}>
            {bubble.lookups && (
              <ul className="ask-lookups ask-lookups--done">
                {bubble.lookups.map((label, i) => (
                  <li key={`${label}-${i}`}>{label}</li>
                ))}
              </ul>
            )}
            {bubble.text.split('\n').filter(Boolean).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ))}

        {thinking && (
          <div className="ask-turn ask-turn--assistant ask-thinking" aria-live="polite">
            {lookups.length > 0 ? (
              <ul className="ask-lookups">
                {lookups.map((label, i) => (
                  <li key={`${label}-${i}`}>{label}…</li>
                ))}
              </ul>
            ) : (
              <>
                <span className="ask-dot" />
                <span className="ask-dot" />
                <span className="ask-dot" />
                <span className="visually-hidden">Squish is thinking</span>
              </>
            )}
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
