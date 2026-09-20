import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueNow, localNow, type PushSubscriptionRecord } from '../server/push';

const sub = (over: Partial<PushSubscriptionRecord> = {}): PushSubscriptionRecord => ({
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'p', auth: 'a' },
  times: { breakfast: '08:00', lunch: '12:30', dinner: '19:00' },
  timezone: 'Europe/London',
  sent: {},
  ...over,
});

/** 2026-06-15 is British Summer Time; 2026-01-15 is not. */
const at = (iso: string) => new Date(iso);

test('the reminder lands at the local hour, not the server one', () => {
  // 07:00 UTC in June is 08:00 in London.
  assert.deepEqual(localNow('Europe/London', at('2026-06-15T07:00:00Z')), { time: '08:00', date: '2026-06-15' });
  // The same instant in January would be 07:00 — which is the whole point.
  assert.equal(localNow('Europe/London', at('2026-01-15T07:00:00Z')).time, '07:00');
});

test('summer time is handled because the zone is a name, not an offset', () => {
  const summer = dueNow([sub()], at('2026-06-15T07:00:00Z'));
  assert.deepEqual(summer.map((d) => d.meal), ['breakfast'], 'BST: 08:00 local');

  const winter = dueNow([sub()], at('2026-01-15T07:00:00Z'));
  assert.deepEqual(winter, [], 'GMT: that instant is 07:00 local, an hour early');
  assert.deepEqual(dueNow([sub()], at('2026-01-15T08:00:00Z')).map((d) => d.meal), ['breakfast']);
});

test('somebody on the other side of the world gets their own breakfast time', () => {
  const sydney = sub({ timezone: 'Australia/Sydney', endpoint: 'https://push.example/syd' });
  // 22:00 UTC on the 14th is 08:00 on the 15th in Sydney.
  const due = dueNow([sydney], at('2026-06-14T22:00:00Z'));
  assert.deepEqual(due, [{ endpoint: 'https://push.example/syd', meal: 'breakfast', date: '2026-06-15' }]);
});

test('a minute is either the minute or it is not', () => {
  assert.deepEqual(dueNow([sub()], at('2026-06-15T06:59:00Z')), [], 'a minute early');
  assert.deepEqual(dueNow([sub()], at('2026-06-15T07:01:00Z')), [], 'a minute late');
  assert.equal(dueNow([sub()], at('2026-06-15T07:00:30Z')).length, 1, 'within the minute counts');
});

test('once a day and no more', () => {
  const already = sub({ sent: { breakfast: '2026-06-15' } });
  assert.deepEqual(dueNow([already], at('2026-06-15T07:00:00Z')), [], 'already sent today');
  assert.equal(dueNow([already], at('2026-06-16T07:00:00Z')).length, 1, 'but tomorrow is a new day');
});

test('a meal with no time set is a meal with no reminder', () => {
  const lunchOnly = sub({ times: { lunch: '12:30' } });
  assert.deepEqual(dueNow([lunchOnly], at('2026-06-15T07:00:00Z')), [], 'no breakfast time, no breakfast nudge');
  assert.equal(dueNow([lunchOnly], at('2026-06-15T11:30:00Z')).length, 1);
});

test('two meals at the same minute both fire', () => {
  const same = sub({ times: { breakfast: '08:00', lunch: '08:00' } });
  assert.deepEqual(dueNow([same], at('2026-06-15T07:00:00Z')).map((d) => d.meal), ['breakfast', 'lunch']);
});

test('one broken timezone does not stop everybody else being reminded', () => {
  const broken = sub({ timezone: 'Middle/Earth', endpoint: 'https://push.example/broken' });
  const fine = sub({ endpoint: 'https://push.example/fine' });

  assert.deepEqual(localNow('Middle/Earth'), { time: '', date: '' }, 'an unknown zone reports nothing');
  const due = dueNow([broken, fine], at('2026-06-15T07:00:00Z'));
  assert.deepEqual(due.map((d) => d.endpoint), ['https://push.example/fine']);
});

test('midnight is the start of the day, not the end of the last one', () => {
  const nightOwl = sub({ times: { dinner: '00:00' }, timezone: 'UTC' });
  const due = dueNow([nightOwl], at('2026-06-15T00:00:00Z'));
  assert.deepEqual(due, [{ endpoint: 'https://push.example/abc', meal: 'dinner', date: '2026-06-15' }]);
});

test('nobody subscribed means nothing to send', () => {
  assert.deepEqual(dueNow([], at('2026-06-15T07:00:00Z')), []);
});
