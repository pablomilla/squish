import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { claimHandoff, deviceFor, registerDevice, startHandoff } from '../server/identity';
import { signUp } from '../server/accounts';

/**
 * Moving a browser from squish.online to app.squish.online.
 *
 * What matters is that the same device arrives — its diary, its account —
 * and that the code which carried it cannot carry anybody else afterwards.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

before(async () => {
  if (enabled) await migrate();
});

after(async () => {
  if (enabled) await closeDatabase();
});

when('the same device arrives with a new token, and the old one stops working', async () => {
  const old = await registerDevice();
  const made = await signUp(old.id, `handoff-${Date.now()}@example.com`, 'four random words');
  assert.ok(made.ok);

  const code = await startHandoff(old.id);
  const claimed = await claimHandoff(code);
  assert.ok(claimed);
  assert.equal(claimed.id, old.id, 'the same device, so the same diary');
  assert.notEqual(claimed.token, old.token);

  const now = await deviceFor(claimed.token);
  assert.equal(now?.id, old.id);
  assert.equal(now?.accountId, made.account.id, 'and still signed in');
  assert.equal(await deviceFor(old.token), null, 'what is left at the old address can no longer act as it');
});

when('a code works once', async () => {
  const device = await registerDevice();
  const code = await startHandoff(device.id);
  assert.ok(await claimHandoff(code));
  assert.equal(await claimHandoff(code), null);
});

when('a code that has expired is refused', async () => {
  const device = await registerDevice();
  const code = await startHandoff(device.id);
  await query("update device_handoffs set expires_at = now() - interval '1 minute' where device_id = $1", [device.id]);
  assert.equal(await claimHandoff(code), null);
  assert.ok(await deviceFor(device.token), 'and the device is untouched');
});

when('asking again replaces the earlier code', async () => {
  const device = await registerDevice();
  const first = await startHandoff(device.id);
  const second = await startHandoff(device.id);
  assert.equal(await claimHandoff(first), null);
  assert.ok(await claimHandoff(second));
});

when('nonsense claims nothing', async () => {
  assert.equal(await claimHandoff(''), null);
  assert.equal(await claimHandoff('not-a-real-code'), null);
});
