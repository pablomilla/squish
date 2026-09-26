import { useEffect, useMemo, useRef, useState } from 'react';
import Squish from '../components/Squish';
import DictateButton from '../components/DictateButton';
import { CloseIcon, SparkIcon, TrashIcon } from '../components/icons';
import { useSquish } from '../store/useSquish';
import { askNutritionist, isPaywalled, SquishApiError, type ChatMessage } from '../lib/api';
import { runTool, type Diary, type ToolCall } from '../lib/nutritionist-tools';
import { contextFor } from '../lib/nutritionist-session';
import { isoDate } from '../lib/date';
import { PLUS } from '../lib/plan';
import { showPaywall } from '../lib/paywall';
import { suggestedQuestions } from '../lib/askSuggestions';
import { useNutritionistAccess } from '../components/useSubscribed';
import NutritionistPitch from '../components/NutritionistPitch';
import MealPlanPanel from '../components/MealPlanPanel';
import { Segmented, useToast } from '../components/ui';
import './ask.css';

/**
 * A stand-in for what the server would have said, so the explainer can open
 * without spending a question to be refused one.
 */
const WALL = { plan: 'free', kind: 'chat', used: 0, allowance: 0, resets: '', message: '' } as const;

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
export default function Ask({ onClose, question, tab: startTab }: { onClose: () => void; question?: string; tab?: 'ask' | 'plan' }) {
  const toast = useToast();
  const { profile, targets, meals, nutritionistNotes } = useSquish();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [wire, setWire] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [thinking, setThinking] = useState(false);
  const [lookups, setLookups] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  // Locked where there is nothing to ask with: signed out, or a free taste
  // used up. Somebody on Plus who has used the month gets the composer and
  // the real refusal, which says when it comes back.
  const access = useNutritionistAccess();
  const locked = access.locked;
  // Two things the nutritionist does: answer, and plan the week.
  const [tab, setTab] = useState<'ask' | 'plan'>(startTab ?? 'ask');

  const today = isoDate();
  const openers = useMemo(() => suggestedQuestions(meals, targets, today, new Date().getHours(), 4), [meals, targets, today]);
  const unlock = () =>
    showPaywall({
      ...WALL,
      allowance: access.standing.allowance.chat,
      needsAccount: access.needsAccount,
      taste: access.needsAccount ? 3 : undefined,
    });

  // The outline it gets for free, so an easy question needs no lookup at all.
  // Built where the loop is, not here, so an eval sees the same summary.
  const context = useMemo(() => contextFor(meals, targets, profile, today), [meals, targets, profile, today]);

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
      useSquish.getState().unlock('first-question');
      setWire([...messages, { role: 'assistant', content: reply }]);
      setBubbles((current) => [...current, { role: 'assistant', text: reply, lookups: used.length ? used : undefined }]);
    } catch (error) {
      // The question goes back into the box rather than staying stranded in
      // the thread, so it can be sent again with one press. The failure is
      // said out loud rather than swallowed.
      setWire(wire);
      setBubbles((current) => current.filter((b, i) => !(i === current.length - 1 && b.role === 'user')));
      setDraft(text);
      if (!isPaywalled(error)) toast(error instanceof SquishApiError ? error.message : 'I could not answer just then.', '💭');
    } finally {
      setThinking(false);
      setLookups([]);
    }
  };

  // A question tapped elsewhere — on Home, in the diary — is asked on arrival.
  const askedOnArrival = useRef(false);
  useEffect(() => {
    if (!question || locked || askedOnArrival.current) return;
    askedOnArrival.current = true;
    void ask(question);
    // Once, on arrival: `ask` is re-made every render and must not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, locked]);

  return (
    <div className="screen ask">
      <header className="screen-head">
        <div>
          <h1>Your nutritionist</h1>
          <p>
            Reads your diary before it answers{access.label ? ` · ${access.label}` : ''}
          </p>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </header>

      <Segmented<'ask' | 'plan'>
        label="Ask or meal plan"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ask', label: 'Ask' },
          { value: 'plan', label: 'Meal plan' },
        ]}
      />

      {tab === 'plan' && <MealPlanPanel />}

      {/*
        Said before a question is typed, not after it is sent.
        Letting somebody compose a question about their own diary and only
        then telling them it costs money is a small cruelty, and it makes the
        paywall feel like a trick rather than a price.
      */}
      {tab === 'ask' && locked && (
        <div className="ask-locked">
          <Squish mood="thinking" size={88} />
          {question ? (
            <h2>“{question}” — I can answer that from your diary.</h2>
          ) : (
            <h2>{access.needsAccount ? 'Ask me three questions, free' : 'Your own nutritionist'}</h2>
          )}
          <p className="small muted">
            {access.needsAccount
              ? 'Make a free account and your first three questions are on us.'
              : `You have used your free questions. With ${PLUS} it is 30 a month, and a meal plan for your week.`}
          </p>
          <NutritionistPitch />
          <button type="button" className="btn btn--block" onClick={unlock}>
            {access.needsAccount ? 'Try it free' : `See ${PLUS}`}
          </button>
          <p className="tiny muted">Your diary, charts, streaks and food search do not need it.</p>
        </div>
      )}

      {tab === 'ask' && !locked && <div className="ask-thread">
        {bubbles.length === 0 && (
          <div className="ask-empty">
            <Squish mood="calm" size={104} />
            <p className="speech">
              Ask me anything about what you have been eating. I can look up any day, any meal and every vitamin
              Squish tracks — but I am an app, so for anything medical see a GP or a dietitian.
            </p>
            <div className="ask-openers">
              {openers.map((opener) => (
                <button key={opener} type="button" className="chip" onClick={() => void ask(opener)}>
                  {opener}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--soft btn--block ask-week" onClick={() => setTab('plan')}>
              <SparkIcon size={16} /> Plan my week{access.standing.plan === 'plus' || access.standing.off ? '' : ` · ${PLUS}`}
            </button>
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
      </div>}

      {tab === 'ask' && !locked && <div className="ask-composer">
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
      </div>}
    </div>
  );
}
