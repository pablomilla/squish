import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { judgePassword, timesBreached } from '../server/passwords';

/**
 * Refusing passwords that are already in somebody's breach dump.
 *
 * Tested against a stand-in that speaks the same protocol as Have I Been
 * Pwned — five characters of a SHA-1 in, a list of suffixes and counts back —
 * because the real one is rate limited, occasionally slow, and not something
 * a test suite should lean on.
 *
 * The behaviour that matters most is the failure: this must never be able to
 * stop somebody signing up. A password check that takes the service down when
 * a third party has a bad afternoon is worse than the attack it prevents.
 */
let server: Server;
let seen: string[] = [];

/** Every suffix the stand-in "knows", keyed by prefix, as HIBP returns them. */
const BREACHED = ['password', 'password1', 'letmein', 'qwerty123'];
const PASSWORD_HASH = createHash('sha1').update('password').digest('hex').toUpperCase();

before(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      const url = req.url ?? '';
      const prefix = url.split('/').pop()!.toUpperCase();

      // The path says how the stand-in should behave, so a test can ask for
      // a service that is down or one that never answers.
      if (url.startsWith('/broken/')) {
        res.writeHead(503).end('nope');
        return;
      }
      if (url.startsWith('/hangs/')) return; // never answers

      seen.push(prefix);

      const lines = BREACHED.map((word) => createHash('sha1').update(word).digest('hex').toUpperCase())
        .filter((hash) => hash.startsWith(prefix))
        .map((hash) => `${hash.slice(5)}:${hash.startsWith(PASSWORD_HASH.slice(0, 5)) && hash === PASSWORD_HASH ? 9_659_365 : 42}`);

      // Padding, the way the real one does: a prefix nobody has still returns
      // a plausible list, so response size gives nothing away.
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end([...lines, '0000000000000000000000000000000000A:0'].join('\r\n'));
    });
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = (server.address() as { port: number }).port;
  process.env.SQUISH_PWNED_API = `http://127.0.0.1:${port}/range`;
  process.env.SQUISH_PWNED_TIMEOUT_MS = '400';
});

after(() => {
  server.close();
  delete process.env.SQUISH_PWNED_API;
  delete process.env.SQUISH_PWNED_TIMEOUT_MS;
});

test('a password from a breach dump is recognised', async () => {
  assert.equal(await timesBreached('password'), 9_659_365);
  assert.equal(await timesBreached('letmein'), 42);
});

test('a password nobody has seen comes back clean', async () => {
  assert.equal(await timesBreached('warthog trombone kettle sandal'), 0);
});

test('only five characters of a hash ever leave', async () => {
  // The whole reason this is safe to use. The password does not go, and
  // neither does anything that identifies it — they learn that somebody
  // asked about one of half a million possibilities.
  seen = [];
  const password = 'warthog trombone kettle sandal';
  await timesBreached(password);

  const hash = createHash('sha1').update(password).digest('hex').toUpperCase();
  assert.equal(seen.length, 1);
  assert.equal(seen[0], hash.slice(0, 5));
  assert.equal(seen[0].length, 5, 'more than the prefix was sent');
  assert.ok(!seen[0].includes(hash.slice(5, 10)), 'part of the suffix leaked into the request');
});

test('a service that is down lets the password through', async () => {
  // Failing open, on purpose. Verified by asking about a password the
  // stand-in would otherwise refuse.
  const before = process.env.SQUISH_PWNED_API;
  process.env.SQUISH_PWNED_API = before!.replace('/range', '/broken');

  const verdict = await judgePassword('password');
  assert.equal(verdict.ok, true, 'a sign-up was blocked because a third party was down');
  assert.equal(verdict.breaches, null, 'unknown must not be reported as zero');
  process.env.SQUISH_PWNED_API = before;
});

test('a service that hangs lets the password through, and does not hang with it', async () => {
  const before = process.env.SQUISH_PWNED_API;
  // The stand-in never answers on this path; the timeout has to save us.
  process.env.SQUISH_PWNED_API = before!.replace('/range', '/hangs');

  const started = Date.now();
  const verdict = await judgePassword('password');
  const took = Date.now() - started;

  assert.equal(verdict.ok, true);
  assert.ok(took < 3000, `waited ${took}ms — somebody signing up would have given up`);
  process.env.SQUISH_PWNED_API = before;
});

test('the refusal says why, with the number, and does not blame them', async () => {
  const verdict = await judgePassword('password');
  assert.equal(verdict.ok, false);
  assert.match(verdict.message!, /9,659,365/, 'the number is what makes it land');
  assert.match(verdict.message!, /nothing you did was wrong/i);
});

test('it can be turned off entirely', async () => {
  const before = process.env.SQUISH_PWNED_API;
  process.env.SQUISH_PWNED_API = 'off';
  assert.equal((await judgePassword('password')).ok, true);
  process.env.SQUISH_PWNED_API = before;
});
