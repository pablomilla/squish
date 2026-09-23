/**
 * Squish API server.
 *
 * In development it serves the API only and Vite proxies to it. In production
 * it also serves the built app, so the whole thing is one deployable service
 * on one port.
 *
 * The Anthropic key stays here — the browser never sees it. When no key is
 * configured every endpoint still answers, using the offline estimator, and
 * marks the response `offline: true` so the UI can label it honestly.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AnalysisResult, MealSlot } from '../src/types';
import { demoEstimateFromPhoto, estimateFromText } from '../src/lib/estimate';
import { BarcodeError, lookupBarcode } from './barcode';
import { FetchGuardError, readRecipePage } from './recipe';
import { chatStep, cleanMessages, cleanNotes, toolRounds, type ChatUsage } from './chat';
import { hasDatabase } from './db';
import { claimHandoff, deviceFor, registerDevice, spend, startHandoff, type Device, type Spend } from './identity';
import { deleteDiary, ownerOf, readDiary, writeDiary } from './diary';
import { privacyPage, standalonePage } from './privacy';
import { confirm, isVerified, sendVerification } from './verify';
import { noticePasswordChanged, noticeSignIn } from './notices';
import { canSendMail, sendMail } from './mail';
import { EMAILS, isEmailKey, listWording, problemsWith, resetWording, samplesFor, saveWording, type Wording } from './emails';
import { renderEmail } from './emailRender';
import { ALLOWANCE, PERIOD, allowanceFor, isBillable, needsAccount, nextReset, planFor, standingOf, usedFor, type Billable, type Plan } from './plan';
import {
  createInvite,
  deleteInvite,
  invitesExist,
  listInvites,
  redeem,
  redemptions,
  setInviteDisabled,
  suggestCode,
} from './invites';
import { actions, adminEmail, allowances, isAdmin, mailReady, overview, people, recordAdminAction, sendTestMail, setPlan } from './admin';
import { siteRouter } from './site';
import {
  claimPartnerLink,
  emailTaken,
  endPartnerSession,
  endPartnerSessions,
  handPartnerLink,
  partnerFor,
  partnerView,
  requestPartnerLink,
} from './partners';
import {
  addCost,
  checkCost,
  finance,
  isMonth,
  metrics,
  readSettings,
  removeCost,
  saveSettings,
  thisMonth,
  updateCost,
} from './finance';
import {
  attribute,
  checkAffiliate,
  createAffiliate,
  listAffiliates,
  noteClick,
  payouts,
  recordPayout,
  tidyCode,
  updateAffiliate,
} from './affiliates';
import { beginSetup, checkCode, endSession, finishSetup, hasPassed, replaceRecoveryCodes, stateFor } from './twofactor';
import { billedTo } from './billing';
import { PLUS } from '../src/lib/subscription';
import {
  MIN_PASSWORD,
  accountFor,
  changePassword,
  completeReset,
  deleteAccount,
  requestReset,
  signIn,
  otherDevices,
  signOut,
  signOutEverywhere,
  signUp,
  verifyPassword,
} from './accounts';
import {
  analyseLabel,
  analysePhoto,
  analyseRecipe,
  analyseText,
  coachMessage,
  credentialSource,
  hasCredentials,
  refineAnalysis,
  type CoachContext,
} from './claude';

const app = express();
app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(identify);

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(process.cwd(), 'dist');
const SERVE_APP = existsSync(DIST);

/** Set this on a public deployment, or anyone who finds the URL spends your credit. */

/**
 * Analyses per IP per hour.
 *
 * A blunt backstop underneath the per-person allowance, for the case the
 * allowance cannot be counted — no database, or a metering failure. It is the
 * worse limit of the two: everybody on a mobile network shares an address.
 */
const RATE_LIMIT = Number(process.env.SQUISH_RATE_LIMIT ?? 80);
const HOUR_MS = 3_600_000;

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const asSlot = (value: unknown): MealSlot | undefined =>
  typeof value === 'string' && SLOTS.includes(value as MealSlot) ? (value as MealSlot) : undefined;

function logFailure(where: string, error: unknown): void {
  console.warn(`[squish] ${where} fell back to the offline estimator:`, error instanceof Error ? error.message : error);
}

/**
 * What the nutritionist just spent, one line per call.
 *
 * Numbers only — no question, no answer, nothing from anybody's diary. It is
 * there to answer "what does this feature cost per user", which until now was
 * a question nobody could answer from anything but arithmetic. One question
 * makes one line per round, so `round=0` marks where each new question starts.
 *
 * `cached` against `wrote` is the caching working or not: after the first call
 * of the day most of the prompt should be read rather than written.
 */
function logUsage(usage: ChatUsage, round: number): void {
  const money = usage.costUsd === null ? 'unpriced' : `$${usage.costUsd.toFixed(4)}`;
  console.info(
    `[squish] nutritionist round=${round} model=${usage.model} ` +
      `in=${usage.inputTokens} cached=${usage.cacheReadTokens} wrote=${usage.cacheWriteTokens} ` +
      `out=${usage.outputTokens} (thinking ${usage.thinkingTokens}) ${money} ${(usage.latencyMs / 1000).toFixed(1)}s`,
  );
}

/* ------------------------------------------------------------------ *
 * Who is asking
 * ------------------------------------------------------------------ */

declare module 'express-serve-static-core' {
  interface Request {
    device?: Device;
  }
}

/**
 * Attach the device, if there is one, before anything that counts.
 *
 * Never rejects. A request with no token, a stale token or no database at all
 * carries on as an anonymous one and meets the old per-IP limit instead —
 * which is what keeps every existing browser working on the day this ships,
 * and what keeps the app running on a laptop with no database at all.
 */
async function identify(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    req.device = (await deviceFor(readToken(req))) ?? undefined;
  } catch (error) {
    logFailure('device lookup', error);
  }
  next();
}

const readToken = (req: Request): string | undefined => {
  const header = req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
};

/* ------------------------------------------------------------------ *
 * Rate limit — per device where one is known, per IP where it is not.
 *
 * The IP version is the fallback rather than the rule now. Everybody on the
 * same mobile network shares an address, so it could lock out a whole carrier
 * because of one enthusiastic user, and being in memory it forgave everybody
 * whenever the service restarted. A device is the thing worth counting.
 * ------------------------------------------------------------------ */

const hits = new Map<string, { count: number; resetAt: number }>();

/** How much a known device may spend in a day, per kind of call. */
/**
 * The two guards that are not allowances.
 *
 * Sign-ins and reset requests cost nothing to serve and are counted to slow
 * guessing down, so they stay per-device and per-day and have nothing to do
 * with which tier somebody is on.
 */
const GUARD: Record<'signin' | 'reset' | 'invite' | 'verify', number> = {
  // Each one is an email to an address. Five a day is plenty for somebody
  // whose first one went to spam, and not much of a tool for mailing a
  // stranger over and over.
  verify: Number(process.env.SQUISH_DAILY_VERIFY_MAILS ?? 5),
  signin: Number(process.env.SQUISH_DAILY_SIGNINS ?? 20),
  reset: Number(process.env.SQUISH_DAILY_RESETS ?? 5),
  // Low on purpose. A wrong code is a typo, and ten typos is somebody
  // guessing at something worth a year of Plus.
  invite: Number(process.env.SQUISH_DAILY_INVITES ?? 10),
};

const SPENT: Partial<Record<Spend, string>> = {
  signin: 'Too many attempts from this device. Try again tomorrow, or use the forgotten-password link.',
  reset: 'That is enough reset links for one day. Check your inbox, including the spam folder.',
  invite: 'Too many codes tried from this device. Try again tomorrow.',
  verify: 'That is enough confirmation emails for one day. Check your spam folder for the last one.',
};

/**
 * Count this call, and refuse it if the allowance is gone.
 *
 * Billable actions are counted against the month and against the person — see
 * server/plan.ts. The refusal carries the plan and what is left, because the
 * app needs to say something more useful than "no": whether this is a wall you
 * pay to get past, or a wall that moves on the first of the month.
 */
function meter(kind: Spend) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.device) {
      rateLimit(req, res, next);
      return;
    }

    try {
      if (!isBillable(kind)) {
        const limit = GUARD[kind];
        if (limit > 0 && (await spend(req.device.id, kind)) > limit) {
          res.status(429).json({ error: 'rate_limited', message: SPENT[kind] });
          return;
        }
        next();
        return;
      }

      const plan = await planFor(req.device);
      const allowance = allowanceFor(req.device, plan)[kind];

      // Signed out, on the free plan: nothing is spent and nothing is served,
      // but the answer says an account would change that.
      if (allowance === 0 && needsAccount(req.device, plan) && ALLOWANCE.free[kind] > 0) {
        res.status(402).json({
          error: 'out_of_allowance',
          plan,
          kind,
          used: 0,
          allowance: 0,
          period: PERIOD[plan],
          needsAccount: true,
          taste: ALLOWANCE.free[kind],
          resets: null,
          message: `Make a free account and your first ${ALLOWANCE.free[kind]} ${KIND_WORDS[kind]} are on us.`,
        });
        return;
      }

      // Counted first, then compared, so two requests at once cannot both see
      // the last one free.
      await spend(req.device.id, kind);
      const used = await usedFor(req.device, kind, plan);

      if (used <= allowance) {
        // Everything downstream of here runs with somewhere to put its bill.
        billedTo(req.device.id, kind, next);
        return;
      }

      res.status(402).json({
        error: 'out_of_allowance',
        plan,
        kind,
        used,
        allowance,
        period: PERIOD[plan],
        needsAccount: false,
        resets: PERIOD[plan] === 'month' ? nextReset() : null,
        message: OUT_OF[plan][kind],
      });
      return;
    } catch (error) {
      // A metering failure must not stop somebody logging their lunch. It
      // falls back to the address-based limit, which is worse but is not off.
      logFailure('metering', error);
      rateLimit(req, res, next);
    }
  };
}

/**
 * What to say when the allowance is gone.
 *
 * Different sentences for different tiers, because the answer is different. A
 * free user has somewhere to go; somebody already paying does not, and telling
 * them to upgrade would be both useless and insulting.
 */
const KIND_WORDS: Record<Billable, string> = {
  photo: 'AI meal analyses',
  chat: 'questions for the nutritionist',
  recipe: 'recipe imports',
};

const OUT_OF: Record<Plan, Record<Billable, string>> = {
  free: {
    photo: `That was your free taste of the AI. ${PLUS} has ${ALLOWANCE.plus.photo} analyses a month — and logging by hand, food search and your diary stay free.`,
    chat: `The nutritionist is part of ${PLUS}.`,
    recipe: `Recipe imports are part of ${PLUS}.`,
  },
  plus: {
    photo: `That is this month's AI meal analyses. They come back on the 1st — logging by hand and food search are unaffected.`,
    chat: `That is this month's questions for the nutritionist. They come back on the 1st.`,
    recipe: `That is this month's recipe imports. They come back on the 1st.`,
  },
};

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  if (RATE_LIMIT <= 0) {
    next();
    return;
  }
  const now = Date.now();
  const key = req.ip ?? 'unknown';
  const entry = hits.get(key);

  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + HOUR_MS });
    if (hits.size > 5000) {
      for (const [ip, seen] of hits) if (seen.resetAt < now) hits.delete(ip);
    }
    next();
    return;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT) {
    const minutes = Math.ceil((entry.resetAt - now) / 60_000);
    res.status(429).json({
      error: 'rate_limited',
      message: `That is ${RATE_LIMIT} meals in an hour — give it ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    });
    return;
  }
  next();
}

// Render and friends sit behind a proxy; without this every request looks
// like it comes from the same address and the rate limit hits everyone at once.
app.set('trust proxy', 1);

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

/* ---------------- The diary, backed up ---------------- *
 *
 * A backup, never a source of truth. The browser keeps the diary; these two
 * routes keep a copy that survives a cleared browser or a lost phone.
 */

/** Needs a device — an anonymous request has no diary of its own to fetch. */
function requireDevice(req: Request, res: Response, next: NextFunction): void {
  if (!hasDatabase()) {
    res.status(503).json({ error: 'no_database', message: 'This Squish keeps nothing on the server.' });
    return;
  }
  if (!req.device) {
    res.status(401).json({ error: 'no_device', message: 'This browser has not introduced itself yet.' });
    return;
  }
  next();
}

/**
 * Moving this browser to the app's new address. The old address asks for a
 * code; the new one claims it. See startHandoff in server/identity.ts.
 */
app.post('/api/device/handoff', requireDevice, meter('signin'), async (req, res) => {
  try {
    res.json({ code: await startHandoff(req.device!.id) });
  } catch (error) {
    logFailure('handoff', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not do that just now.' });
  }
});

app.post('/api/device/claim', rateLimit, async (req, res) => {
  const { code } = req.body ?? {};
  if (typeof code !== 'string' || code.length > 100) {
    res.status(400).json({ error: 'missing' });
    return;
  }
  try {
    const claimed = await claimHandoff(code);
    if (!claimed) {
      res.status(404).json({ error: 'expired', message: 'That link has already been used, or is too old.' });
      return;
    }
    res.json(claimed);
  } catch (error) {
    logFailure('claim', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not do that just now.' });
  }
});

app.get('/api/diary', requireDevice, async (req, res) => {
  try {
    const found = await readDiary(ownerOf(req.device!));
    res.json(found ?? { state: null, version: 0, updatedAt: null });
  } catch (error) {
    logFailure('diary read', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not fetch your backup just now.' });
  }
});

app.put('/api/diary', requireDevice, async (req, res) => {
  const { state, version } = req.body ?? {};
  if (state === undefined || state === null) {
    res.status(400).json({ error: 'empty', message: 'Nothing to back up.' });
    return;
  }
  // `null` means "I believe there is nothing there yet"; a number means "I
  // last saw this one". Anything else is a client that has lost track, and
  // guessing on its behalf is how somebody's afternoon gets overwritten.
  if (version !== null && !Number.isInteger(version)) {
    res.status(400).json({ error: 'bad_version', message: 'A backup needs to say which version it last saw.' });
    return;
  }

  try {
    const result = await writeDiary(ownerOf(req.device!), state, version);
    if (result.ok) {
      res.json(result);
      return;
    }
    if (result.reason === 'too_big') {
      // 413, not 503. Retrying will not help and saying "try later" would be
      // a lie: this diary will be exactly as large tomorrow.
      res.status(413).json({
        ...result,
        error: 'too_big',
        message: 'This diary is too large to back up.',
      });
      return;
    }
    // 409, and the newer diary with it — the client cannot resolve this
    // without seeing what it is up against.
    res.status(409).json(result);
  } catch (error) {
    logFailure('diary write', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not save your backup just now.' });
  }
});

/**
 * Throw the backup away.
 *
 * Reset on the You screen means reset, and a spare copy sitting on a server
 * after somebody has asked to be forgotten is the opposite of what they
 * asked for. It is also what an app store expects an account to be able to
 * do from inside the app.
 */
app.delete('/api/diary', requireDevice, async (req, res) => {
  try {
    await deleteDiary(ownerOf(req.device!));
    res.json({ deleted: true });
  } catch (error) {
    logFailure('diary delete', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not delete your backup just now.' });
  }
});

/* ---------------- Who is asking ---------------- *
 *
 * Nothing to present on this one. A device that has never been here has no
 * token, and the one it gets back is what it presents from then on.
 */
app.post('/api/device', async (_req, res) => {
  if (!hasDatabase()) {
    // Not an error. It is how Squish runs on a laptop, and the client is
    // written to carry on without one.
    res.status(503).json({ error: 'no_database', message: 'This Squish keeps nothing on the server.' });
    return;
  }
  try {
    res.json(await registerDevice());
  } catch (error) {
    logFailure('device registration', error);
    res.status(503).json({ error: 'no_database', message: 'Could not set this device up just now.' });
  }
});

/**
 * Which tier, and what is left of the month.
 *
 * The app asks for this at startup and after anything that could change it,
 * and it is the only thing that decides what a person is entitled to. There
 * is deliberately no way to tell it otherwise from the browser: a paywall a
 * devtools console defeats funds nothing.
 *
 * Unknown where there is no database, and unknown means free — failing closed
 * on the money, open on the person.
 */
app.get('/api/allowance', async (req, res) => {
  if (!req.device) {
    res.json({ known: false, plan: 'free' });
    return;
  }
  try {
    res.json({
      known: true,
      account: Boolean(req.device.accountId),
      resets: nextReset(),
      // How big the taste an account would unlock is, for the signed-out.
      taste: ALLOWANCE.free.photo,
      // So the app only offers a code box where codes exist.
      invites: await invitesExist(),
      // And only shows the dashboard to somebody who can use it.
      admin: await isAdmin(req.device),
      ...(await standingOf(req.device)),
    });
  } catch (error) {
    logFailure('allowance', error);
    res.json({ known: false, plan: 'free' });
  }
});

/* ---------------- Accounts ---------------- *
 *
 * An account is optional and always will be. The device token underneath it
 * carries a diary perfectly well; an account exists so the diary can follow
 * somebody to a new phone, and be got back after the old one went in the sea.
 *
 * There is no session token. Signing in attaches the account to the device
 * row, and the device token stays the only credential anything presents —
 * it is already long-lived, already a bearer credential, and already holds
 * the whole diary. A second one would only be a second thing to leak.
 */

/** What these routes say back, with nothing in it worth intercepting. */
const whoami = (account: { id: string; email: string } | null) =>
  account ? { signedIn: true as const, email: account.email } : { signedIn: false as const };

app.get('/api/account', requireDevice, async (req, res) => {
  try {
    const id = req.device!.accountId;
    if (!id) {
      res.json(whoami(null));
      return;
    }
    res.json({
      ...whoami(await accountFor(id)),
      otherDevices: await otherDevices(id, req.device!.id),
      verified: await isVerified(id),
      // Nothing about confirming an address is shown where mail cannot be
      // sent — asking somebody to click a link that will never arrive is
      // worse than not asking.
      mailReady: canSendMail(),
    });
  } catch (error) {
    logFailure('account read', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not check that just now.' });
  }
});

app.post('/api/account', requireDevice, meter('signin'), async (req, res) => {
  const { email, password, ref } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'missing', message: 'An address and a password, please.' });
    return;
  }

  try {
    const made = await signUp(req.device!.id, email, password);
    if (made.ok) {
      // Whoever's link they arrived by, if anyone's. Never allowed to fail the
      // sign-up: a stale link is not the new account's problem.
      if (ref !== undefined) {
        await attribute(made.account.id, ref).catch((error: unknown) => logFailure('referral', error));
      }
      // Not awaited into the response, and never allowed to fail it: the
      // account exists either way, and there is a button to send it again.
      if (canSendMail()) {
        void sendVerification(made.account.id, (token) => verifyLink(req, token)).catch((error: unknown) =>
          logFailure('verification email', error),
        );
      }
      res.json({ ...whoami(made.account), broughtDiary: made.broughtDiary, verificationSent: canSendMail() });
      return;
    }
    res.status(409).json({ error: made.reason, message: made.message ?? SIGNUP_TROUBLE[made.reason] });
  } catch (error) {
    logFailure('sign up', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not make that account just now.' });
  }
});

const SIGNUP_TROUBLE: Record<'taken' | 'bad_email' | 'weak_password' | 'breached', string> = {
  breached: 'That password has appeared in a known data breach. Please pick another.',
  taken: 'There is already an account on that address. Try signing in.',
  bad_email: 'That does not look like an email address.',
  weak_password: `A password needs ${MIN_PASSWORD} characters or more. Four words you will remember beats one word with a number on the end.`,
};

app.post('/api/session', requireDevice, meter('signin'), async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'missing', message: 'An address and a password, please.' });
    return;
  }

  try {
    const back = await signIn(req.device!.id, email, password);
    if (back.ok) {
      void noticeSignIn(back.account.id, req.get('user-agent'), publicOrigin(req)).catch((error: unknown) =>
        logFailure('sign-in notice', error),
      );
      res.json({ ...whoami(back.account), broughtDiary: back.broughtDiary });
      return;
    }
    // One message for both a wrong password and an address with no account.
    // Telling them apart is a way of finding out who has an account here.
    res.status(401).json({ error: 'wrong', message: 'That address and password do not go together.' });
  } catch (error) {
    logFailure('sign in', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not sign in just now.' });
  }
});

app.delete('/api/session', requireDevice, async (req, res) => {
  try {
    await signOut(req.device!.id);
    res.json({ signedIn: false });
  } catch (error) {
    logFailure('sign out', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not sign out just now.' });
  }
});

/**
 * Sign every other device out.
 *
 * The password is asked for again because this is a security action, and
 * because a phone somebody left on a train should not be able to lock its
 * owner out of their own account.
 */
app.post('/api/account/devices/forget', requireAccount, meter('signin'), async (req, res) => {
  const { password } = req.body ?? {};
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'missing', message: 'Your password, to be sure it is you.' });
    return;
  }

  try {
    const id = req.device!.accountId!;
    if (!(await verifyPassword(id, password))) {
      res.status(401).json({ error: 'wrong', message: 'That is not your password.' });
      return;
    }
    res.json({ signedOut: await signOutEverywhere(id, req.device!.id) });
  } catch (error) {
    logFailure('sign out everywhere', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not do that just now.' });
  }
});

/** The link in a confirmation email. */
const verifyLink = (req: Request, token: string): string =>
  `${publicOrigin(req)}/verify?token=${encodeURIComponent(token)}`;

/**
 * Send the confirmation link again.
 *
 * Awaited, unlike the one at sign-up, because somebody pressed a button and is
 * waiting to be told whether it went.
 */
app.post('/api/account/verify', requireDevice, meter('verify'), async (req, res) => {
  const id = req.device!.accountId;
  if (!id) {
    res.status(401).json({ error: 'no_account', message: 'Sign in first.' });
    return;
  }
  if (!canSendMail()) {
    res.status(503).json({ error: 'no_mail', message: 'This Squish cannot send email yet.' });
    return;
  }
  try {
    const result = await sendVerification(id, (token) => verifyLink(req, token));
    res.json({ result });
  } catch (error) {
    logFailure('verification email', error);
    res.status(502).json({ error: 'not_sent', message: 'That email did not go. Try again in a few minutes.' });
  }
});

/**
 * Where a confirmation link lands.
 *
 * A page rather than an app route, for the same reason the privacy policy is:
 * somebody tapping a link in their inbox may be on a device with nothing
 * installed and nobody signed in. It confirms on GET, which is usually a
 * mistake and here is deliberate — the worst a mail scanner following it
 * early can do is confirm the address for the inbox it was sent to, which is
 * the whole point of the link.
 */
app.get('/verify', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const done = token ? await confirm(token).catch(() => ({ ok: false as const })) : { ok: false as const };

  const body = done.ok
    ? `<h1>That is confirmed</h1>
<p><strong>${escapeHtml(done.email)}</strong> is yours, as far as Squish is concerned. If anything
important happens on your account — a new sign-in, a changed password — this is where we will tell you.</p>`
    : `<h1>That link has run out</h1>
<p>Confirmation links work for a week. Open Squish, go to <strong>You → Account</strong>, and send
yourself a fresh one.</p>`;

  res
    .status(done.ok ? 200 : 410)
    .type('html')
    .send(standalonePage(body, done.ok ? 'Confirmed — Squish' : 'Link expired — Squish', 'Confirming your email for Squish.'));
});

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Needs an account, not just a device: there is nothing here for a stranger. */
function requireAccount(req: Request, res: Response, next: NextFunction): void {
  requireDevice(req, res, () => {
    if (!req.device?.accountId) {
      res.status(401).json({ error: 'no_account', message: 'Sign in first.' });
      return;
    }
    next();
  });
}

app.post('/api/account/password', requireAccount, meter('signin'), async (req, res) => {
  const { current, next: replacement } = req.body ?? {};
  if (typeof current !== 'string' || typeof replacement !== 'string') {
    res.status(400).json({ error: 'missing', message: 'The old password and the new one, please.' });
    return;
  }

  try {
    const changed = await changePassword(req.device!.accountId!, current, replacement);
    if (changed.ok) {
      // Anybody signed in elsewhere is signed out. Changing a password is
      // what people do when they are worried, and leaving the other sessions
      // alive is the opposite of what they just asked for.
      const cut = await signOutEverywhere(req.device!.accountId!, req.device!.id);
      void noticePasswordChanged(req.device!.accountId!, 'changed', publicOrigin(req)).catch((error: unknown) =>
        logFailure('password notice', error),
      );
      res.json({ changed: true, signedOut: cut });
      return;
    }
    res.status(changed.reason === 'wrong' ? 401 : 400).json({
      error: changed.reason,
      message:
        changed.message ??
        (changed.reason === 'weak_password' ? SIGNUP_TROUBLE.weak_password : 'That is not the current password.'),
    });
  } catch (error) {
    logFailure('password change', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not change that just now.' });
  }
});

/**
 * Delete the account and everything on the server with it.
 *
 * Both app stores require this from inside the app rather than by emailing
 * somebody, and the password is asked for again because a phone somebody left
 * on a train should not be able to do this.
 */
app.delete('/api/account', requireAccount, meter('signin'), async (req, res) => {
  const { password } = req.body ?? {};
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'missing', message: 'Your password, to be sure it is you.' });
    return;
  }

  try {
    const id = req.device!.accountId!;
    // Checked with verifyPassword rather than signIn: signing in also decides
    // what happens to the diary on this device, and moving one onto an account
    // that is about to be deleted would delete it too.
    if (!(await verifyPassword(id, password))) {
      res.status(401).json({ error: 'wrong', message: 'That is not your password.' });
      return;
    }
    await deleteAccount(id);
    res.json({ deleted: true });
  } catch (error) {
    logFailure('account deletion', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not delete that just now.' });
  }
});

/* ---------------- The dashboard ---------------- *
 *
 * Everything here needs an account whose address is in SQUISH_ADMIN_EMAILS.
 * There is no separate admin credential to leak and no way to promote
 * yourself from inside the app — an admin signs in like anybody else, and the
 * list decides whether they also see this.
 *
 * None of it can reach a diary. Counts and totals only; see server/admin.ts.
 */
function adminGate(secondStep: boolean) {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireDevice(req, res, () => {
      void (async () => {
        if (!(await isAdmin(req.device))) {
          // The same answer whether they are signed out, signed in as somebody
          // ordinary, or there are no admins at all. A 403 that distinguishes
          // those is a way of finding out that a dashboard exists.
          res.status(404).json({ error: 'not_found' });
          return;
        }
        if (secondStep && !(await hasPassed(req.device!.accountId!, req.device!.id))) {
          // Past this point they are known to be an admin, so saying why is
          // safe — and the app needs to know whether to ask for a code or to
          // set an authenticator up.
          const state = await stateFor(req.device!.accountId!, req.device!.id);
          res.status(403).json({ error: 'two_factor', enrolled: state.enrolled });
          return;
        }
        next();
      })().catch((error: unknown) => {
        logFailure('admin check', error);
        res.status(503).json({ error: 'unavailable' });
      });
    });
  };
}

/** An admin who has also passed the second step on this device. */
const requireAdmin = adminGate(true);
/** An admin by address, who may not have passed it yet — for the routes that let them. */
const requireAdminIdentity = adminGate(false);

/* ---------------- The dashboard's second step ---------------- */

app.get('/api/admin/2fa', requireAdminIdentity, async (req, res) => {
  try {
    res.json(await stateFor(req.device!.accountId!, req.device!.id));
  } catch (error) {
    logFailure('2fa state', error);
    res.status(503).json({ error: 'unavailable' });
  }
});

app.post('/api/admin/2fa/setup', requireAdminIdentity, async (req, res) => {
  try {
    const setup = await beginSetup(req.device!.accountId!, await adminEmail(req.device!));
    if (!setup) {
      res.status(409).json({ error: 'already_on', message: 'Two-step sign-in is already on for this account.' });
      return;
    }
    res.json(setup);
  } catch (error) {
    logFailure('2fa setup', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not start that just now.' });
  }
});

const TWO_FACTOR_MESSAGE: Record<string, string> = {
  wrong: "That code didn't work. Check it is the one for Squish, and that it hasn't just changed.",
  not_started: 'Start again — that setup has gone.',
  already_on: 'Two-step sign-in is already on.',
  not_on: 'Two-step sign-in is not set up yet.',
};

function refuseCode(res: Response, done: { reason: string; minutes?: number }): void {
  if (done.reason === 'locked') {
    res.status(429).json({
      error: 'locked',
      message: `Too many wrong codes. Try again in ${done.minutes} minute${done.minutes === 1 ? '' : 's'}.`,
    });
    return;
  }
  res.status(400).json({ error: done.reason, message: TWO_FACTOR_MESSAGE[done.reason] ?? 'That did not work.' });
}

app.post('/api/admin/2fa/enable', requireAdminIdentity, meter('signin'), async (req, res) => {
  const { password, code } = req.body ?? {};
  if (typeof password !== 'string' || typeof code !== 'string') {
    res.status(400).json({ error: 'missing', message: 'Your password and a code from the app, please.' });
    return;
  }
  try {
    const accountId = req.device!.accountId!;
    if (!(await verifyPassword(accountId, password))) {
      res.status(400).json({ error: 'wrong_password', message: "That isn't your password." });
      return;
    }
    const done = await finishSetup(accountId, req.device!.id, code);
    if (!done.ok) {
      refuseCode(res, done);
      return;
    }
    await recordAdminAction(await adminEmail(req.device!), 'turn on 2FA', null, null);
    res.json({ recoveryCodes: done.recoveryCodes });
  } catch (error) {
    logFailure('2fa enable', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not do that just now.' });
  }
});

app.post('/api/admin/2fa/verify', requireAdminIdentity, meter('signin'), async (req, res) => {
  const { code } = req.body ?? {};
  if (typeof code !== 'string') {
    res.status(400).json({ error: 'missing', message: 'A code, please.' });
    return;
  }
  try {
    const done = await checkCode(req.device!.accountId!, req.device!.id, code);
    if (!done.ok) {
      refuseCode(res, done);
      return;
    }
    if (done.usedRecovery) {
      await recordAdminAction(await adminEmail(req.device!), 'use recovery code', null, `${done.recoveryLeft} left`);
    }
    res.json({ passed: true, usedRecovery: done.usedRecovery, recoveryLeft: done.recoveryLeft });
  } catch (error) {
    logFailure('2fa verify', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not check that just now.' });
  }
});

/** New recovery codes, for somebody inside the dashboard who can also give the password. */
app.post('/api/admin/2fa/recovery', requireAdmin, meter('signin'), async (req, res) => {
  const { password } = req.body ?? {};
  try {
    if (typeof password !== 'string' || !(await verifyPassword(req.device!.accountId!, password))) {
      res.status(400).json({ error: 'wrong_password', message: "That isn't your password." });
      return;
    }
    const recoveryCodes = await replaceRecoveryCodes(req.device!.accountId!);
    await recordAdminAction(await adminEmail(req.device!), 'new recovery codes', null, null);
    res.json({ recoveryCodes });
  } catch (error) {
    logFailure('2fa recovery', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not do that just now.' });
  }
});

app.post('/api/admin/2fa/lock', requireAdminIdentity, async (req, res) => {
  try {
    await endSession(req.device!.id);
    res.json({ locked: true });
  } catch (error) {
    logFailure('2fa lock', error);
    res.status(503).json({ error: 'unavailable' });
  }
});

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  try {
    res.json({
      ...(await overview()),
      allowances: allowances(),
      invites: await listInvites(),
      suggestion: suggestCode(),
      mailReady: mailReady(),
    });
  } catch (error) {
    logFailure('admin overview', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not read that just now.' });
  }
});

app.post('/api/admin/test-mail', requireAdmin, async (req, res) => {
  if (!mailReady()) {
    res.status(503).json({ error: 'no_mail', message: 'SQUISH_MAIL_WEBHOOK is not set, so there is nothing to test yet.' });
    return;
  }
  const to = await adminEmail(req.device!);
  try {
    await sendTestMail(to, publicOrigin(req));
    res.json({ sent: true, to });
  } catch (error) {
    logFailure('test email', error);
    // The provider's own words, because they are the useful part.
    res.status(502).json({ error: 'not_sent', message: error instanceof Error ? error.message : 'It did not send.' });
  }
});

/* ---------------- Email wording ---------------- *
 *
 * Every email's subject, body and button, editable here. The default always
 * survives in the code, so "put back the original" is deleting a row.
 */

/** A proposed wording from a request body, or null where it is not one. */
function wordingFrom(body: unknown): Wording | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.subject !== 'string' || typeof b.body !== 'string') return null;
  return { subject: b.subject, body: b.body, buttonLabel: typeof b.buttonLabel === 'string' ? b.buttonLabel : null };
}

app.get('/api/admin/emails', requireAdmin, async (_req, res) => {
  try {
    res.json({ emails: await listWording() });
  } catch (error) {
    logFailure('admin emails', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not read those just now.' });
  }
});

/**
 * What a wording would look like, filled in with sample values — for the
 * editor to show as somebody types, without saving anything.
 */
app.post('/api/admin/emails/:key/preview', requireAdmin, (req, res) => {
  const key = String(req.params.key);
  const wording = wordingFrom(req.body);
  if (!isEmailKey(key) || !wording) {
    res.status(400).json({ error: 'missing' });
    return;
  }
  const definition = EMAILS[key];
  res.json({
    problems: problemsWith(definition, wording),
    ...renderEmail(definition, wording, samplesFor(definition), publicOrigin(req)),
  });
});

app.put('/api/admin/emails/:key', requireAdmin, async (req, res) => {
  const key = String(req.params.key);
  const wording = wordingFrom(req.body);
  if (!isEmailKey(key) || !wording) {
    res.status(400).json({ error: 'missing', message: 'A subject and a body, please.' });
    return;
  }
  try {
    const problems = await saveWording(key, wording, await adminEmail(req.device!));
    if (problems.length) {
      res.status(400).json({ error: 'problems', problems, message: problems[0] });
      return;
    }
    res.json({ saved: true });
  } catch (error) {
    logFailure('admin email save', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not save that just now.' });
  }
});

app.delete('/api/admin/emails/:key', requireAdmin, async (req, res) => {
  const key = String(req.params.key);
  if (!isEmailKey(key)) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  try {
    await resetWording(key, await adminEmail(req.device!));
    res.json({ reset: true });
  } catch (error) {
    logFailure('admin email reset', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not do that just now.' });
  }
});

/**
 * Send the admin one copy of a wording — the unsaved draft, if that is what
 * is in the editor — so it can be seen in a real inbox before anybody else
 * gets it.
 */
app.post('/api/admin/emails/:key/test', requireAdmin, async (req, res) => {
  const key = String(req.params.key);
  const wording = wordingFrom(req.body);
  if (!isEmailKey(key) || !wording) {
    res.status(400).json({ error: 'missing' });
    return;
  }
  if (!mailReady()) {
    res.status(503).json({ error: 'no_mail', message: 'Email is not set up yet, so there is nothing to send with.' });
    return;
  }
  const definition = EMAILS[key];
  const problems = problemsWith(definition, wording);
  if (problems.length) {
    res.status(400).json({ error: 'problems', problems, message: problems[0] });
    return;
  }
  const to = await adminEmail(req.device!);
  try {
    const rendered = renderEmail(definition, wording, samplesFor(definition), publicOrigin(req));
    await sendMail({ to, ...rendered, subject: `[Test] ${rendered.subject}` });
    res.json({ sent: true, to });
  } catch (error) {
    logFailure('admin email test', error);
    res.status(502).json({ error: 'not_sent', message: error instanceof Error ? error.message : 'It did not send.' });
  }
});

app.get('/api/admin/people', requireAdmin, async (req, res) => {
  try {
    const search = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({ people: await people(search), actions: await actions() });
  } catch (error) {
    logFailure('admin people', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not read that just now.' });
  }
});

app.post('/api/admin/plan', requireAdmin, async (req, res) => {
  const { email, days } = req.body ?? {};
  if (typeof email !== 'string' || typeof days !== 'number' || !Number.isFinite(days)) {
    res.status(400).json({ error: 'missing', message: 'An address and a number of days, please.' });
    return;
  }
  if (days > 3650) {
    res.status(400).json({ error: 'too_long', message: 'Ten years is not a grant, it is a mistake.' });
    return;
  }

  try {
    const done = await setPlan(await adminEmail(req.device!), email, days);
    if (done.ok) {
      res.json(done);
      return;
    }
    res.status(404).json({ error: 'no_account', message: 'No account on that address.' });
  } catch (error) {
    logFailure('admin plan', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not change that just now.' });
  }
});

app.get('/api/admin/invites', requireAdmin, async (_req, res) => {
  try {
    res.json({ invites: await listInvites(), redemptions: await redemptions(), suggestion: suggestCode() });
  } catch (error) {
    logFailure('admin invites', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not read those just now.' });
  }
});

app.post('/api/admin/invites', requireAdmin, async (req, res) => {
  const { code, days, uses, note } = req.body ?? {};
  if (typeof code !== 'string' || typeof days !== 'number') {
    res.status(400).json({ error: 'missing', message: 'A code and a number of days, please.' });
    return;
  }

  try {
    const made = await createInvite(await adminEmail(req.device!), {
      code,
      days,
      uses: typeof uses === 'number' && uses > 0 ? uses : null,
      note: typeof note === 'string' ? note : null,
    });
    if (made.ok) {
      res.json(made.invite);
      return;
    }
    const WHY = {
      taken: 'There is already a code with that name.',
      bad_code: 'Codes are 8 to 64 characters, letters, digits and dashes.',
      bad_days: 'Between one day and ten years.',
    };
    res.status(409).json({ error: made.reason, message: WHY[made.reason] });
  } catch (error) {
    logFailure('admin invite create', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not make that just now.' });
  }
});

app.patch('/api/admin/invites/:code', requireAdmin, async (req, res) => {
  const code = String(req.params.code);
  const { disabled } = req.body ?? {};
  if (typeof disabled !== 'boolean') {
    res.status(400).json({ error: 'missing', message: 'On or off?' });
    return;
  }
  try {
    const found = await setInviteDisabled(code, disabled);
    res.status(found ? 200 : 404).json(found ? { code, disabled } : { error: 'not_found' });
  } catch (error) {
    logFailure('admin invite update', error);
    res.status(503).json({ error: 'unavailable' });
  }
});

app.delete('/api/admin/invites/:code', requireAdmin, async (req, res) => {
  try {
    const gone = await deleteInvite(String(req.params.code));
    res.status(gone ? 200 : 404).json(gone ? { deleted: true } : { error: 'not_found' });
  } catch (error) {
    logFailure('admin invite delete', error);
    res.status(503).json({ error: 'unavailable' });
  }
});

/* ---------------- Trends, money and affiliates ---------------- */

app.get('/api/admin/metrics', requireAdmin, async (req, res) => {
  try {
    const days = Number(req.query.days ?? 30);
    res.json(await metrics(Number.isFinite(days) ? days : 30));
  } catch (error) {
    logFailure('admin metrics', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not read that just now.' });
  }
});

app.get('/api/admin/finance', requireAdmin, async (req, res) => {
  const month = req.query.month === undefined ? thisMonth() : req.query.month;
  if (!isMonth(month)) {
    res.status(400).json({ error: 'bad_month', message: 'A month, as 2026-09.' });
    return;
  }
  try {
    res.json(await finance(month));
  } catch (error) {
    logFailure('admin finance', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not read that just now.' });
  }
});

app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
  try {
    res.json(await readSettings());
  } catch (error) {
    logFailure('admin settings', error);
    res.status(503).json({ error: 'unavailable' });
  }
});

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const saved = await saveSettings(req.body ?? {});
    if (!saved.ok) {
      res.status(400).json({ error: 'bad_setting', message: saved.message });
      return;
    }
    await recordAdminAction(await adminEmail(req.device!), 'change money settings', null, JSON.stringify(req.body ?? {}).slice(0, 200));
    res.json(saved.settings);
  } catch (error) {
    logFailure('admin settings save', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not save that just now.' });
  }
});

const costId = (raw: unknown): number | null => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

app.post('/api/admin/fixed-costs', requireAdmin, async (req, res) => {
  const cost = checkCost(req.body ?? {});
  if (typeof cost === 'string') {
    res.status(400).json({ error: 'bad_cost', message: cost });
    return;
  }
  try {
    await addCost(cost);
    await recordAdminAction(await adminEmail(req.device!), 'add a cost', cost.label, `${cost.amount} ${cost.currency} a ${cost.period}`);
    res.json({ saved: true });
  } catch (error) {
    logFailure('admin cost add', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not save that just now.' });
  }
});

app.patch('/api/admin/fixed-costs/:id', requireAdmin, async (req, res) => {
  const id = costId(req.params.id);
  const cost = checkCost(req.body ?? {});
  if (id === null || typeof cost === 'string') {
    res.status(400).json({ error: 'bad_cost', message: typeof cost === 'string' ? cost : 'Which cost?' });
    return;
  }
  try {
    const found = await updateCost(id, cost);
    if (found) {
      await recordAdminAction(await adminEmail(req.device!), 'change a cost', cost.label, `${cost.amount} ${cost.currency} a ${cost.period}${cost.active === false ? ', off' : ''}`);
    }
    res.status(found ? 200 : 404).json(found ? { saved: true } : { error: 'not_found' });
  } catch (error) {
    logFailure('admin cost update', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not save that just now.' });
  }
});

app.delete('/api/admin/fixed-costs/:id', requireAdmin, async (req, res) => {
  const id = costId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: 'bad_cost' });
    return;
  }
  try {
    await removeCost(id);
    await recordAdminAction(await adminEmail(req.device!), 'remove a cost', String(id), null);
    res.json({ deleted: true });
  } catch (error) {
    logFailure('admin cost delete', error);
    res.status(503).json({ error: 'unavailable' });
  }
});

/** The link an affiliate hands out: on the website's address where there is one. */
const referralBase = (req: Request): string => {
  const site = process.env.SQUISH_SITE_ORIGIN?.trim();
  return `${(site || publicOrigin(req)).replace(/\/$/, '')}/r/`;
};

app.get('/api/admin/affiliates', requireAdmin, async (req, res) => {
  try {
    res.json({ affiliates: await listAffiliates(), payouts: await payouts(), linkBase: referralBase(req) });
  } catch (error) {
    logFailure('admin affiliates', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not read those just now.' });
  }
});

app.post('/api/admin/affiliates', requireAdmin, async (req, res) => {
  const input = checkAffiliate(req.body ?? {});
  if (typeof input === 'string') {
    res.status(400).json({ error: 'bad_affiliate', message: input });
    return;
  }
  try {
    if (await emailTaken(input.email)) {
      res.status(409).json({ error: 'taken', message: 'Another partner already has that email address — each one signs in to one page.' });
      return;
    }
    const made = await createAffiliate(input);
    if (!made.ok) {
      res.status(409).json({ error: 'taken', message: made.message });
      return;
    }
    await recordAdminAction(await adminEmail(req.device!), 'add an affiliate', input.code, `${Math.round(input.rate * 100)}% for ${input.months} months`);
    res.json({ id: made.id });
  } catch (error) {
    logFailure('admin affiliate create', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not save that just now.' });
  }
});

app.patch('/api/admin/affiliates/:id', requireAdmin, async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const changes: Parameters<typeof updateAffiliate>[1] = {};
  if (typeof body.active === 'boolean') changes.active = body.active;
  if (body.name !== undefined || body.rate !== undefined || body.months !== undefined) {
    // Checked as a whole, with a stand-in code: the code itself never changes.
    const input = checkAffiliate({ ...body, code: 'KEEP' });
    if (typeof input === 'string') {
      res.status(400).json({ error: 'bad_affiliate', message: input });
      return;
    }
    Object.assign(changes, { name: input.name, rate: input.rate, months: input.months, email: input.email, note: input.note });
  }
  try {
    const id = String(req.params.id);
    if ('email' in changes && (await emailTaken(changes.email ?? null, id))) {
      res.status(409).json({ error: 'taken', message: 'Another partner already has that email address — each one signs in to one page.' });
      return;
    }
    const before = (await listAffiliates(id))[0];
    const found = await updateAffiliate(id, changes);
    // A new address is a new person as far as their page is concerned:
    // whoever was signed in with the old one is signed out.
    if (found && before && 'email' in changes && (before.email ?? '').toLowerCase() !== (changes.email ?? '').toLowerCase()) {
      await endPartnerSessions(id);
    }
    if (found) {
      await recordAdminAction(
        await adminEmail(req.device!),
        changes.active === false ? 'switch off an affiliate' : changes.active === true ? 'switch on an affiliate' : 'change an affiliate',
        String(req.params.id),
        null,
      );
    }
    res.status(found ? 200 : 404).json(found ? { saved: true } : { error: 'not_found' });
  } catch (error) {
    logFailure('admin affiliate update', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not save that just now.' });
  }
});

app.post('/api/admin/affiliates/:id/payouts', requireAdmin, async (req, res) => {
  const { pounds, note } = req.body ?? {};
  const pence = Math.round(Number(pounds) * 100);
  if (!Number.isFinite(pence) || pence <= 0 || pence > 10_000_000) {
    res.status(400).json({ error: 'bad_amount', message: 'How much was paid, in pounds?' });
    return;
  }
  try {
    const admin = await adminEmail(req.device!);
    const done = await recordPayout(String(req.params.id), pence, typeof note === 'string' && note.trim() ? note.trim().slice(0, 200) : null, admin);
    if (done) await recordAdminAction(admin, 'record a payout', String(req.params.id), `£${(pence / 100).toFixed(2)}`);
    res.status(done ? 200 : 404).json(done ? { saved: true } : { error: 'not_found' });
  } catch (error) {
    logFailure('admin payout', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not save that just now.' });
  }
});

/** Where a partner's sign-in link points: their page, with the token in the fragment so it never reaches a log. */
const partnerLink = (req: Request) => (token: string) => `${publicOrigin(req)}/partners#token=${token}`;

app.post('/api/admin/affiliates/:id/portal-link', requireAdmin, async (req, res) => {
  const send = req.body?.send === true;
  try {
    const done = await handPartnerLink(String(req.params.id), partnerLink(req), send);
    if (!done.ok) {
      const WHY = {
        not_found: 'No such partner.',
        no_email: 'They have no email address yet — add one with Edit, or copy the link instead.',
        no_mail: 'Email is not set up, so copy the link and send it yourself.',
      };
      res.status(done.reason === 'not_found' ? 404 : 409).json({ error: done.reason, message: WHY[done.reason] });
      return;
    }
    await recordAdminAction(await adminEmail(req.device!), send ? 'email a partner sign-in link' : 'copy a partner sign-in link', String(req.params.id), null);
    res.json(done);
  } catch (error) {
    logFailure('partner link', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not make a link just now.' });
  }
});

/* ------------------------------------------------------------------ *
 * The partner page — affiliates' own sign-in and figures. See server/partners.ts
 * ------------------------------------------------------------------ */

/** A few tries an hour per address: enough for a typo, too few to guess a link or flood an inbox. */
const partnerTries = new Map<string, { count: number; resetAt: number }>();
function partnerLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const key = req.ip ?? 'unknown';
  const entry = partnerTries.get(key);
  if (!entry || entry.resetAt < now) {
    partnerTries.set(key, { count: 1, resetAt: now + HOUR_MS });
    if (partnerTries.size > 5000) for (const [ip, seen] of partnerTries) if (seen.resetAt < now) partnerTries.delete(ip);
    next();
    return;
  }
  entry.count += 1;
  if (entry.count > 20) {
    res.status(429).json({ error: 'rate_limited', message: 'That is a lot of tries. Give it an hour.' });
    return;
  }
  next();
}

const partnerSession = (req: Request): string | undefined => {
  const header = req.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
};

app.post('/api/partner/link', partnerLimit, async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'missing', message: 'Your email address, please.' });
    return;
  }
  if (!hasDatabase()) {
    res.status(503).json({ error: 'unavailable', message: 'Partner pages are not available here.' });
    return;
  }
  try {
    await requestPartnerLink(email, partnerLink(req));
  } catch (error) {
    // Said the same way as success: whether it failed is not a clue to whether the address is a partner's.
    logFailure('partner link request', error);
  }
  res.json({ sent: true, mail: canSendMail() });
});

app.post('/api/partner/claim', partnerLimit, async (req, res) => {
  try {
    const session = await claimPartnerLink(req.body?.token);
    if (!session) {
      res.status(401).json({ error: 'bad_link', message: 'That link has been used or has run out. Ask for a new one below.' });
      return;
    }
    res.json({ session });
  } catch (error) {
    logFailure('partner claim', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not sign you in just now.' });
  }
});

app.get('/api/partner/me', async (req, res) => {
  try {
    const id = await partnerFor(partnerSession(req));
    const view = id ? await partnerView(id) : null;
    if (!view) {
      res.status(401).json({ error: 'signed_out' });
      return;
    }
    res.set('Cache-Control', 'no-store').json({ ...view, link: `${referralBase(req)}${view.code}` });
  } catch (error) {
    logFailure('partner page', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not load your figures just now.' });
  }
});

app.post('/api/partner/signout', async (req, res) => {
  try {
    await endPartnerSession(partnerSession(req));
  } catch (error) {
    logFailure('partner sign-out', error);
  }
  res.json({ signedOut: true });
});

/**
 * Redeem an invite code.
 *
 * Needs an account, because that is where Plus lives — a subscription in a
 * browser evaporates when somebody clears it, which is a refund request and a
 * one-star review. Counted per device so a code cannot be guessed at.
 */
app.post('/api/invite', requireAccount, meter('invite'), async (req, res) => {
  const { code } = req.body ?? {};
  if (typeof code !== 'string' || !code.trim()) {
    res.status(400).json({ error: 'missing', message: 'Which code?' });
    return;
  }

  try {
    const done = await redeem(req.device!.accountId!, code);
    if (done.ok) {
      res.json({ redeemed: true, days: done.days, until: done.until });
      return;
    }
    const WHY: Record<typeof done.reason, string> = {
      already: 'You have already used that code.',
      spent: 'That code has been used as many times as it can be.',
      unknown: 'That code is not one of ours. Check it and try again.',
    };
    res.status(done.reason === 'already' ? 409 : done.reason === 'spent' ? 410 : 404).json({
      error: done.reason,
      message: WHY[done.reason],
    });
  } catch (error) {
    logFailure('invite', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not check that just now.' });
  }
});

/**
 * Forgotten passwords.
 *
 * Always answers the same way. An endpoint that says "no such account" is a
 * tool for finding out who has one.
 */
app.post('/api/account/reset', requireDevice, meter('reset'), async (req, res) => {
  const { email } = req.body ?? {};
  if (typeof email !== 'string') {
    res.status(400).json({ error: 'missing', message: 'Which address?' });
    return;
  }

  try {
    await requestReset(email, (token) => `${publicOrigin(req)}/reset?token=${encodeURIComponent(token)}`);
  } catch (error) {
    // Logged, not reported. The answer is the same either way, and a failure
    // that only happens for addresses that exist is itself a leak.
    logFailure('reset request', error);
  }
  res.json({ sent: true });
});

app.post('/api/account/reset/confirm', requireDevice, meter('reset'), async (req, res) => {
  const { token, password } = req.body ?? {};
  if (typeof token !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'missing', message: 'The link and a new password, please.' });
    return;
  }

  try {
    const done = await completeReset(token, password);
    if (done.ok) {
      void noticePasswordChanged(done.accountId, 'reset', publicOrigin(req)).catch((error: unknown) =>
        logFailure('password notice', error),
      );
      res.json({ changed: true });
      return;
    }
    res.status(done.reason === 'bad_token' ? 410 : 400).json({
      error: done.reason,
      message:
        done.message ??
        (done.reason === 'weak_password'
          ? SIGNUP_TROUBLE.weak_password
          : 'That link has been used or has run out. Ask for another.'),
    });
  } catch (error) {
    logFailure('reset', error);
    res.status(503).json({ error: 'unavailable', message: 'Could not do that just now.' });
  }
});

/**
 * Where this Squish lives, for a link somebody will click in an email.
 *
 * Taken from the request rather than configured, so it is right on a laptop,
 * on Render and on a preview deploy without anybody setting anything — unless
 * SQUISH_PUBLIC_ORIGIN says otherwise, which it should where a proxy makes the
 * request look like it arrived somewhere else.
 */
function publicOrigin(req?: Request): string {
  const configured = process.env.SQUISH_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, '');
  return req ? `${req.protocol}://${req.get('host') ?? 'localhost'}` : 'https://app.squish.online';
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    ai: hasCredentials(),
    model: process.env.SQUISH_MODEL ?? 'claude-opus-5',
    // So the app knows whether to bother asking for a device, a backup or an
    // account. Without a database none of those exist and it stays local.
    accounts: hasDatabase(),
  });
});


/** A number from a request body, or nothing. */
const inRange = (value: unknown, min: number, max: number): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined;
};

/** Vision analysis of a photo. Body: { image: dataURL | base64, mediaType?, slot?, hint?, mode?, crockery? } */
app.post('/api/analyse/photo', meter('photo'), async (req, res) => {
  const { image, mediaType, slot, hint, mode, crockery } = req.body ?? {};
  if (typeof image !== 'string' || image.length < 32) {
    res.status(400).json({ error: 'An image is required.' });
    return;
  }

  const match = image.match(/^data:([^;]+);base64,(.*)$/);
  const data = match ? match[2] : image;
  const type = match ? match[1] : typeof mediaType === 'string' ? mediaType : 'image/jpeg';
  const mealSlot = asSlot(slot);

  const label = mode === 'label';

  if (!hasCredentials()) {
    // A made-up plate is a passable demo; made-up figures off a packet are a lie.
    if (label) {
      res.status(503).json({ error: 'Squish is offline, so a label cannot be read. Search for it or add it by hand.' });
      return;
    }
    res.json(demoEstimateFromPhoto(data.slice(0, 256), mealSlot));
    return;
  }

  try {
    res.json(
      label
        ? await analyseLabel(data, type, mealSlot)
        : await analysePhoto(data, type, mealSlot, typeof hint === 'string' ? hint : undefined, {
            // Sizes, not free text: this goes straight into a prompt.
            plateCm: inRange(crockery?.plateCm, 15, 40),
            bowlMl: inRange(crockery?.bowlMl, 150, 1500),
          }),
    );
  } catch (error) {
    logFailure('photo analysis', error);
    res.json(demoEstimateFromPhoto(data.slice(0, 256), mealSlot));
  }
});

/** Natural-language analysis. Body: { description, slot? } */
app.post('/api/analyse/text', meter('photo'), async (req, res) => {
  const { description, slot } = req.body ?? {};
  if (typeof description !== 'string' || !description.trim()) {
    res.status(400).json({ error: 'A description is required.' });
    return;
  }
  const mealSlot = asSlot(slot);

  if (!hasCredentials()) {
    res.json(estimateFromText(description, mealSlot));
    return;
  }

  try {
    res.json(await analyseText(description.trim(), mealSlot));
  } catch (error) {
    logFailure('text analysis', error);
    res.json(estimateFromText(description, mealSlot));
  }
});

/** Look a barcode up in Open Food Facts. */
app.get('/api/barcode/:code', async (req, res) => {
  try {
    // Express 5 types a route param as possibly repeated; the validator in
    // lookupBarcode rejects anything that is not plain digits regardless.
    const code = Array.isArray(req.params.code) ? req.params.code[0] : req.params.code;
    const slot = Array.isArray(req.query.slot) ? req.query.slot[0] : req.query.slot;
    res.json(await lookupBarcode(String(code), asSlot(slot)));
  } catch (error) {
    if (error instanceof BarcodeError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    logFailure('barcode lookup', error);
    res.status(502).json({ error: 'The food database is having a moment. Try again shortly.' });
  }
});

/**
 * Ask Squish a question. Body: { turns, context }
 *
 * Rate limited like the analysis endpoints, because a chat box is the easiest
 * thing in the app to leave running up a bill.
 */
app.post('/api/chat', meter('chat'), async (req, res) => {
  const { turns, context, notes } = req.body ?? {};

  const messages = cleanMessages(turns);
  if (!messages) {
    res.status(400).json({ error: 'Ask me something.' });
    return;
  }
  if (!hasCredentials()) {
    res.status(503).json({ error: 'Squish needs the AI to answer questions, and no key is configured here.' });
    return;
  }

  try {
    const step = await chatStep(
      messages,
      {
        // A date the browser did not send is today here, which is near enough
        // and far better than leaving it to be guessed at.
        date: /^\d{4}-\d{2}-\d{2}$/.test(String(context?.date)) ? String(context.date) : new Date().toISOString().slice(0, 10),
        goal: String(context?.goal ?? 'maintain'),
        calorieTarget: Number(context?.calorieTarget) || 2000,
        proteinTarget: Number(context?.proteinTarget) || 100,
        today: String(context?.today ?? 'nothing logged'),
        week: String(context?.week ?? 'nothing logged'),
        streak: Number(context?.streak) || 0,
        recentMeals: Array.isArray(context?.recentMeals)
          ? context.recentMeals.slice(0, 12).map((m: unknown) => String(m).slice(0, 80))
          : [],
      },
      cleanNotes(notes),
    );
    logUsage(step.usage, toolRounds(messages));

    // The browser has no use for the bill, so it does not travel.
    const { usage: _usage, ...wire } = step;
    res.json(wire);
  } catch (error) {
    logFailure('chat', error);
    res.status(502).json({ error: 'I could not think of an answer just then. Try again in a moment.' });
  }
});

/**
 * Import a recipe from a web page. Body: { url, slot }
 *
 * Unlike the other endpoints this one has no offline fallback: the estimator
 * can guess at "chicken salad" but it cannot read a web page, and returning an
 * invented recipe would be worse than saying no.
 */
app.post('/api/recipe', meter('recipe'), async (req, res) => {
  const { url, slot } = req.body ?? {};

  if (typeof url !== 'string' || !url.trim()) {
    res.status(400).json({ error: 'Paste the address of a recipe page.' });
    return;
  }
  if (!hasCredentials()) {
    res.status(503).json({ error: 'Reading a recipe needs the AI, and no key is configured on this server.' });
    return;
  }

  try {
    const source = await readRecipePage(url);
    res.json(await analyseRecipe(source, asSlot(slot)));
  } catch (error) {
    if (error instanceof FetchGuardError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    logFailure('recipe import', error);
    res.status(502).json({ error: 'That recipe could not be read. Try another page.' });
  }
});

/** Correct an analysis in words. Body: { analysis, instruction, slot } */
app.post('/api/analyse/refine', meter('photo'), async (req, res) => {
  const { analysis, instruction, slot } = req.body ?? {};

  if (typeof instruction !== 'string' || !instruction.trim()) {
    res.status(400).json({ error: 'Tell me what to change.' });
    return;
  }
  if (!analysis || !Array.isArray(analysis.items)) {
    res.status(400).json({ error: 'There is no meal to correct.' });
    return;
  }
  // Without a key there is nothing to re-read the meal with, and silently
  // handing back the same analysis would look like the correction was ignored.
  if (!hasCredentials()) {
    res.status(503).json({ error: 'Squish is offline, so this one needs editing by hand.' });
    return;
  }

  try {
    res.json(await refineAnalysis(analysis as AnalysisResult, instruction.trim(), asSlot(slot)));
  } catch (error) {
    logFailure('refinement', error);
    res.status(502).json({ error: 'I could not work that out — try editing it by hand.' });
  }
});

/** Daily coach nudge. Body: CoachContext */
app.post('/api/coach', async (req, res) => {
  const ctx = req.body as CoachContext;
  if (!hasCredentials()) {
    res.json({ message: null, offline: true });
    return;
  }
  try {
    res.json({ message: await coachMessage(ctx) });
  } catch (error) {
    logFailure('coach message', error);
    res.json({ message: null, offline: true });
  }
});

/* ------------------------------------------------------------------ *
 * The website, where SQUISH_SITE_ORIGIN says there is one — see server/site.ts
 * ------------------------------------------------------------------ */

/**
 * An affiliate's link: squish.online/r/CODE, on either address. Counts the
 * visit and sends them to the app with the code, which the app keeps for 30
 * days and hands over if they make an account. Answered the same way whether
 * or not the code is real, so the link cannot be used to find out which are.
 */
app.get('/r/:code', (req, res) => {
  const code = tidyCode(String(req.params.code));
  void noteClick(code).catch(() => {});
  const ok = /^[A-Z0-9-]{3,24}$/.test(code);
  res.set('Cache-Control', 'no-store').redirect(302, `${publicOrigin(req)}/${ok ? `?ref=${encodeURIComponent(code)}` : ''}`);
});

app.use(siteRouter(() => publicOrigin(), DIST));

/**
 * The privacy policy.
 *
 * Deliberately outside everything: no device, no app shell, no JavaScript. Both stores need a URL that opens the policy for somebody who
 * has installed nothing, and a policy you need a password to read is not a
 * published policy.
 *
 * Registered before the static handler so it wins over the app's catch-all.
 */
app.get('/privacy', async (_req, res) => {
  const html = await privacyPage();
  if (!html) {
    logFailure('privacy policy', new Error(`could not read docs/privacy.md from ${process.cwd()}`));
    res.status(404).type('text/plain').send('The privacy policy is missing from this deployment.');
    return;
  }
  res.type('html').send(html);
});

/* ------------------------------------------------------------------ *
 * The built app, when there is one (production)
 * ------------------------------------------------------------------ */

if (SERVE_APP) {
  app.use(express.static(DIST, { maxAge: '1h', index: false }));
  // Anything that is not an API route is a client route: hand back index.html
  // and let the app work out which screen that is.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(resolve(DIST, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`🫧  Squish on http://localhost:${PORT}`);
  const source = credentialSource();
  console.log(
    hasCredentials()
      ? `    Claude vision enabled (${process.env.SQUISH_MODEL ?? 'claude-opus-5'}, via ${source})`
      : '    No Anthropic credentials found — serving offline estimates.',
  );
  if (!hasCredentials()) {
    console.log('    To enable photo analysis: set ANTHROPIC_API_KEY and restart.');
  }
  console.log(
    hasDatabase()
      ? `    Free: a taste of ${ALLOWANCE.free.photo} analyses, once · ${PLUS}: ${ALLOWANCE.plus.photo} a month, ${ALLOWANCE.plus.chat} questions`
      : `    No database — no tiers, no accounts, and nothing counted. Everything is open.`,
  );
  console.log(SERVE_APP ? '    Serving the built app from dist/' : '    API only (run Vite for the app).');

  // Reminders are the phone's job now — scheduled on the device by the app,
  // with nothing here that has to be awake at breakfast to deliver them.
});
