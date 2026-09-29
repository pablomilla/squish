/**
 * Quick snaps: a meal photographed in a hurry, logged without anybody waiting.
 *
 * Tap the widget, take the picture, put the phone away — at a table, in a
 * meeting, anywhere half a minute with a phone held up is rude. So a snap is
 * never read while they watch. It is kept here the moment it is taken (the
 * photo in IndexedDB, a note of it in the store), handed to the server as
 * soon as there is signal, and read there whether or not the app is still
 * open (server/snaps.ts). Whenever the app is next open it collects the
 * reading and logs the meal, marked as one to check: nobody has looked at it,
 * so the diary says so until they do.
 *
 * Where the server keeps nothing (no database), the app reads the photo
 * itself instead, while it is open.
 *
 * Nothing here shows a paywall or an error: whatever happened is kept with
 * the snap and shown on Home, for when they have a moment.
 */
import type { AnalysisResult, MealEntry, QueuedSnap } from '../types';
import { useSquish } from '../store/useSquish';
import { DISPLAY, THUMB, fetchSnaps, readSnapHere, reshrink, sendSnap, snapsCollected, type SnapBack } from './api';
import { dropPhoto, loadPhoto, savePhoto } from './photos';
import { isoDate, nowTime, slotForNow } from './date';
import { t } from './i18n';

/** Where a snap's photos wait: the one sent to be read, and the one kept with the meal. */
export const sendKey = (id: string) => `snap:${id}`;
export const showKey = (id: string) => `snapshow:${id}`;
/** Every photo a queued snap still needs, for the photo store to keep. */
export const snapPhotoKeys = (snaps: QueuedSnap[]): string[] => snaps.flatMap((snap) => [sendKey(snap.id), showKey(snap.id)]);

/** Handed over and not heard of since: the server lost it (a week, or a wipe), so it goes again. */
const LOST_MS = 10 * 60_000;

const newId = (): string => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `s${Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('')}`;
};

const clock = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Keep a photo just taken as a snap, and start it on its way. Answers as soon
 * as it is kept: nothing waits for the network.
 */
export async function takeSnap(dataUrl: string, now: Date = new Date()): Promise<QueuedSnap> {
  const id = newId();
  const [show, thumb] = await Promise.all([reshrink(dataUrl, DISPLAY.maxSide, DISPLAY.quality), reshrink(dataUrl, THUMB.maxSide, THUMB.quality)]);
  await Promise.all([savePhoto(sendKey(id), dataUrl), savePhoto(showKey(id), show)]);
  const snap: QueuedSnap = { id, date: isoDate(now), time: nowTime(), takenAt: now.getTime(), slot: slotForNow(now), thumb, state: 'waiting' };
  useSquish.getState().addSnap(snap);
  void pumpSnaps();
  return snap;
}

/* ------------------------------------------------------------------ *
 * Moving them along: send what is waiting, collect what has been read.
 * ------------------------------------------------------------------ */

type Logged = Pick<MealEntry, 'id' | 'title' | 'nutrients'>;
const listeners = new Set<(logged: Logged[]) => void>();
/** Meals logged from snaps, as they are: for a word on screen, or a notification when there is no screen. */
export function onSnapsLogged(listener: (logged: Logged[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let pumping: Promise<void> | null = null;
/** One at a time: two passes at once could log the same meal twice. */
export function pumpSnaps(): Promise<void> {
  pumping ??= pump().finally(() => {
    pumping = null;
  });
  return pumping;
}

async function pump(): Promise<void> {
  const logged: Logged[] = [];
  for (const snap of useSquish.getState().snaps.filter((s) => s.state === 'waiting')) {
    const result = await send(snap);
    if (result) logged.push(result);
  }
  if (useSquish.getState().snaps.some((s) => s.state === 'sent')) logged.push(...(await collect()));
  if (logged.length) for (const listener of listeners) listener(logged);
}

/** Hand one snap over; logged at once only where the app reads it itself. */
async function send(snap: QueuedSnap): Promise<Logged | null> {
  const image = await loadPhoto(sendKey(snap.id));
  const { updateSnap } = useSquish.getState();
  if (!image) {
    // The photo is gone (storage cleared): there is nothing left to read.
    updateSnap(snap.id, { state: 'failed', error: t('The photo was lost before it could be read.') });
    return null;
  }
  const { plateCm, bowlMl } = useSquish.getState().profile;
  const crockery = { plateCm, bowlMl };
  const sent = await sendSnap({ id: snap.id, image, date: snap.date, time: clock(snap.takenAt), slot: snap.slot, crockery });
  if (sent === 'sent') updateSnap(snap.id, { state: 'sent', sentAt: Date.now(), error: undefined });
  else if (sent === 'refused') updateSnap(snap.id, { state: 'refused' });
  else if (sent === 'failed') updateSnap(snap.id, { state: 'failed', error: t('Squish could not read this photo.') });
  else if (sent === 'direct') {
    const analysis = await readSnapHere(image, snap.slot, crockery);
    if (analysis === 'refused') updateSnap(snap.id, { state: 'refused' });
    else if (analysis) return logSnap(snap, analysis);
    // Not read now: it stays waiting, for the next time.
  }
  return null;
}

/** Log what the server has read, note what it could not, and tell it which it can forget. */
async function collect(): Promise<Logged[]> {
  const back = await fetchSnaps();
  if (!back) return [];
  const byId = new Map<string, SnapBack>(back.map((snap) => [snap.id, snap]));
  const logged: Logged[] = [];
  const done: string[] = [];
  for (const snap of useSquish.getState().snaps) {
    const theirs = byId.get(snap.id);
    if (snap.state !== 'sent') continue;
    if (!theirs) {
      if (Date.now() - (snap.sentAt ?? 0) > LOST_MS) useSquish.getState().updateSnap(snap.id, { state: 'waiting' });
      continue;
    }
    if (theirs.status === 'done' && theirs.analysis) {
      const meal = await logSnap(snap, theirs.analysis);
      if (meal) logged.push(meal);
      done.push(snap.id);
    } else if (theirs.status === 'failed') {
      useSquish.getState().updateSnap(snap.id, { state: 'failed', error: theirs.error ?? t('Squish could not read this photo.') });
      done.push(snap.id);
    }
  }
  // Anything of this phone's the server still has but the app does not know (a reinstall): let it go.
  for (const snap of back) if (snap.status !== 'working' && !done.includes(snap.id) && !useSquish.getState().snaps.some((s) => s.id === snap.id)) done.push(snap.id);
  await snapsCollected(done);
  return logged;
}

/**
 * The reading, logged as a meal at the time it was taken and marked to check.
 * The meal takes the snap's id, so a snap can only ever become one meal.
 */
async function logSnap(snap: QueuedSnap, analysis: AnalysisResult): Promise<Logged | null> {
  const state = useSquish.getState();
  if (!state.snaps.some((s) => s.id === snap.id) || state.meals.some((m) => m.id === snap.id)) return null;
  const today = isoDate();
  const meal = state.addMeal({
    id: snap.id,
    // A snap taken just before midnight and read after is still yesterday's; one from a wrong clock is not tomorrow's.
    date: snap.date > today ? today : snap.date,
    time: snap.time,
    slot: snap.slot,
    title: analysis.title?.trim() || t('Meal'),
    items: analysis.items,
    nutrients: analysis.nutrients,
    score: analysis.score,
    coachNote: analysis.coachNote,
    photo: snap.thumb,
    source: 'photo',
    aiConfidence: analysis.confidence,
    quick: true,
  });
  state.removeSnap(snap.id);
  state.countPhotoAnalysis();
  const show = await loadPhoto(showKey(snap.id));
  if (show) await savePhoto(meal.id, show);
  await Promise.all([dropPhoto(sendKey(snap.id)), dropPhoto(showKey(snap.id))]);
  return { id: meal.id, title: meal.title, nutrients: meal.nutrients };
}

/** Try again: one that failed or was refused goes back in the queue. */
export function retrySnap(id: string): void {
  useSquish.getState().updateSnap(id, { state: 'waiting', error: undefined });
  void pumpSnaps();
}

/** Let one go, photo and all. */
export async function dropSnap(id: string): Promise<void> {
  useSquish.getState().removeSnap(id);
  await Promise.all([dropPhoto(sendKey(id)), dropPhoto(showKey(id))]);
  void snapsCollected([id]);
}

/**
 * Keep snaps moving while the app is open: straight away, on coming back to
 * it, when the signal returns, and every few seconds while any is being read.
 */
export function watchSnaps(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let live = true;
  const next = () => {
    clearTimeout(timer);
    const sent = useSquish.getState().snaps.filter((s) => s.state === 'sent' || s.state === 'waiting');
    if (!live || !sent.length || document.visibilityState !== 'visible') return;
    // Quickly at first — a photo takes seconds to read — then gently.
    const newest = Math.max(...sent.map((s) => s.sentAt ?? s.takenAt));
    timer = setTimeout(run, Date.now() - newest < 2 * 60_000 ? 4_000 : 30_000);
  };
  const run = () => void pumpSnaps().finally(next);
  const onVisible = () => document.visibilityState === 'visible' && run();
  run();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', run);
  // A snap just taken starts the round again.
  const unsubscribe = useSquish.subscribe((state, before) => {
    if (state.snaps.length > before.snaps.length) next();
  });
  return () => {
    live = false;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', run);
    unsubscribe();
  };
}
