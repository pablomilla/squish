import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { forClaude } from '../server/chat';
import {
  FEATURES,
  forgetRoutes,
  modelsFor,
  readRoutes,
  recentFailures,
  refusal,
  saveRoutes,
  servedAs,
  servedBy,
  withModels,
  type Routes,
} from '../server/routing';

/**
 * Which model answers each job, what backs it up, and the line nobody's data
 * crosses: to Google, only on an admin's own route, until the privacy policy
 * says otherwise.
 */

const enabled = hasDatabase();
const when = enabled ? test : test.skip;

before(async () => {
  process.env.GEMINI_API_KEY = 'gm-test';
  if (!enabled) return;
  await migrate();
  await query(`delete from admin_settings where key in ('model_routes', 'gemini_trial', 'gemini_model')`);
  await query(`delete from ai_fallbacks where feature = 'coach'`);
});

after(async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.SQUISH_GEMINI_FOR_EVERYONE;
  if (!enabled) return;
  await query(`delete from admin_settings where key in ('model_routes', 'gemini_trial', 'gemini_model')`);
  await query(`delete from ai_fallbacks where feature = 'coach'`);
  await closeDatabase();
});

test('a backup answers when the model before it fails, and the admin is told which', async () => {
  const asked: string[] = [];
  const result = await servedAs('admins', async () => {
    const answer = await withModels(
      'photo',
      async (model) => {
        asked.push(model);
        if (model === 'claude-opus-5') throw new Error('Overloaded');
        return `read by ${model}`;
      },
      { models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] },
    );
    return { answer, served: servedBy('photo') };
  });
  assert.equal(result.answer, 'read by claude-sonnet-5');
  assert.deepEqual(asked, ['claude-opus-5', 'claude-sonnet-5'], 'the second backup is never asked');
  assert.deepEqual(result.served, { feature: 'photo', model: 'claude-sonnet-5', failed: [{ model: 'claude-opus-5', error: 'Overloaded' }] });
});

test('stopping on purpose, or a failure that would happen anywhere, is not tried again', async () => {
  let tries = 0;
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(
    withModels('weekplan', async () => (tries++, Promise.reject(new Error('aborted'))), { signal: stop.signal, models: ['a', 'b'] }),
    /aborted/,
  );
  class TooLong extends Error {}
  await assert.rejects(
    withModels('translate', async () => (tries++, Promise.reject(new TooLong('long'))), { final: (e) => e instanceof TooLong, models: ['a', 'b'] }),
    TooLong,
  );
  assert.equal(tries, 2, 'one try each');
  await assert.rejects(withModels('coach', async (m) => Promise.reject(new Error(`${m} down`)), { models: ['a', 'b'] }), /b down/, 'every model down: the last reason');
});

test('for everybody, a job with their data stays on Claude until the privacy policy names Google', () => {
  assert.match(refusal('gemini-3.8-flash', 'photo', 'everyone')!, /privacy policy/);
  assert.equal(refusal('gemini-3.8-flash', 'photo', 'admins'), null, 'an admin may try it on their own meals');
  assert.equal(refusal('gemini-3.8-flash', 'translate', 'everyone'), null, 'the app’s own words are nobody’s data');
  assert.match(refusal('gpt-9', 'photo', 'admins')!, /price/, 'only models with a price, so every call is costed');
  process.env.SQUISH_GEMINI_FOR_EVERYONE = 'on';
  assert.equal(refusal('gemini-3.8-flash', 'chat', 'everyone'), null, 'once the policy is changed and the switch set');
  delete process.env.SQUISH_GEMINI_FOR_EVERYONE;
  for (const f of FEATURES) assert.ok(f.defaults.every((m) => m.startsWith('claude-')), `${f.id} starts on Claude`);
  assert.ok(FEATURES.every((f) => f.defaults.length >= 2), 'and every job has a backup from the start');
});

test('the nutritionist on a backup Claude: another model’s thinking left out, and no thinking mid-question without a signed turn', () => {
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: 'claude-sonnet-5',
    max_tokens: 2400,
    thinking: { type: 'adaptive' },
    messages: [
      { role: 'user', content: 'How was Tuesday?' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Let me look.', signature: 'opus' },
          { type: 'tool_use', id: 'toolu_1', name: 'look_up_days', input: {} },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' }] },
    ],
  };
  assert.equal(forClaude(params, false).thinking?.type, 'adaptive', 'the model that wrote it carries on as it was');
  const backup = forClaude(params, true);
  assert.equal(backup.thinking?.type, 'disabled');
  assert.ok(!JSON.stringify(backup.messages).includes('"thinking"'), 'the signature was not its own to vouch for');

  // A lookup Gemini asked for, answered, then Claude picks it up.
  const fromGemini = structuredClone(params);
  (fromGemini.messages[1].content as Anthropic.ContentBlockParam[]).shift();
  assert.equal(forClaude(fromGemini, false).thinking?.type, 'disabled');
  // A new question starts clean: the earlier turns do not matter.
  fromGemini.messages.push({ role: 'assistant', content: 'About 1,800.' }, { role: 'user', content: 'And Wednesday?' });
  assert.equal(forClaude(fromGemini, false).thinking?.type, 'adaptive');
});

when('routes are saved whole or not at all, and everybody’s refuses Google', async () => {
  const routes = structuredClone(await readRoutes()) as Routes;
  routes.photo.everyone = ['gemini-3.8-flash', 'claude-opus-5'];
  const refused = await saveRoutes(routes);
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? '' : refused.message, /privacy policy/);

  routes.photo.everyone = ['claude-opus-5', 'claude-sonnet-5'];
  routes.photo.admins = ['gemini-3.8-flash', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
  assert.equal((await saveRoutes(routes)).ok, false, 'a model and at most two backups');

  routes.photo.admins = ['gemini-3.8-flash', 'claude-opus-5'];
  routes.chat.admins = ['gemini-3.8-flash', 'claude-opus-5'];
  const saved = await saveRoutes(routes);
  assert.ok(saved.ok);
  assert.deepEqual(await servedAs('admins', () => modelsFor('photo')), ['gemini-3.8-flash', 'claude-opus-5']);
  assert.deepEqual(await servedAs('everyone', () => modelsFor('photo')), ['claude-opus-5', 'claude-sonnet-5']);
  assert.deepEqual(await modelsFor('chat'), (await readRoutes()).chat.everyone, 'outside a request: everybody’s');

  // Without a key, a Gemini model is stepped over rather than failed on.
  delete process.env.GEMINI_API_KEY;
  assert.deepEqual(await servedAs('admins', () => modelsFor('photo')), ['claude-opus-5']);
  process.env.GEMINI_API_KEY = 'gm-test';

  // Belt and braces: Google written onto everybody's route by hand is still never used.
  const forced = structuredClone(routes);
  forced.chat.everyone = ['gemini-3.8-flash'];
  await query(`update admin_settings set value = $1 where key = 'model_routes'`, [JSON.stringify(forced)]);
  forgetRoutes();
  assert.ok((await servedAs('everyone', () => modelsFor('chat'))).every((m) => m.startsWith('claude-')));
});

when('the Gemini trial’s old switch carries over as an admin photo route', async () => {
  await query(`delete from admin_settings where key = 'model_routes'`);
  await query(
    `insert into admin_settings (key, value) values ('gemini_trial', 'on'), ('gemini_model', 'gemini-3.8-flash')
     on conflict (key) do update set value = excluded.value`,
  );
  forgetRoutes();
  const routes = await readRoutes();
  assert.equal(routes.photo.admins[0], 'gemini-3.8-flash');
  assert.ok(routes.photo.admins.slice(1).every((m) => m.startsWith('claude-')), 'Claude behind it');
  assert.ok(routes.photo.everyone.every((m) => m.startsWith('claude-')));
});

when('failures are counted by day, with whether a backup saved them', async () => {
  await withModels('coach', async (m) => (m === 'claude-opus-5' ? Promise.reject(new Error('overloaded_error')) : 'ok'), {
    models: ['claude-opus-5', 'claude-sonnet-5'],
    record: true,
  });
  // Written without waiting: let the first land before the second, so "last" means last.
  for (let i = 0; i < 40 && !(await recentFailures()).some((f) => f.feature === 'coach'); i++) await new Promise((r) => setTimeout(r, 25));
  await withModels('coach', async () => Promise.reject(new Error('down')), { models: ['claude-opus-5'], record: true }).catch(() => undefined);
  await withModels('coach', async () => Promise.reject(new Error('a benchmark run')), { models: ['claude-opus-5'] }).catch(() => undefined);
  let found: Awaited<ReturnType<typeof recentFailures>> = [];
  for (let i = 0; i < 40 && !found.length; i++) {
    found = (await recentFailures()).filter((f) => f.feature === 'coach' && f.failures >= 2);
    if (!found.length) await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(found[0].model, 'claude-opus-5');
  assert.equal(found[0].failures, 2);
  assert.equal(found[0].rescued, 1);
  assert.equal(found[0].lastError, 'down');
});
