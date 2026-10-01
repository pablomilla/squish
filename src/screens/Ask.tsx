import { useEffect, useMemo, useRef, useState } from 'react';
import Squish from '../components/Squish';
import VoiceField from '../components/VoiceField';
import { CloseIcon, SparkIcon, TrashIcon } from '../components/icons';
import { useSquish } from '../store/useSquish';
import { askNutritionist, isPaywalled, SquishApiError, type ChatMessage } from '../lib/api';
import { runTool, type Diary, type ToolCall } from '../lib/nutritionist-tools';
import { contextFor } from '../lib/nutritionist-session';
import { friendlyDate, isoDate } from '../lib/date';
import { watchBackup } from '../lib/autobackup';
import { deleteChat, listChats, newChatId, saveChat, titleOf, wireOf, type ChatTurn, type PastChat, onChatsChanged } from '../lib/chats';
import { PLUS } from '../lib/plan';
import { showPaywall } from '../lib/paywall';
import { suggestedQuestions } from '../lib/askSuggestions';
import { useNutritionistAccess } from '../components/useSubscribed';
import NutritionistPitch from '../components/NutritionistPitch';
import MealPlanPanel from '../components/MealPlanPanel';
import { Segmented, Sheet, useToast } from '../components/ui';
import './ask.css';
import { plural, t } from '../lib/i18n';

/**
 * A stand-in for what the server would have said, so the explainer can open
 * without spending a question to be refused one.
 */
const WALL = { plan: 'free', kind: 'chat', used: 0, allowance: 0, resets: '', message: '' } as const;

/** What is on screen, as opposed to what is on the wire — and what a past chat keeps. */
type Bubble = ChatTurn;



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
 * Each conversation is kept on this phone as it goes (src/lib/chats.ts) —
 * never on the server — so it can be read again, carried on, or looked back
 * on by the nutritionist itself. Beside that, the handful of notes it writes
 * about you, listed on the You screen and deletable one by one.
 */
export default function Ask({ onClose, question, draft: startDraft, tab: startTab }: { onClose: () => void; question?: string; draft?: string; tab?: 'ask' | 'plan' }) {
  const toast = useToast();
  const { profile, targets, meals, nutritionistNotes } = useSquish();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [wire, setWire] = useState<ChatMessage[]>([]);
  // A suggestion tapped on Home arrives typed in, not sent: it costs nothing until they send it.
  const [draft, setDraft] = useState(startDraft ?? '');
  const [thinking, setThinking] = useState(false);
  const [lookups, setLookups] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  // This conversation, as it will be kept, and the ones before it.
  const [chatId, setChatId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [past, setPast] = useState<PastChat[]>([]);
  const [listing, setListing] = useState(false);
  /** When the chat on screen was last carried on, if it was opened from the past chats. */
  const [reopened, setReopened] = useState<number | null>(null);
  const pastRef = useRef<PastChat[]>([]);
  const refreshPast = () =>
    void listChats().then((chats) => {
      pastRef.current = chats;
      setPast(chats);
    });
  useEffect(refreshPast, []);
  // Chats deleted on another device go from the list while it is open.
  useEffect(() => onChatsChanged(refreshPast), []);
  // Whether there is a backup for chats to go in: only where the server keeps diaries.
  const [backupOn, setBackupOn] = useState(false);
  useEffect(() => watchBackup((state) => setBackupOn(state.kind !== 'off')), []);
  const backupChats = useSquish((s) => s.backupChats);

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
      // Not the one under way: it is on the wire already.
      chats: pastRef.current.filter((chat) => chat.id !== chatId),
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
    const asked: Bubble[] = [...bubbles, { role: 'user', text }];
    const id = chatId ?? newChatId();
    const started = chatId ? startedAt : Date.now();
    setChatId(id);
    setStartedAt(started);
    setBubbles(asked);
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
      const answered: Bubble[] = [...asked, { role: 'assistant', text: reply, ...(used.length ? { lookups: used } : {}) }];
      setBubbles(answered);
      // Kept as it goes, so a chat closed mid-way is still there to come back to.
      void saveChat({ id, title: titleOf(answered), startedAt: started, updatedAt: Date.now(), turns: answered }).then(refreshPast);
    } catch (error) {
      // The question goes back into the box rather than staying stranded in
      // the thread, so it can be sent again with one press. The failure is
      // said out loud rather than swallowed.
      setWire(wire);
      setBubbles(bubbles);
      // A first question that failed leaves no chat behind.
      if (!bubbles.length) setChatId(null);
      setDraft(text);
      if (!isPaywalled(error)) toast(error instanceof SquishApiError ? error.message : t('I could not answer just then.'), '💭');
    } finally {
      setThinking(false);
      setLookups([]);
    }
  };

  /** Back to a chat from before: to read, and to carry on where it stopped. */
  const reopen = (chat: PastChat) => {
    setChatId(chat.id);
    setStartedAt(chat.startedAt);
    setBubbles(chat.turns);
    setWire(wireOf(chat.turns));
    setDraft('');
    setReopened(chat.updatedAt);
  };

  const newChat = () => {
    setChatId(null);
    setBubbles([]);
    setWire([]);
    setDraft('');
    setReopened(null);
  };

  const forgetChat = (chat: PastChat) => {
    void deleteChat(chat.id).then(refreshPast);
    toast(t('Chat deleted.'), '🗑️');
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
          <h1>{t('Your nutritionist')}</h1>
          <p>
            {t('Reads your diary before it answers')}
            {access.label ? ` · ${access.label}` : ''}
          </p>
        </div>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label={t('Close')}>
          <CloseIcon size={18} />
        </button>
      </header>

      <Segmented<'ask' | 'plan'>
        label={t('Ask or meal plan')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'ask', label: t('Ask') },
          { value: 'plan', label: t('Meal plan') },
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
            <h2>{t('“{question}” — I can answer that from your diary.', { question })}</h2>
          ) : (
            <h2>{access.needsAccount ? t('Ask me three questions, free') : t('Your own nutritionist')}</h2>
          )}
          <p className="small muted">
            {access.needsAccount
              ? t('Make a free account and your first three questions are on us.')
              : t('You have used your free questions. With {plus} it is {n} a month, and a meal plan for your week.', { plus: PLUS, n: 30 })}
          </p>
          <NutritionistPitch />
          <button type="button" className="btn btn--block" onClick={unlock}>
            {access.needsAccount ? t('Try it free') : t('See {plus}', { plus: PLUS })}
          </button>
          <p className="tiny muted">{t('Your diary, charts, streaks and food search do not need it.')}</p>
        </div>
      )}

      {tab === 'ask' && !locked && <div className="ask-thread">
        {(bubbles.length > 0 || past.length > 0) && (
          <div className="ask-thread-bar">
            {past.length > 0 ? (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setListing(true)} disabled={thinking}>
                {t('Past chats ({n})', { n: past.length })}
              </button>
            ) : (
              <span />
            )}
            {bubbles.length > 0 && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={newChat} disabled={thinking}>
                {t('New chat')}
              </button>
            )}
          </div>
        )}
        {reopened !== null && bubbles.length > 0 && (
          <p className="tiny muted ask-reopened">
            {t('From {date}. Carry on below, and I will look things up afresh.', { date: friendlyDate(isoDate(new Date(reopened))).toLocaleLowerCase() })}
          </p>
        )}

        {bubbles.length === 0 && (
          <div className="ask-empty">
            <Squish mood="calm" size={104} />
            <p className="speech">
              {t('Ask me anything about what you have been eating. I can look up any day, any meal and every vitamin Squish tracks — but I am an app, so for anything medical see a doctor or a dietitian.')}
            </p>
            <div className="ask-openers">
              {openers.map((opener) => (
                <button key={opener} type="button" className="chip" onClick={() => void ask(opener)}>
                  {opener}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn--soft btn--block ask-week" onClick={() => setTab('plan')}>
              <SparkIcon size={16} /> {t('Plan my week')}
              {access.standing.plan === 'plus' || access.standing.off ? '' : ` · ${PLUS}`}
            </button>
            {nutritionistNotes.length > 0 && (
              <div className="ask-memory">
                <h2>{t('What I remember about you')}</h2>
                <ul>
                  {nutritionistNotes.map((note) => (
                    <li key={note.id}>
                      <span>{note.note}</span>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        aria-label={t('Forget: {note}', { note: note.note })}
                        onClick={() => {
                          useSquish.getState().forgetNote(note.id);
                          toast(t('Forgotten.'), '🧠');
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
              // Their language may run right to left; the browser works it out per line.
              <p key={i} dir="auto">
                {line}
              </p>
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
                <span className="visually-hidden">{t('Squish is thinking')}</span>
              </>
            )}
          </div>
        )}

        <div ref={endRef} />
      </div>}

      {tab === 'ask' && !locked && <div className="ask-composer">
        <div className="fix-row">
          <VoiceField
            value={draft}
            label={t('your question')}
            onText={(text) => setDraft((current) => (current ? `${current.trim()} ${text}` : text))}
            onError={(message) => toast(message, '🎤')}
          >
            <input
              className="input"
              value={draft}
              disabled={thinking}
              enterKeyHint="send"
              placeholder={t('Ask about your diary…')}
              aria-label={t('Your question')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void ask(draft);
                }
              }}
            />
          </VoiceField>
          <button type="button" className="btn btn--soft" disabled={!draft.trim() || thinking} onClick={() => void ask(draft)} aria-label={t('Ask')}>
            <SparkIcon size={17} />
          </button>
        </div>
      </div>}

      <Sheet open={listing} onClose={() => setListing(false)} title={t('Past chats')}>
        <div className="ask-past">
          <ul>
            {past.map((chat) => (
              <li key={chat.id}>
                <button
                  type="button"
                  className="ask-past-open"
                  onClick={() => {
                    reopen(chat);
                    setListing(false);
                  }}
                >
                  <span className="ask-past-title" dir="auto">{chat.title}</span>
                  <span className="tiny muted">
                    {friendlyDate(isoDate(new Date(chat.updatedAt)))} · {plural(chat.turns.filter((turn) => turn.role === 'user').length, { one: '{n} question', other: '{n} questions' })}
                  </span>
                </button>
                <button type="button" className="btn btn--sm btn--ghost" aria-label={t('Delete the chat: {title}', { title: chat.title })} onClick={() => forgetChat(chat)}>
                  <TrashIcon size={15} />
                </button>
              </li>
            ))}
          </ul>
          {past.length === 0 && <p className="small muted">{t('No past chats.')}</p>}
          {backupOn && (
            <div className="ask-past-backup">
              <h4 className="small">{t('Take them to a new phone')}</h4>
              <Segmented
                label={t('Back up past chats')}
                value={backupChats ? 'on' : 'off'}
                onChange={(value) => useSquish.getState().setBackupChats(value === 'on')}
                options={[
                  { value: 'on' as const, label: t('Backed up') },
                  { value: 'off' as const, label: t('This phone only') },
                ]}
              />
              <p className="tiny muted">
                {backupChats
                  ? t('Your past chats go in your diary backup, so they come back when you restore it or sign in on a new phone. Turn this off and they leave the backup at its next save.')
                  : t('Your past chats stay on this phone and nowhere else. Back them up to have them on a new phone, with your diary.')}
              </p>
            </div>
          )}
          <p className="tiny muted">{t('Kept for 90 days. They go with Reset, and are in your data export.')}</p>
        </div>
      </Sheet>
    </div>
  );
}
