import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { closeDatabase, hasDatabase, migrate } from '../server/db';
import { EMAILS, compose, defaultWording, problemsWith, resetWording, samplesFor, saveWording, wordingFor, type EmailKey } from '../server/emails';
import { renderEmail } from '../server/emailRender';

/**
 * The emails, their wording, and what they turn into.
 *
 * The rules worth protecting: nobody can save an email that is missing the
 * thing it exists to deliver, a typo in a placeholder cannot reach anybody's
 * inbox as literal braces, and nothing from outside — the wording, a device
 * name — can become markup in the HTML version.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;
const ORIGIN = 'https://squish.online';

before(async () => {
  if (enabled) await migrate();
});

after(async () => {
  if (!enabled) return;
  for (const key of Object.keys(EMAILS) as EmailKey[]) await resetWording(key, 'tests');
  await closeDatabase();
});

/* ---------------- the defaults ---------------- */

test('every default wording passes its own rules', () => {
  // If this fails, an email Squish ships with could not be saved unchanged —
  // and would be refused on the way out.
  for (const definition of Object.values(EMAILS)) {
    assert.deepEqual(problemsWith(definition, defaultWording(definition)), [], `${definition.key} breaks its own rules`);
  }
});

test('every placeholder a default uses has a sample, so previews are complete', () => {
  for (const definition of Object.values(EMAILS)) {
    const samples = samplesFor(definition);
    const used = [...`${definition.subject}\n${definition.body}`.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
    for (const name of used) assert.ok(samples[name], `${definition.key} uses {${name}} with no sample`);
    const { text } = renderEmail(definition, defaultWording(definition), samples, ORIGIN);
    assert.ok(!/\{[a-z_]+\}/.test(text), `${definition.key} preview still has a placeholder in it`);
  }
});

/* ---------------- what can be saved ---------------- */

test('a reset email without its link cannot be saved', () => {
  const reset = EMAILS.reset;
  const problems = problemsWith(reset, { ...defaultWording(reset), body: 'Somebody asked to reset your password.' });
  assert.ok(problems.some((p) => p.includes('{link}')), 'a reset nobody can use was allowed');
});

test('a typo in a placeholder is refused, and says what is allowed', () => {
  const verify = EMAILS.verify;
  const problems = problemsWith(verify, { ...defaultWording(verify), body: 'Confirm here: {link}\nValid for {dyas} days.' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\{dyas\} isn't something Squish can fill in/);
  assert.match(problems[0], /\{link\}, \{days\}/, 'it should say what can be used instead');
});

test('an empty subject, a two-line subject and a blank button are refused', () => {
  const verify = EMAILS.verify;
  const base = defaultWording(verify);
  assert.ok(problemsWith(verify, { ...base, subject: '  ' }).length);
  assert.ok(problemsWith(verify, { ...base, subject: 'One\nTwo' }).length);
  assert.ok(problemsWith(verify, { ...base, buttonLabel: '' }).length);
});

/* ---------------- what gets sent ---------------- */

test('the main link becomes a button, and is still there as a plain link', () => {
  const verify = EMAILS.verify;
  const out = renderEmail(verify, defaultWording(verify), { link: 'https://squish.online/verify?token=abc', days: '7' }, ORIGIN);
  assert.match(out.html, /<a href="https:\/\/squish\.online\/verify\?token=abc"[^>]*>Confirm my email<\/a>/);
  assert.match(out.html, /If the button doesn't work/, 'a stripped button would leave no way to confirm');
  assert.match(out.text, /^https:\/\/squish\.online\/verify\?token=abc$/m, 'the text version lost the link');
});

test('the button says what the dashboard says it should', () => {
  const reset = EMAILS.reset;
  const out = renderEmail(reset, { ...defaultWording(reset), buttonLabel: 'Pick a new one' }, samplesFor(reset), ORIGIN);
  assert.match(out.html, />Pick a new one<\/a>/);
});

test('nothing from outside becomes markup', () => {
  // The wording is edited by a trusted person, but a user-agent string is
  // not — and either way, escaping is what makes an ampersand come out right.
  const signin = EMAILS.signin;
  const out = renderEmail(
    signin,
    { ...defaultWording(signin), body: 'Fish & chips <b>bold</b> on {device}.\n\n{app_link}' },
    { device: '<script>alert(1)</script>', time: 'now', app_link: 'https://squish.online' },
    ORIGIN,
  );
  assert.ok(!out.html.includes('<script>'), 'a device name became a script');
  assert.ok(!out.html.includes('<b>bold</b>'), 'the wording became markup');
  assert.match(out.html, /Fish &amp; chips &lt;b&gt;/);
  assert.match(out.text, /<script>alert\(1\)<\/script>/, 'the text version should carry it literally');
});

test('every email says who it is from and links the privacy policy, both versions', () => {
  for (const definition of Object.values(EMAILS)) {
    const out = renderEmail(definition, defaultWording(definition), samplesFor(definition), ORIGIN);
    for (const version of [out.text, out.html]) {
      assert.match(version, /Industry Logic Limited/, `${definition.key} has no sender details`);
      assert.match(version, /https:\/\/squish\.online\/privacy/);
    }
  }
});

test('the design does not depend on the image', () => {
  // Mail apps block images by default. The name is there in text too.
  const out = renderEmail(EMAILS.test, defaultWording(EMAILS.test), {}, ORIGIN);
  assert.match(out.html, /<img [^>]*alt="Squish"/);
  assert.match(out.html, />Squish<\/td>/);
});

/* ---------------- stored wording ---------------- */

when('saved wording is what goes out, and putting back the original works', async () => {
  const saved = { subject: 'Welcome aboard', body: 'Tap below to confirm.\n\n{link}', buttonLabel: 'Yes, it is me' };
  assert.deepEqual(await saveWording('verify', saved, 'boss@example.com'), []);

  const out = await compose('verify', 'a@example.com', { link: 'https://x.test/v', days: '7' }, ORIGIN);
  assert.equal(out.subject, 'Welcome aboard');
  assert.match(out.html, />Yes, it is me<\/a>/);

  await resetWording('verify', 'boss@example.com');
  const back = await compose('verify', 'a@example.com', { link: 'https://x.test/v', days: '7' }, ORIGIN);
  assert.equal(back.subject, EMAILS.verify.subject);
});

when('a broken wording is refused rather than stored', async () => {
  const problems = await saveWording('reset', { subject: 'Reset', body: 'No link here', buttonLabel: 'Go' }, 'boss');
  assert.ok(problems.length);
  assert.equal((await wordingFor('reset')).customised, false);
});
