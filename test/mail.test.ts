import assert from 'node:assert/strict';
import { test, before, after, beforeEach } from 'node:test';
import { createServer, type Server } from 'node:http';
import { closeDatabase, hasDatabase, migrate, query } from '../server/db';
import { registerDevice } from '../server/identity';
import { signUp } from '../server/accounts';
import { canSendMail, sendMail, sendQuietly } from '../server/mail';
import { confirm, isVerified, sendVerification } from '../server/verify';
import { describeDevice, noticePasswordChanged, noticeSignIn } from '../server/notices';

/**
 * Email: confirmation links and security notices.
 *
 * Against a stand-in that accepts what a provider like Resend accepts —
 * `{ from, to, subject, text }` posted as JSON with a bearer token — and
 * remembers every message, so the tests can read what would have been sent.
 */
const enabled = hasDatabase();
const when = enabled ? test : test.skip;

let server: Server;
let inbox: { auth: string | undefined; body: { from: string; to: string; subject: string; text: string } }[] = [];
let refuse = false;

let n = 0;
const anEmail = () => `mail${++n}-${Date.now()}@example.com`;

before(async () => {
  await new Promise<void>((resolve) => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        if (refuse) {
          // What a provider says when the from-address is not set up.
          res.writeHead(403).end('{"message":"The squish.online domain is not verified."}');
          return;
        }
        inbox.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
        res.writeHead(200).end('{"id":"stand-in"}');
      });
    });
    server.listen(0, '127.0.0.1', resolve);
  });
  process.env.SQUISH_MAIL_WEBHOOK = `http://127.0.0.1:${(server.address() as { port: number }).port}/emails`;
  process.env.SQUISH_MAIL_TOKEN = 're_test';
  process.env.SQUISH_MAIL_FROM = 'Squish <hello@squish.online>';
  if (enabled) await migrate();
});

beforeEach(() => {
  inbox = [];
  refuse = false;
});

after(async () => {
  server.close();
  delete process.env.SQUISH_MAIL_WEBHOOK;
  delete process.env.SQUISH_MAIL_TOKEN;
  delete process.env.SQUISH_MAIL_FROM;
  if (enabled) await closeDatabase();
});

/** Wait for mail sent without being awaited. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

async function anAccount() {
  const device = await registerDevice();
  const email = anEmail();
  const made = await signUp(device.id, email, 'four random words');
  return { id: made.ok ? made.account.id : '', email };
}

/* ---------------- the mail itself ---------------- */

test('a message goes out in the shape a provider takes, with a from address', async () => {
  await sendMail({ to: 'someone@example.com', subject: 'Hello', text: 'Body' });
  assert.equal(inbox.length, 1);
  assert.deepEqual(inbox[0].body, {
    from: 'Squish <hello@squish.online>',
    to: 'someone@example.com',
    subject: 'Hello',
    text: 'Body',
  });
  assert.equal(inbox[0].auth, 'Bearer re_test');
});

test('settings are read when used, so a change needs no restart', async () => {
  const before = process.env.SQUISH_MAIL_FROM;
  process.env.SQUISH_MAIL_FROM = 'Someone Else <x@squish.online>';
  await sendMail({ to: 'a@example.com', subject: 's', text: 't' });
  assert.equal(inbox[0].body.from, 'Someone Else <x@squish.online>');
  process.env.SQUISH_MAIL_FROM = before;
});

test('a refusal says what the provider said, not just a number', async () => {
  refuse = true;
  await assert.rejects(
    () => sendMail({ to: 'a@example.com', subject: 's', text: 't' }),
    /domain is not verified/,
    '"403" alone tells nobody the from-address is the problem',
  );
});

test('a quiet send never throws, even when the provider refuses', async () => {
  refuse = true;
  assert.doesNotThrow(() => sendQuietly({ to: 'a@example.com', subject: 's', text: 't' }, 'test'));
  await settle();
});

test('with no webhook, nothing is sent and the app knows it', () => {
  const before = process.env.SQUISH_MAIL_WEBHOOK;
  delete process.env.SQUISH_MAIL_WEBHOOK;
  assert.equal(canSendMail(), false);
  process.env.SQUISH_MAIL_WEBHOOK = before;
  assert.equal(canSendMail(), true);
});

/* ---------------- confirming an address ---------------- */

when('a new account is not confirmed until the link is followed', async () => {
  const { id, email } = await anAccount();
  assert.equal(await isVerified(id), false);

  let token = '';
  assert.equal(await sendVerification(id, (t) => ((token = t), `https://squish.online/verify?token=${t}`)), 'sent');
  assert.equal(inbox[0].body.to, email);
  assert.match(inbox[0].body.text, /verify\?token=/);

  const done = await confirm(token);
  assert.equal(done.ok, true);
  assert.equal(await isVerified(id), true);
});

when('following a link twice still says confirmed', async () => {
  // Mail scanners follow links before people do. The person clicking theirs
  // after Outlook got there first must not be told it expired.
  const { id } = await anAccount();
  let token = '';
  await sendVerification(id, (t) => ((token = t), t));

  assert.equal((await confirm(token)).ok, true, 'the scanner');
  assert.equal((await confirm(token)).ok, true, 'the person, a minute later');
});

when('an expired link does nothing', async () => {
  const { id } = await anAccount();
  let token = '';
  await sendVerification(id, (t) => ((token = t), t));
  await query("update verifications set expires_at = now() - interval '1 minute' where account_id = $1", [id]);

  assert.equal((await confirm(token)).ok, false);
  assert.equal(await isVerified(id), false);
});

when('a made-up link does nothing', async () => {
  assert.equal((await confirm('not-a-real-token')).ok, false);
});

when('asking again once confirmed sends nothing', async () => {
  const { id } = await anAccount();
  await query('update accounts set email_verified_at = now() where id = $1', [id]);
  assert.equal(await sendVerification(id, (t) => t), 'already');
  assert.equal(inbox.length, 0);
});

when('the token is stored hashed', async () => {
  const { id } = await anAccount();
  let token = '';
  await sendVerification(id, (t) => ((token = t), t));
  const rows = await query<{ token_hash: string }>('select token_hash from verifications where account_id = $1', [id]);
  assert.ok(rows.length === 1 && rows[0].token_hash !== token);
});

/* ---------------- security notices ---------------- */

when('a sign-in notice goes to a confirmed address, naming the device', async () => {
  const { id, email } = await anAccount();
  await query('update accounts set email_verified_at = now() where id = $1', [id]);

  await noticeSignIn(
    id,
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'https://squish.online',
  );
  await settle();

  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].body.to, email);
  assert.match(inbox[0].body.text, /Safari on iPhone/);
  assert.match(inbox[0].body.text, /reset your password/i);
});

when('nothing is sent to an address nobody has confirmed', async () => {
  // Otherwise anybody could sign up as a stranger and have Squish send them
  // mail about an account they never made.
  const { id } = await anAccount();
  await noticeSignIn(id, 'Chrome', 'https://squish.online');
  await noticePasswordChanged(id, 'changed', 'https://squish.online');
  await settle();
  assert.equal(inbox.length, 0, 'mail went to an unconfirmed address');
});

when('a password change and a reset say different things', async () => {
  const { id } = await anAccount();
  await query('update accounts set email_verified_at = now() where id = $1', [id]);

  await noticePasswordChanged(id, 'changed', 'https://squish.online');
  await noticePasswordChanged(id, 'reset', 'https://squish.online');
  await settle();

  assert.equal(inbox.length, 2);
  assert.match(inbox[0].body.text, /Every other device/);
  assert.match(inbox[1].body.text, /Every device that was signed in/);
});

when('a notice that cannot be sent does not become an error', async () => {
  const { id } = await anAccount();
  await query('update accounts set email_verified_at = now() where id = $1', [id]);
  refuse = true;
  await assert.doesNotReject(() => noticeSignIn(id, 'Chrome', 'https://squish.online'));
  await settle();
});

/* ---------------- naming a device ---------------- */

test('devices are named coarsely enough to recognise, not to identify', () => {
  const cases: [string, string][] = [
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/129.0 Mobile/15E148 Safari/604.1', 'Chrome on iPhone'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', 'Safari on Mac'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36', 'Chrome on Android'],
    ['Mozilla/5.0 (Windows NT 10.0; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on Windows'],
  ];
  for (const [ua, expected] of cases) assert.equal(describeDevice(ua), expected, ua);
  assert.equal(describeDevice(undefined), 'an unrecognised device');
});
