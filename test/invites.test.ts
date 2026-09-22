import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice } from '../server/identity';
import { signUp } from '../server/accounts';
import { planFor } from '../server/plan';
import {
  createInvite,
  deleteInvite,
  invitesExist,
  listInvites,
  redeem,
  redemptions,
  setInviteDisabled,
  suggestCode,
  tidy,
} from '../server/invites';

/**
 * Invite codes, against a real Postgres.
 *
 * A code is worth a year of a paid tier to whoever holds one, so the rules
 * about what counts as one, how many times it works, and what happens when
 * two people tap at the same moment are the parts worth testing.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

let n = 0;
const anEmail = () => `invite${++n}-${Date.now()}@example.com`;
const aCode = () => `TEST-${Date.now()}-${++n}`;

before(async () => {
  if (!enabled) return;
  await migrate();
});

after(async () => {
  if (enabled) await closeDatabase();
});

async function anAccount() {
  const device = await registerDevice();
  const made = await signUp(device.id, anEmail(), 'four random words');
  const id = made.ok ? made.account.id : '';
  return { id, device: { id: device.id, accountId: id } };
}

/* ---------------- what counts as a code ---------------- */

test('codes are compared the way a person types them', () => {
  assert.equal(tidy('  squish-tester-7f3k '), 'SQUISH-TESTER-7F3K');
  assert.equal(tidy('early bird'), 'EARLYBIRD');
});

test('a suggested code avoids the characters people misread', () => {
  // These get read down a phone and written on the back of things.
  for (let i = 0; i < 40; i++) {
    const body = suggestCode().split('-').slice(1).join('');
    assert.ok(!/[O0I1]/.test(body), `${body} contains a character that will be misread`);
    assert.equal(body.length, 8);
  }
  assert.equal(new Set(Array.from({ length: 50 }, () => suggestCode())).size, 50, 'codes must not repeat');
});

when('a code too short to be safe is refused', async () => {
  assert.equal((await createInvite('boss', { code: 'SHORT', days: 30, uses: null, note: null })).ok, false);
  assert.equal((await createInvite('boss', { code: 'HAS SPACES!', days: 30, uses: null, note: null })).ok, false);
  assert.equal((await createInvite('boss', { code: aCode(), days: 0, uses: null, note: null })).ok, false);
  assert.equal((await createInvite('boss', { code: aCode(), days: 99_999, uses: null, note: null })).ok, false);
});

when('the same code cannot be made twice', async () => {
  const code = aCode();
  assert.equal((await createInvite('boss', { code, days: 30, uses: null, note: null })).ok, true);
  const again = await createInvite('boss', { code: code.toLowerCase(), days: 30, uses: null, note: null });
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.reason, 'taken');
});

/* ---------------- redeeming ---------------- */

when('a good code turns Plus on, typed however', async () => {
  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: null, note: 'testers' });
  const { id, device } = await anAccount();
  assert.equal(await planFor(device), 'free');

  const done = await redeem(id, ` ${code.toLowerCase()} `);
  assert.equal(done.ok, true);
  assert.equal(done.ok && done.days, 30);
  assert.equal(await planFor(device), 'plus');
});

when('a code nobody made does nothing', async () => {
  const { id, device } = await anAccount();
  const done = await redeem(id, 'PLEASE-LET-ME-IN');
  assert.equal(!done.ok && done.reason, 'unknown');
  assert.equal(await planFor(device), 'free');
});

when('the same account cannot use one code twice', async () => {
  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: null, note: null });
  const { id } = await anAccount();
  assert.equal((await redeem(id, code)).ok, true);

  const again = await redeem(id, code);
  assert.equal(!again.ok && again.reason, 'already');
});

when('a code with a limit stops when it runs out', async () => {
  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: 2, note: null });

  assert.equal((await redeem((await anAccount()).id, code)).ok, true);
  assert.equal((await redeem((await anAccount()).id, code)).ok, true);

  const third = await redeem((await anAccount()).id, code);
  assert.equal(third.ok, false, 'a code limited to two served a third person');
  assert.equal(!third.ok && third.reason, 'spent');
});

when('a limited code cannot be overrun by people tapping at once', async () => {
  // The row is locked while the count comes down, so five simultaneous taps
  // on a code worth two uses cannot hand out five.
  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: 2, note: null });
  const people = await Promise.all([anAccount(), anAccount(), anAccount(), anAccount(), anAccount()]);

  const results = await Promise.all(people.map((person) => redeem(person.id, code)));
  assert.equal(results.filter((r) => r.ok).length, 2, 'the use limit was overrun');

  const rows = await query<{ uses_left: number }>('select uses_left from invites where code = $1', [code]);
  assert.equal(rows[0].uses_left, 0);
});

when('switching a code off stops it at once, and back on restores it', async () => {
  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: null, note: null });

  await setInviteDisabled(code, true);
  assert.equal(!(await redeem((await anAccount()).id, code)).ok, true);

  await setInviteDisabled(code, false);
  assert.equal((await redeem((await anAccount()).id, code)).ok, true);
});

when('deleting a code does not take back what it bought', async () => {
  // Deleting a coupon is not a way to un-sell what somebody already has.
  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: null, note: null });
  const { id, device } = await anAccount();
  await redeem(id, code);

  assert.equal(await deleteInvite(code), true);
  assert.equal(await planFor(device), 'plus', 'deleting the code revoked somebody');
  assert.ok((await redemptions()).some((row) => row.code === code), 'the record of who used it went too');
});

when('a code extends somebody rather than cutting them short', async () => {
  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: null, note: null });
  const { id } = await anAccount();
  await query(`update accounts set plus_until = now() + interval '300 days' where id = $1`, [id]);

  await redeem(id, code);
  const rows = await query<{ days: number }>(
    'select extract(day from plus_until - now())::int as days from accounts where id = $1',
    [id],
  );
  assert.ok(rows[0].days > 320, `expected roughly 330 days, got ${rows[0].days}`);
});

when('a lapsed account starts from today, not from when it ran out', async () => {
  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: null, note: null });
  const { id, device } = await anAccount();
  await query(`update accounts set plus_until = now() - interval '200 days' where id = $1`, [id]);

  await redeem(id, code);
  assert.equal(await planFor(device), 'plus', 'the grant was swallowed by the time already lapsed');
});

/* ---------------- what the app is told ---------------- */

when('the code box is only offered while a usable code exists', async () => {
  await query('update invites set disabled = true');
  assert.equal(await invitesExist(), false, 'the box would be offered with nothing behind it');

  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: null, note: null });
  assert.equal(await invitesExist(), true);

  await query('update invites set uses_left = 0 where code = $1', [code]);
  await query('update invites set disabled = true where code <> $1', [code]);
  assert.equal(await invitesExist(), false, 'a spent code still counted as usable');
});

when('the list shows how many people took each one up', async () => {
  const code = aCode();
  await createInvite('boss', { code, days: 30, uses: 5, note: 'for the podcast' });
  await redeem((await anAccount()).id, code);
  await redeem((await anAccount()).id, code);

  const found = (await listInvites()).find((invite) => invite.code === code)!;
  assert.equal(found.used, 2);
  assert.equal(found.usesLeft, 3);
  assert.equal(found.note, 'for the podcast');
});
