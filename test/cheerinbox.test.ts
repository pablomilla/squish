import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addToInbox, inboxFor } from '../src/lib/cheerInbox';

/** Today's cheers, kept on the phone so Home can bring the squad up to show them. */
const TODAY = '2026-09-27';
const c = (id: string, from = 'Alex', cheer = 'proud') => ({ id, from, cheer });

test('cheers are kept for today only', () => {
  assert.deepEqual(inboxFor(null, TODAY), []);
  assert.deepEqual(inboxFor({ date: '2026-09-26', cheers: [c('old')] }, TODAY), [], 'yesterday is old news');
  assert.deepEqual(inboxFor({ date: TODAY, cheers: [c('a')] }, TODAY), [c('a')]);
});

test('arrivals go on the front, each once, and yesterday is dropped', () => {
  let inbox = addToInbox({ date: '2026-09-26', cheers: [c('old')] }, [c('a'), c('b', 'Sam', 'hug')], TODAY);
  assert.deepEqual(inbox.cheers.map((x) => x.id), ['b', 'a']);
  inbox = addToInbox(inbox, [c('a'), c('d')], TODAY);
  assert.deepEqual(inbox.cheers.map((x) => x.id), ['d', 'b', 'a'], 'a cheer already kept is not kept twice');
});

test('a handful at most', () => {
  const many = Array.from({ length: 14 }, (_, i) => c(`x${i}`));
  assert.equal(addToInbox(null, many, TODAY).cheers.length, 10);
});
