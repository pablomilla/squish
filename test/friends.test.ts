import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { attributeFriend, friendCodeFor, friendsView, isFriendCode, rewardWords, settleFriend } from '../server/friends';
import { allowanceWithExtras, extrasFor } from '../server/plan';

/**
 * Invite a friend: a month of Plus each, but only once the friend has verified
 * their address and used Squish on three different days — and never for
 * inviting yourself, or more than a year's worth in a year.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

before(async () => {
  if (enabled) await migrate();
});

after(async () => {
  if (enabled) await closeDatabase();
});

async function anAccount({ verified = true } = {}) {
  const id = randomUUID();
  await query('insert into accounts (id, email, password_hash, email_verified_at) values ($1, $2, $3, $4)', [
    id,
    `friend-${id}@example.com`,
    'x',
    verified ? new Date() : null,
  ]);
  const device = randomUUID();
  await query('insert into devices (id, token_hash, account_id) values ($1, $2, $3)', [device, `hash-${device}`, id]);
  return { id, device };
}

/** Days ago the device was seen, e.g. [0, 1, 2]. */
async function seen(device: string, daysAgo: number[]) {
  for (const d of daysAgo) {
    await query(`insert into device_days (device_id, day) values ($1, current_date - $2::int) on conflict do nothing`, [device, d]);
  }
}

/** Pretend the invite happened some days ago, as it would have. */
const invitedDaysAgo = (friend: string, days: number) =>
  query(`update friend_referrals set created_at = now() - make_interval(days => $2) where friend_id = $1`, [friend, days]);

const plusDaysLeft = async (id: string) =>
  Number(
    (await query<{ d: string }>(`select extract(epoch from (plus_until - now())) / 86400 as d from accounts where id = $1`, [id]))[0]?.d ?? 0,
  );

when('every account gets one code, the same each time, in the invite shape', async () => {
  const a = await anAccount();
  const code = await friendCodeFor(a.id);
  assert.match(code, /^SQ[A-Z0-9]{6}$/);
  assert.equal(await friendCodeFor(a.id), code);
  assert.equal(await isFriendCode(code.toLowerCase()), true);
  assert.equal(await isFriendCode('SQZZZZZZ'), false);
});

when('you cannot invite yourself, or your other account from your own phone', async () => {
  const me = await anAccount();
  const code = await friendCodeFor(me.id);
  assert.equal(await attributeFriend(me.id, code, null), null);

  const second = await anAccount();
  assert.equal(await attributeFriend(second.id, code, me.id), null, 'signed up on a device signed in to the inviter');
  const real = await anAccount();
  assert.equal(await attributeFriend(real.id, code, null), me.id);
  assert.equal(await attributeFriend(real.id, code, null), me.id, 'a second attempt changes nothing');
  assert.equal((await query('select 1 from friend_referrals where friend_id = $1', [real.id])).length, 1);
});

when('the reward waits for a verified address and three days of use, then comes once to both', async () => {
  const inviter = await anAccount();
  const friend = await anAccount({ verified: false });
  await attributeFriend(friend.id, await friendCodeFor(inviter.id), null);
  await invitedDaysAgo(friend.id, 2);

  await seen(friend.device, [0, 1, 2]);
  assert.equal(await settleFriend(friend.id), null, 'paid out before the address was verified');

  await query('update accounts set email_verified_at = now() where id = $1', [friend.id]);
  const settled = await settleFriend(friend.id);
  assert.equal(settled?.friendKind, 'started');
  assert.equal(settled?.referrerKind, 'started');
  assert.equal(settled?.referrerDays, 30);
  assert.equal(settled?.referrerId, inviter.id);
  assert.ok(Math.abs((await plusDaysLeft(friend.id)) - 30) < 0.1);
  assert.ok(Math.abs((await plusDaysLeft(inviter.id)) - 30) < 0.1);

  assert.equal(await settleFriend(friend.id), null, 'paid twice');
  assert.ok(Math.abs((await plusDaysLeft(friend.id)) - 30) < 0.1);
});

when('two days is not three, and days before the invite do not count', async () => {
  const inviter = await anAccount();
  const friend = await anAccount();
  await attributeFriend(friend.id, await friendCodeFor(inviter.id), null);
  await invitedDaysAgo(friend.id, 1);
  await seen(friend.device, [0, 1, 5, 6, 7]);
  assert.equal(await settleFriend(friend.id), null);
});

when('already on Plus — say a yearly plan: extra AI now, and the month saved on the end', async () => {
  const inviter = await anAccount();
  await query(`update accounts set plus_until = now() + interval '300 days' where id = $1`, [inviter.id]);
  const device = { id: inviter.device, accountId: inviter.id };
  const before = await allowanceWithExtras(device, 'plus');

  const friend = await anAccount();
  await attributeFriend(friend.id, await friendCodeFor(inviter.id), null);
  await invitedDaysAgo(friend.id, 2);
  await seen(friend.device, [0, 1, 2]);
  const settled = await settleFriend(friend.id);

  assert.equal(settled?.referrerKind, 'extended');
  assert.equal(settled?.friendKind, 'started', 'the friend, new, gets Plus switched on');
  assert.ok(Math.abs((await plusDaysLeft(inviter.id)) - 330) < 0.1, 'the month goes on the end');
  const after = await allowanceWithExtras(device, 'plus');
  assert.equal(after.photo - before.photo, 20);
  assert.equal(after.chat - before.chat, 10);
  assert.equal(after.recipe, before.recipe);
  assert.deepEqual(await extrasFor(device, 'free'), { photo: 0, chat: 0, recipe: 0 }, 'extras never top up the free taste');

  const view = await friendsView(inviter.id);
  assert.equal(view.extra?.photo, 20);
  assert.ok(view.plusUntil);

  // The extra runs out.
  await query(`update allowance_boosts set expires_at = now() - interval '1 second' where account_id = $1`, [inviter.id]);
  assert.deepEqual(await allowanceWithExtras(device, 'plus'), before);

  const words = rewardWords('extended', 30, new Date('2027-11-03T12:00:00Z'));
  assert.match(words, /20 extra photo analyses/);
  assert.match(words, /3 November 2027/);
});

when('past the yearly cap the friend is still rewarded; the inviter is not', async () => {
  process.env.SQUISH_FRIEND_CAP = '1';
  try {
    const inviter = await anAccount();
    const code = await friendCodeFor(inviter.id);
    const results = [];
    for (let i = 0; i < 2; i++) {
      const friend = await anAccount();
      await attributeFriend(friend.id, code, null);
      await invitedDaysAgo(friend.id, 2);
      await seen(friend.device, [0, 1, 2]);
      results.push(await settleFriend(friend.id));
    }
    assert.deepEqual(results.map((r) => [r?.friendDays, r?.referrerDays]), [[30, 30], [30, 0]]);

    assert.equal((await friendsView(inviter.id, { peek: true })).fresh, 1, 'a peek leaves the well-done for the invite card');
    const view = await friendsView(inviter.id);
    assert.equal(view.joined, 2);
    assert.equal(view.rewarded, 2);
    assert.equal(view.daysEarned, 30);
    assert.equal(view.capLeft, 0);
    assert.equal(view.fresh, 1, 'the well-done is said once…');
    assert.equal((await friendsView(inviter.id)).fresh, 0, '…and not again');
  } finally {
    delete process.env.SQUISH_FRIEND_CAP;
  }
});

when('an invited friend can see how close they are', async () => {
  const inviter = await anAccount();
  const friend = await anAccount();
  await attributeFriend(friend.id, await friendCodeFor(inviter.id), null);
  await invitedDaysAgo(friend.id, 1);
  await seen(friend.device, [0, 1]);
  const view = await friendsView(friend.id);
  assert.deepEqual(view.mine, { rewarded: false, daysUsed: 2, verified: true });
  assert.equal((await friendsView(inviter.id)).mine, null);
});

when('the thank-you email goes only to an inviter who has confirmed their address', async () => {
  // A stand-in mail provider that keeps what it is sent.
  const sent: { to: string; subject: string }[] = [];
  const provider = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      sent.push(JSON.parse(body));
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => provider.listen(0, '127.0.0.1', () => resolve()));
  const saved = process.env.SQUISH_MAIL_WEBHOOK;
  process.env.SQUISH_MAIL_WEBHOOK = `http://127.0.0.1:${(provider.address() as AddressInfo).port}/`;

  const settleWith = async (inviterVerified: boolean) => {
    const inviter = await anAccount({ verified: inviterVerified });
    const friend = await anAccount();
    await attributeFriend(friend.id, await friendCodeFor(inviter.id), null);
    await invitedDaysAgo(friend.id, 2);
    await seen(friend.device, [0, 1, 2]);
    const settled = await settleFriend(friend.id, 'https://app.squish.online');
    return { inviter, settled };
  };
  const waitFor = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 20));
  };

  try {
    const stranger = await settleWith(false);
    assert.equal(stranger.settled?.referrerDays, 30, 'the reward itself does not wait for the address');
    const confirmed = await settleWith(true);
    await waitFor(() => sent.length > 0);
    // Give a wrongly sent one time to arrive too, before saying there was none.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const addresses = sent.map((mail) => mail.to);
    assert.ok(addresses.includes(`friend-${confirmed.inviter.id}@example.com`), 'the confirmed inviter was not thanked');
    assert.ok(!addresses.includes(`friend-${stranger.inviter.id}@example.com`), 'mail went to an address nobody confirmed');
  } finally {
    if (saved === undefined) delete process.env.SQUISH_MAIL_WEBHOOK;
    else process.env.SQUISH_MAIL_WEBHOOK = saved;
    provider.close();
  }
});
