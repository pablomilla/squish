import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_DIR, withShots } from '../server/site';
import { demoState } from '../src/lib/demoDiary';
import { SQUISH_PLAN_NOTE } from '../src/lib/planner';
import { idOf } from '../src/lib/i18n';

/**
 * The website shows the app in the visitor's language: each screenshot that
 * language has, and the English one where it has none yet.
 */
test('a language’s own screenshots where it has them, the English ones where not', () => {
  const html = '<img src="/img/shots/en/home.jpg" /><img src="/img/shots/en/cook.jpg" />';
  const dir = join(SITE_DIR, 'img', 'shots', 'qq');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'home.jpg'), '');
  try {
    assert.equal(withShots(html, 'qq'), '<img src="/img/shots/qq/home.jpg" /><img src="/img/shots/en/cook.jpg" />');
    assert.equal(withShots(html, 'en'), html, 'English is the source');
    assert.equal(withShots(html, 'zz'), html, 'a language with none yet keeps the English');
    assert.equal(withShots(html, '../x'), html, 'never a path out of the folder');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every screenshot the website shows exists in English', () => {
  const html = readFileSync(join(SITE_DIR, 'index.html'), 'utf8');
  const shots = [...html.matchAll(/\/img\/shots\/en\/([a-z-]+\.jpg)/g)].map((m) => m[1]);
  assert.ok(shots.length >= 7);
  for (const file of new Set(shots)) {
    assert.doesNotThrow(() => readFileSync(join(SITE_DIR, 'img', 'shots', 'en', file)), file);
  }
});

test('the demo diary is filled in the language being photographed', () => {
  const spanish: Record<string, string> = { [idOf('Lemon and herb salmon traybake')]: 'Bandeja de salmón al limón y hierbas' };
  const state = demoState('2026-10-03', (english) => spanish[idOf(english)] ?? english, { language: 'es' });
  const tonight = state.plans[0];
  assert.equal(tonight.title, 'Bandeja de salmón al limón y hierbas');
  assert.equal(tonight.note, SQUISH_PLAN_NOTE, 'planned by Squish, so it shows on the meal plan');
  assert.equal(tonight.cook?.steps.length, 4);
  assert.ok(tonight.items.length > 0, 'with its ingredients');
  assert.equal(state.profile.language, 'es');
  assert.ok(state.meals.some((m) => m.date === '2026-10-03') && state.meals.some((m) => m.date === '2026-09-20'), 'a fortnight up to today');
});
