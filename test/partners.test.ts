import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { createAffiliate, noteClick } from '../server/affiliates';
import {
  claimPartnerLink,
  emailTaken,
  endPartnerSession,
  handPartnerLink,
  partnerFor,
  partnerView,
  requestPartnerLink,
} from '../server/partners';

/**
 * The partner page.
 *
 * What matters most is who gets in and what they see: a link works once and
 * not late, a session is only ever the one partner's, and nothing on the page
 * says who signed up.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

before(async () => {
  if (enabled) await migrate();
});

after(async () => {
  if (enabled) await closeDatabase();
});

const url = (token: string) => `https://app.example/partners#token=${token}`;
const tokenOf = (link: string) => link.split('#token=')[1];

async function aPartner(email: string | null = `partner-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`) {
  const code = `P${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 20);
  const made = await createAffiliate({ name: 'Pat', code, email, rate: 0.3, months: 12, note: 'private note: pays late' });
  assert.ok(made.ok);
  return { id: made.id, code, email };
}

test('the partner page never learns about diaries or who signed up', () => {
  const source = readFileSync('server/partners.ts', 'utf8');
  assert.ok(!/diaries/.test(source));
  assert.ok(!/select[^`]*\bemail\b[^`]*from accounts/i.test(source), 'reads account email addresses');
});

when('a link works once', async () => {
  const partner = await aPartner();
  const handed = await handPartnerLink(partner.id, url, false);
  assert.ok(handed.ok);
  const token = tokenOf(handed.url);
  const session = await claimPartnerLink(token);
  assert.ok(session);
  assert.equal(await claimPartnerLink(token), null, 'a used link let somebody in again');
  assert.equal(await partnerFor(session), partner.id);
});

when('a link that has run out does nothing', async () => {
  const partner = await aPartner();
  const handed = await handPartnerLink(partner.id, url, false);
  assert.ok(handed.ok);
  await query(`update affiliate_links set expires_at = now() - interval '1 minute' where affiliate_id = $1`, [partner.id]);
  assert.equal(await claimPartnerLink(tokenOf(handed.url)), null);
});

when('nonsense is not a link or a session', async () => {
  assert.equal(await claimPartnerLink('x'), null);
  assert.equal(await claimPartnerLink(undefined), null);
  assert.equal(await claimPartnerLink('a'.repeat(43)), null);
  assert.equal(await partnerFor(undefined), null);
  assert.equal(await partnerFor('a'.repeat(43)), null);
});

when('signing out ends the session', async () => {
  const partner = await aPartner();
  const handed = await handPartnerLink(partner.id, url, false);
  assert.ok(handed.ok);
  const session = await claimPartnerLink(tokenOf(handed.url));
  assert.ok(session);
  await endPartnerSession(session);
  assert.equal(await partnerFor(session), null);
});

when('with no email set up, asking for a link sends nothing and says nothing different', async () => {
  const saved = process.env.SQUISH_MAIL_WEBHOOK;
  delete process.env.SQUISH_MAIL_WEBHOOK;
  const partner = await aPartner();
  await requestPartnerLink(partner.email!, url);
  await requestPartnerLink('nobody-at-all@example.com', url);
  const rows = await query('select 1 from affiliate_links where affiliate_id = $1', [partner.id]);
  assert.equal(rows.length, 0);
  if (saved !== undefined) process.env.SQUISH_MAIL_WEBHOOK = saved;
});

when('one email address, one partner — whatever the capitals', async () => {
  const partner = await aPartner();
  assert.equal(await emailTaken(partner.email!.toUpperCase()), true);
  assert.equal(await emailTaken(partner.email!, partner.id), false, 'their own address counted against them');
  assert.equal(await emailTaken(null), false);
});

when('their page shows their figures and none of the private ones', async () => {
  const partner = await aPartner();
  await noteClick(partner.code.toLowerCase());
  await noteClick(partner.code);
  const view = await partnerView(partner.id);
  assert.ok(view);
  assert.equal(view.totals.clicks, 2);
  assert.equal(view.days.length, 30);
  assert.equal(view.days[29].clicks, 2, 'the visits did not land on today');
  assert.equal(view.byMonth.length, 12);
  const text = JSON.stringify(view);
  assert.ok(!text.includes('private note'), 'the admin note reached the partner');
  assert.ok(!text.includes(partner.email!), 'an email address reached the page');
  assert.ok(!('note' in view) && !('email' in view));
});

when('the dashboard knows they opened their page, even after they sign out', async () => {
  const { listAffiliates } = await import('../server/affiliates');
  const partner = await aPartner();
  assert.equal((await listAffiliates(partner.id))[0].portalSeenAt, null);
  const handed = await handPartnerLink(partner.id, url, false);
  assert.ok(handed.ok);
  const session = await claimPartnerLink(tokenOf(handed.url));
  await partnerFor(session!);
  await endPartnerSession(session!);
  assert.ok((await listAffiliates(partner.id))[0].portalSeenAt);
});
