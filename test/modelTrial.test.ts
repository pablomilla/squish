import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice } from '../server/identity';
import { signUp } from '../server/accounts';
import { DEFAULT_GEMINI_MODEL, isGeminiName, photoReader, readGeminiTrial, saveGeminiTrial } from '../server/modelTrial';

/**
 * The Gemini trial: an admin's own meal photos go to Gemini only when the
 * switch is on and there is a key. Anybody else's never do.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;
const saved = { admins: process.env.SQUISH_ADMIN_EMAILS, key: process.env.GEMINI_API_KEY };
const ADMIN = `trial-admin-${randomUUID().slice(0, 8)}@example.com`;

before(async () => {
  if (!enabled) return;
  await migrate();
  process.env.SQUISH_ADMIN_EMAILS = ADMIN;
});
after(async () => {
  process.env.SQUISH_ADMIN_EMAILS = saved.admins;
  if (saved.key === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = saved.key;
  if (!enabled) return;
  await query(`delete from admin_settings where key in ('gemini_trial', 'gemini_model')`);
  await closeDatabase();
});

async function aDevice(email?: string) {
  const device = await registerDevice();
  if (!email) return { id: device.id, accountId: null };
  const made = await signUp(device.id, email, 'four random words');
  assert.ok(made.ok);
  return { id: device.id, accountId: made.account.id };
}

test('a model name is a Gemini model name and nothing else', () => {
  assert.equal(isGeminiName('gemini-2.5-flash'), true);
  assert.equal(isGeminiName('gemini-3-pro-preview'), true);
  assert.equal(isGeminiName('claude-opus-5'), false);
  assert.equal(isGeminiName('gemini-2.5-flash/../../x'), false);
  assert.equal(isGeminiName('gemini-Flash'), false);
});

when('only an admin, with the switch on and a key set, is read by Gemini', async () => {
  const admin = await aDevice(ADMIN);
  const person = await aDevice(`someone-${randomUUID().slice(0, 8)}@example.com`);
  const anonymous = await aDevice();

  delete process.env.GEMINI_API_KEY;
  assert.deepEqual(await saveGeminiTrial({ on: true }), { ok: true, trial: { on: true, model: DEFAULT_GEMINI_MODEL, keySet: false } });
  assert.deepEqual(await photoReader(admin), { reader: 'claude' }, 'no key: the switch does nothing');

  process.env.GEMINI_API_KEY = 'gm-test';
  assert.deepEqual(await photoReader(admin), { reader: 'gemini', model: DEFAULT_GEMINI_MODEL });
  assert.deepEqual(await photoReader(person), { reader: 'claude' }, 'somebody else: never');
  assert.deepEqual(await photoReader(anonymous), { reader: 'claude' });
  assert.deepEqual(await photoReader(undefined), { reader: 'claude' });

  assert.equal((await saveGeminiTrial({ model: 'gemini-2.5-pro' })).ok, true);
  assert.deepEqual(await photoReader(admin), { reader: 'gemini', model: 'gemini-2.5-pro' });

  await saveGeminiTrial({ on: false });
  assert.deepEqual(await photoReader(admin), { reader: 'claude' }, 'switched off: Claude again');
});

when('the switch refuses what is not a setting', async () => {
  assert.deepEqual(await saveGeminiTrial({ model: 'claude-opus-5' }), { ok: false, message: 'A Gemini model name, like gemini-2.5-flash.' });
  assert.deepEqual(await saveGeminiTrial({ on: 'yes please' }), { ok: false, message: 'On or off?' });
  await query(`insert into admin_settings (key, value) values ('gemini_model', 'not a model') on conflict (key) do update set value = excluded.value`);
  assert.equal((await readGeminiTrial()).model, DEFAULT_GEMINI_MODEL, 'a bad stored name is never used');
});
