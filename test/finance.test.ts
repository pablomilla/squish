import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { deviceFor, registerDevice } from '../server/identity';
import { signUp } from '../server/accounts';
import {
  DEFAULT_SETTINGS,
  checkCost,
  finance,
  isMonth,
  metrics,
  monthPnl,
  netPerMonth,
  readSettings,
  saveSettings,
  type FixedCost,
} from '../server/finance';
import { attribute, checkAffiliate, createAffiliate, listAffiliates, recordPayout, tidyCode } from '../server/affiliates';

/**
 * The dashboard's money.
 *
 * The P&L is worked out in a month long past (2001), which nothing else
 * writes to, so these sums are exact whatever the other tests are doing to
 * the present. Each run clears that month first.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

const MONTH = '2001-03';
let n = 0;
const anEmail = () => `money${++n}-${Date.now()}@example.com`;

before(async () => {
  if (!enabled) return;
  await migrate();
  await query(`delete from payments where occurred_at >= '2001-01-01' and occurred_at < '2002-01-01'`);
  await query(`delete from usage where day >= '2001-01-01' and day < '2002-01-01'`);
  await query(`delete from admin_settings`);
});

after(async () => {
  if (!enabled) return;
  await query(`delete from admin_settings`);
  await closeDatabase();
});

async function anAccount() {
  const device = await registerDevice();
  const made = await signUp(device.id, anEmail(), 'four random words');
  assert.ok(made.ok);
  return { id: made.account.id, deviceId: device.id, token: device.token };
}

let paymentId = 0;
async function pay(accountId: string | null, at: string, netPence: number, kind = 'purchase', product = 'monthly') {
  const sign = kind === 'refund' ? -1 : 1;
  const net = sign * Math.abs(netPence);
  await query(
    `insert into payments (id, account_id, store, product, kind, gross_pence, vat_pence, store_fee_pence, net_pence, occurred_at)
     values ($1, $2, 'manual', $3, $4, $5, $6, $7, $8, $9)`,
    [`test-${Date.now()}-${++paymentId}`, accountId, product, kind, Math.round(net * 1.41), Math.round(net * 0.235), Math.round(net * 0.176), net, at],
  );
}

const noFixed: FixedCost[] = [];

/* ---------------- plain sums ---------------- */

test('the money and the affiliates never go near a diary', () => {
  for (const file of ['server/finance.ts', 'server/affiliates.ts']) {
    assert.ok(!/diaries/.test(readFileSync(file, 'utf8')), `${file} reads diaries`);
  }
});

test('a subscriber-month leaves what the costing says it does', () => {
  const net = netPerMonth(DEFAULT_SETTINGS);
  // £6.99 less VAT (÷1.2) less the store's 15%: £4.95. £49.99 the same way, a twelfth: £2.95.
  assert.equal(Math.round(net.monthly), 495);
  assert.equal(Math.round(net.yearly), 295);
});

test('months have to look like months', () => {
  assert.equal(isMonth('2026-09'), true);
  assert.equal(isMonth('2026-13'), false);
  assert.equal(isMonth('2026-9'), false);
  assert.equal(isMonth("2026-09'; drop table payments; --"), false);
});

test('a fixed cost needs a name, an amount, a currency and a period', () => {
  assert.equal(typeof checkCost({ label: '', amount: 5, currency: 'GBP', period: 'month' }), 'string');
  assert.equal(typeof checkCost({ label: 'Thing', amount: -1, currency: 'GBP', period: 'month' }), 'string');
  assert.equal(typeof checkCost({ label: 'Thing', amount: 5, currency: 'EUR', period: 'month' }), 'string');
  assert.equal(typeof checkCost({ label: 'Thing', amount: 5, currency: 'GBP', period: 'week' }), 'string');
  assert.deepEqual(checkCost({ label: ' Thing ', amount: '5', currency: 'USD', period: 'year' }), {
    label: 'Thing',
    amount: 5,
    currency: 'USD',
    period: 'year',
    active: true,
  });
});

test('an affiliate needs a usable code', () => {
  assert.equal(tidyCode(' sam-10 '), 'SAM-10');
  assert.equal(typeof checkAffiliate({ name: 'Sam', code: 'a b', rate: 0.3, months: 12 }), 'string');
  assert.equal(typeof checkAffiliate({ name: 'Sam', code: 'SAM', rate: 1.5, months: 12 }), 'string');
  assert.equal(typeof checkAffiliate({ name: 'Sam', code: 'SAM', rate: 0.3, months: 0 }), 'string');
  const ok = checkAffiliate({ name: 'Sam', code: 'sam', rate: '0.25', months: '6', email: '' });
  assert.equal(typeof ok, 'object');
  assert.equal(typeof ok === 'object' && ok.code, 'SAM');
});

/* ---------------- settings ---------------- */

when('settings default to the costing, and a bad one changes nothing', async () => {
  assert.deepEqual(await readSettings(), DEFAULT_SETTINGS);
  const bad = await saveSettings({ usdToGbp: 0.8, storeCut: 0.9 });
  assert.equal(bad.ok, false);
  assert.equal((await readSettings()).usdToGbp, DEFAULT_SETTINGS.usdToGbp, 'half a bad save was kept');
  const good = await saveSettings({ usdToGbp: '0.8', nonsense: 5 } as Record<string, unknown>);
  assert.equal(good.ok, true);
  assert.equal((await readSettings()).usdToGbp, 0.8);
  await query('delete from admin_settings');
});

/* ---------------- the P&L ---------------- */

when('a month adds up: payments less refunds, commission, AI and fixed costs', async () => {
  const buyer = await anAccount();
  await pay(buyer.id, '2001-03-02', 495);
  await pay(buyer.id, '2001-03-10', 3542, 'purchase', 'yearly');
  await pay(buyer.id, '2001-03-11', 495, 'refund');
  await pay(buyer.id, '2001-04-01', 495); // next month: not this one's
  await query(`insert into usage (device_id, day, kind, count, cost_usd) values ($1, '2001-03-05', 'photo', 3, 0.1), ($1, '2001-03-06', 'chat', 1, 0.05)`, [
    buyer.deviceId,
  ]);

  const fixed: FixedCost[] = [
    { id: 1, label: 'Hosting', amount: 10, currency: 'GBP', period: 'month', active: true, monthlyPence: 1000 },
    { id: 2, label: 'Old thing', amount: 99, currency: 'GBP', period: 'month', active: false, monthlyPence: 9900 },
  ];
  const pnl = await monthPnl(MONTH, { ...DEFAULT_SETTINGS, usdToGbp: 0.8 }, fixed);

  assert.equal(pnl.payments, 3);
  assert.equal(pnl.netPence, 495 + 3542 - 495);
  assert.equal(pnl.refundsPence, 495);
  assert.equal(pnl.commissionPence, 0, 'nobody referred this buyer');
  // $0.15 at 0.8 is 12p.
  assert.equal(pnl.aiPence, 12);
  assert.deepEqual(
    pnl.aiByKind.map((k) => [k.kind, k.calls, k.pence]),
    [
      ['chat', 1, 4],
      ['photo', 3, 8],
    ],
  );
  assert.equal(pnl.fixedPence, 1000, 'a switched-off cost still counted');
  assert.equal(pnl.profitPence, 3542 - 12 - 1000);
  assert.equal(pnl.current, false);
});

when("commission is paid only inside the affiliate's months, and only once they sent someone", async () => {
  const code = `T${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
  const made = await createAffiliate({ name: 'Test', code, email: null, rate: 0.5, months: 2, note: null });
  assert.ok(made.ok);
  const again = await createAffiliate({ name: 'Copy', code, email: null, rate: 0.5, months: 2, note: null });
  assert.equal(again.ok, false, 'two people with one code');

  const referred = await anAccount();
  assert.equal(await attribute(referred.id, code.toLowerCase()), made.ok && made.id);
  await query(`update accounts set referred_at = '2001-01-15' where id = $1`, [referred.id]);

  await pay(referred.id, '2001-01-10', 1000); // before they were referred
  await pay(referred.id, '2001-02-01', 400);
  await pay(referred.id, '2001-03-01', 600);
  await pay(referred.id, '2001-03-20', 800); // after the two months

  const march = await monthPnl('2001-03', DEFAULT_SETTINGS, noFixed);
  assert.equal(march.commissionPence, 300, 'half of the 600 inside the window, and nothing else');
  const feb = await monthPnl('2001-02', DEFAULT_SETTINGS, noFixed);
  assert.equal(feb.commissionPence, 200);
  const jan = await monthPnl('2001-01', DEFAULT_SETTINGS, noFixed);
  assert.equal(jan.commissionPence, 0, 'paid on money that came before the referral');

  const listed = (await listAffiliates()).find((a) => a.code === code);
  assert.ok(listed);
  assert.equal(listed.signups, 1);
  assert.equal(listed.earnedPence, 500);
  assert.equal(await recordPayout(listed.id, 0, null, 'test'), false);
  assert.equal(await recordPayout(listed.id, 150, 'Bank transfer', 'test'), true);
  const after = (await listAffiliates()).find((a) => a.code === code);
  assert.equal(after?.paidPence, 150);
  assert.equal(after?.owedPence, 350);
});

when('a code that does not exist, or is switched off, is quietly ignored', async () => {
  const person = await anAccount();
  assert.equal(await attribute(person.id, 'NOBODY-HAS-THIS'), null);
  assert.equal(await attribute(person.id, '<script>'), null);
  assert.equal(await attribute(person.id, undefined), null);
  const rows = await query<{ referred_by: string | null }>('select referred_by from accounts where id = $1', [person.id]);
  assert.equal(rows[0].referred_by, null);
});

when('somebody already credited to one affiliate is not taken by another', async () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const first = await createAffiliate({ name: 'First', code: `A${stamp}`, email: null, rate: 0.3, months: 12, note: null });
  const second = await createAffiliate({ name: 'Second', code: `B${stamp}`, email: null, rate: 0.3, months: 12, note: null });
  assert.ok(first.ok && second.ok);
  const person = await anAccount();
  await attribute(person.id, `A${stamp}`);
  await attribute(person.id, `B${stamp}`);
  const rows = await query<{ referred_by: string }>('select referred_by from accounts where id = $1', [person.id]);
  assert.equal(rows[0].referred_by, first.id);
});

when('paying now counts a current subscription and not a refunded or lapsed one', async () => {
  const before = await finance('2001-03');
  const paying = await anAccount();
  const lapsed = await anAccount();
  const refunded = await anAccount();
  const ids: string[] = [];
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  await pay(paying.id, daysAgo(3), 295 * 12, 'purchase', 'yearly');
  await pay(lapsed.id, daysAgo(40), 495);
  await pay(refunded.id, daysAgo(5), 495);
  await pay(refunded.id, daysAgo(4), 495, 'refund');
  const rows = await query<{ id: string }>('select id from payments where account_id = any($1)', [[paying.id, lapsed.id, refunded.id]]);
  ids.push(...rows.map((r) => r.id));

  const now2 = await finance('2001-03');
  assert.equal(now2.paying.accounts - before.paying.accounts, 1);
  assert.equal(now2.paying.yearly - before.paying.yearly, 1);
  assert.equal(now2.paying.mrrPence - before.paying.mrrPence, 295);
  assert.equal(now2.onSale, true);
  assert.equal(now2.history.length, 6);
  assert.deepEqual(
    now2.history.map((m) => m.month),
    ['2000-10', '2000-11', '2000-12', '2001-01', '2001-02', '2001-03'],
  );
  await query('delete from payments where id = any($1)', [ids]);
});

/* ---------------- trends ---------------- */

when('a device used today shows up in the day’s active count', async () => {
  const device = await registerDevice();
  await deviceFor(device.token);
  // The note is written without waiting; give it a moment.
  for (let i = 0; i < 20; i++) {
    const rows = await query('select 1 from device_days where device_id = $1 and day = current_date', [device.id]);
    if (rows.length) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const m = await metrics(7);
  assert.equal(m.series.length, 7);
  assert.equal(m.series[6].day, (await query<{ d: string }>(`select to_char(current_date, 'YYYY-MM-DD') as d`))[0].d);
  assert.ok(m.series[6].active >= 1);
  assert.ok(m.totals.active >= 1);
  assert.ok(m.recordedSince);
  assert.ok(m.plans.signedOutActive >= 1);
  assert.equal(m.plans.accounts, m.plans.free + m.plans.compedPlus + m.plans.payingPlus);
});

when('the span is kept to something sensible', async () => {
  assert.equal((await metrics(2)).days, 7);
  assert.equal((await metrics(10_000)).series.length, 365);
});
