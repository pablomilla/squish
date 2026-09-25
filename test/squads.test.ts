import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { blockMember, createSquad, joinSquad, leaveSquad, markCheersSeen, sendCheer, setStatus, squadFor, tidyStatus } from '../server/squads';
import { CHEERS, SQUAD_NAMES, tidyDisplayName } from '../src/lib/cheers';

/**
 * Squads: small, private, and with nothing typed between people but a first
 * name. What matters most is who sees whom — a block is total — and that
 * nothing but the fixed cheers and harmless status gets through.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

before(async () => {
  if (enabled) await migrate();
});
after(async () => {
  if (enabled) await closeDatabase();
});

async function anAccount() {
  const id = randomUUID();
  await query('insert into accounts (id, email, password_hash) values ($1, $2, $3)', [id, `squad-${id}@example.com`, 'x']);
  return id;
}

const status = (weekDays: number, weekKey = '2026-W39') => ({
  streak: 4,
  loggedDay: '2026-09-25',
  weekKey,
  weekDays,
  badges: ['first-meal', 'streak-3'],
  look: 'blueberry',
  outfit: { head: 'party-hat' },
});

async function aSquad(size: number) {
  const ids = [];
  for (let i = 0; i < size; i++) ids.push(await anAccount());
  const made = await createSquad(ids[0], SQUAD_NAMES[0], 'Alex');
  assert.ok(made.ok);
  for (let i = 1; i < size; i++) assert.ok((await joinSquad(ids[i], made.code, `Friend ${String.fromCharCode(65 + i)}`)).ok);
  return { ids, code: made.code };
}

const memberId = async (viewer: string, name: string) => (await squadFor(viewer))!.members.find((m) => m.name === name)!.id;

test('cheers are kind, unique, and never about bodies, weight or eating less', () => {
  assert.ok(CHEERS.length >= 16);
  assert.equal(new Set(CHEERS.map((c) => c.id)).size, CHEERS.length);
  for (const cheer of CHEERS) assert.doesNotMatch(cheer.words, /weigh|kg|lb|calor|thin|fat|diet|skinny|eat less|slim/i, cheer.words);
});

test('display names are names, not messages', () => {
  assert.equal(tidyDisplayName('  Mary-Jane  '), 'Mary-Jane');
  assert.equal(tidyDisplayName('Siân'), 'Siân');
  assert.equal(tidyDisplayName("O'Neill"), "O'Neill");
  assert.equal(tidyDisplayName('call me 07700 900000'), null);
  assert.equal(tidyDisplayName('https://example.com'), null);
  assert.equal(tidyDisplayName('A'.repeat(21)), null);
  assert.equal(tidyDisplayName(''), null);
});

test('a status keeps only harmless, well-formed fields', () => {
  const tidy = tidyStatus({ ...status(3), meals: [{ calories: 900 }], weight: 82, outfit: { head: 'crown', shoes: 'x', face: '<b>' } });
  assert.deepEqual(Object.keys(tidy!).sort(), ['badges', 'loggedDay', 'look', 'outfit', 'streak', 'weekDays', 'weekKey']);
  assert.deepEqual(tidy!.outfit, { head: 'crown' });
  assert.equal(tidyStatus({ ...status(3), weekDays: 9 })!.weekDays, 7);
  assert.equal(tidyStatus({ ...status(3), loggedDay: 'yesterday' }), null);
});

test('nothing in the squad code reads meals, diaries or weight', () => {
  // The code, not the comments explaining what it leaves out.
  const source = readFileSync('server/squads.ts', 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.doesNotMatch(source, /from diaries|state->|weight|calories/);
});

when('make a squad from the list, and friends join with its code — five at most', async () => {
  const owner = await anAccount();
  assert.deepEqual(await createSquad(owner, 'The Rudest Crew', 'Alex'), { ok: false, problem: 'bad_name' }, 'a typed squad name');
  const { ids, code } = await aSquad(5);
  const extra = await anAccount();
  assert.deepEqual(await joinSquad(extra, code.toLowerCase(), 'Late'), { ok: false, problem: 'full' });
  assert.deepEqual(await joinSquad(ids[1], code, 'Again'), { ok: false, problem: 'already_in' });
  assert.deepEqual(await joinSquad(extra, 'NOPE123', 'Late'), { ok: false, problem: 'not_found' });

  const view = await squadFor(ids[2]);
  assert.equal(view?.members.length, 5);
  assert.equal(view?.members.filter((m) => m.isMe).length, 1);
  assert.equal(await squadFor(extra), null);
});

when('a status is shared with the squad, and the weekly goal is counted once, when everybody hits it', async () => {
  const { ids } = await aSquad(3);
  assert.equal((await setStatus(ids[0], status(5))).ok, true);
  assert.deepEqual(await setStatus(ids[1], status(5)), { ok: true, wonNow: false }, 'one member short');
  assert.deepEqual(await setStatus(ids[2], status(5)), { ok: true, wonNow: true });
  assert.deepEqual(await setStatus(ids[2], status(6)), { ok: true, wonNow: false }, 'counted twice in one week');
  const view = await squadFor(ids[1]);
  assert.equal(view?.weeksWon, 1);
  const alex = view?.members.find((m) => m.name === 'Alex');
  assert.deepEqual([alex?.streak, alex?.look, alex?.outfit], [4, 'blueberry', { head: 'party-hat' }]);

  // A new week needs everybody again.
  assert.deepEqual(await setStatus(ids[0], status(5, '2026-W40')), { ok: true, wonNow: false });
});

when('cheers: from the list, not to yourself, once per cheer per person per day', async () => {
  const { ids } = await aSquad(2);
  const toB = await memberId(ids[0], 'Friend B');
  assert.deepEqual(await sendCheer(ids[0], toB, 'type anything'), { ok: false, problem: 'bad_cheer' });
  assert.deepEqual(await sendCheer(ids[0], await memberId(ids[0], 'Alex'), 'proud'), { ok: false, problem: 'not_found' });
  assert.deepEqual(await sendCheer(ids[0], toB, 'proud'), { ok: true });
  assert.deepEqual(await sendCheer(ids[0], toB, 'proud'), { ok: false, problem: 'sent_already' });
  assert.deepEqual(await sendCheer(ids[0], toB, 'hug'), { ok: true });

  const b = await squadFor(ids[1]);
  assert.deepEqual(b?.cheers.map((c) => [c.from, c.cheer]), [['Alex', 'proud'], ['Alex', 'hug']]);
  await markCheersSeen(ids[1], b!.cheers.map((c) => c.id));
  assert.equal((await squadFor(ids[1]))?.cheers.length, 0, 'announced once');
  assert.equal((await squadFor(ids[0]))?.sentToday.length, 2);
});

when('a cheer cannot be sent to somebody in another squad', async () => {
  const one = await aSquad(2);
  const two = await aSquad(2);
  const stranger = await memberId(two.ids[0], 'Friend B');
  assert.deepEqual(await sendCheer(one.ids[0], stranger, 'proud'), { ok: false, problem: 'not_found' });
});

when('a block is total: neither sees the other, cheers stop, and they cannot rejoin together', async () => {
  const { ids, code } = await aSquad(3);
  const bId = await memberId(ids[0], 'Friend B');
  await sendCheer(ids[1], await memberId(ids[1], 'Alex'), 'hug');
  assert.deepEqual(await blockMember(ids[0], bId), { ok: true });

  assert.ok(!(await squadFor(ids[0]))!.members.some((m) => m.name === 'Friend B'), 'the blocker still sees them');
  assert.ok(!(await squadFor(ids[1]))!.members.some((m) => m.name === 'Alex'), 'the blocked still sees the blocker');
  assert.equal((await squadFor(ids[0]))!.cheers.length, 0, "a blocked person's cheer still arrives");
  assert.deepEqual(await sendCheer(ids[1], (await squadFor(ids[0]))!.members.find((m) => m.isMe)!.id, 'proud'), { ok: false, problem: 'not_found' });
  assert.ok((await squadFor(ids[2]))!.members.some((m) => m.name === 'Friend B'), 'others are unaffected');

  await leaveSquad(ids[1]);
  assert.deepEqual(await joinSquad(ids[1], code, 'Friend B'), { ok: false, problem: 'not_found' }, 'rejoined past a block');
});

when('the last one out takes the squad with them', async () => {
  const { ids, code } = await aSquad(2);
  await leaveSquad(ids[0]);
  await leaveSquad(ids[1]);
  assert.equal((await query('select 1 from squads where code = $1', [code])).length, 0);
});
