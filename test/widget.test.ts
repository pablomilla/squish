import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MealEntry, QueuedSnap, Targets } from '../src/types';
import { widgetSummary } from '../src/lib/widgetData';

/**
 * What the home-screen widget is handed: today at a glance, in the person's
 * units, with the words ready to draw. The widget itself only fills in the
 * numbers, so a summary from yesterday can still say the right thing today.
 */
const targets = { calories: 1850, protein: 110 } as Targets;
const nutrients = (calories: number, protein: number) => ({ calories, protein, carbs: 0, fat: 0, fibre: 0, sugar: 0, sodium: 0 });
const meal = (id: string, date: string, calories: number, protein: number, quick = false): MealEntry =>
  ({ id, date, time: '12:00', slot: 'lunch', title: id, items: [], nutrients: nutrients(calories, protein), score: 60, source: 'photo', ...(quick ? { quick: true } : {}) }) as MealEntry;
const snap = (state: QueuedSnap['state']): QueuedSnap => ({ id: state, date: '2026-10-03', time: '13:00', takenAt: 0, slot: 'lunch', thumb: '', state }) as QueuedSnap;

test('today, in the person’s unit, with words the widget can fill', () => {
  const meals = [meal('porridge', '2026-10-03', 400, 14), meal('lunch', '2026-10-03', 610.4, 30.6, true), meal('yesterday', '2026-10-02', 2000, 90)];
  const summary = widgetSummary({ meals, targets, snaps: [snap('sent'), snap('failed')], unit: 'kcal', hidden: false, today: '2026-10-03' });
  assert.equal(summary.v, 1);
  assert.equal(summary.date, '2026-10-03');
  assert.deepEqual(summary.energy, { eaten: 1010, target: 1850, unit: 'kcal' });
  assert.deepEqual(summary.protein, { eaten: 45, target: 110 });
  assert.equal(summary.streak, 2);
  assert.equal(summary.toCheck, 1, 'the quick-snapped lunch');
  assert.equal(summary.reading, 1, 'one still being read; a failed one is not');
  // The widget writes the numbers in, so these keep their places.
  assert.equal(summary.words.left, '{n} kcal left');
  assert.equal(summary.words.over, '{n} kcal over');
  assert.equal(summary.words.ofTarget, '{eaten} of {target} kcal');
  assert.equal(summary.words.protein, '{eaten} of {target} g protein');
  // Counts the app knows now are written in already.
  assert.equal(summary.words.streak, '2-day streak');
  assert.equal(summary.words.toCheck, '1 snap to check');
  assert.equal(summary.words.reading, 'Reading 1 snap…');
});

test('kilojoules where that is the unit', () => {
  const summary = widgetSummary({ meals: [meal('toast', '2026-10-03', 100, 4)], targets, snaps: [], unit: 'kJ', hidden: false, today: '2026-10-03' });
  assert.deepEqual(summary.energy, { eaten: 418, target: 7740, unit: 'kJ' });
  assert.equal(summary.words.left, '{n} kJ left');
});

test('numbers turned off: the widget is told, and shows only the button', () => {
  const summary = widgetSummary({ meals: [], targets, snaps: [], unit: 'kcal', hidden: true, today: '2026-10-03' });
  assert.equal(summary.hidden, true);
  assert.equal(summary.words.quickSnap, 'Quick snap');
});

test('the native widgets read the same shape the app writes', async () => {
  const { readFile } = await import('node:fs/promises');
  const swift = await readFile('ios/App/SquishWidgets/SquishWidgets.swift', 'utf8');
  const java = await readFile('android/app/src/main/java/app/squish/tracker/SnapWidgetProvider.java', 'utf8');
  const summary = widgetSummary({ meals: [], targets, snaps: [], unit: 'kcal', hidden: false, today: '2026-10-03' });
  for (const key of Object.keys(summary.words)) {
    assert.match(swift, new RegExp(`let ${key}: String`), `Swift reads words.${key}`);
  }
  for (const key of ['quickSnap', 'left', 'over', 'ofTarget', 'protein', 'streak', 'toCheck', 'reading']) {
    assert.match(java, new RegExp(`"${key}"`), `Android reads words.${key}`);
  }
  // Both keep it under the same name the bridges write.
  assert.match(swift, /summaryKey = "widgetSummary"/);
  assert.match(await readFile('ios/App/App/SceneDelegate.swift', 'utf8'), /forKey: "widgetSummary"/);
  assert.match(await readFile('src/lib/widgets.ts', 'utf8'), /registerPlugin<.*>\('WidgetBridge'\)/);
  assert.match(await readFile('android/app/src/main/java/app/squish/tracker/WidgetBridgePlugin.java', 'utf8'), /@CapacitorPlugin\(name = "WidgetBridge"\)/);
});
