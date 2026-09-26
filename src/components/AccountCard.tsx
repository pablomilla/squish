/**
 * The account, on the You screen.
 *
 * Everything here is optional and the card says so first. Squish works with no
 * account, has always worked with no account, and most people will never want
 * one — so this leads with what an account is for rather than with a form.
 * The two reasons are concrete: a new phone, and a lost one.
 *
 * One card rather than a screen, because an account is a thing you set up once
 * and then never look at. Anything that needs a form gets a sheet, and the
 * sheet closes.
 */
import { useEffect, useRef, useState } from 'react';
import { friendOffer, periodWords, type FriendOffer } from '../lib/friends';
import { Sheet, useToast } from './ui';
import PasswordField from './PasswordField';
import {
  changePassword,
  deleteAccount,
  requestReset,
  signIn,
  signOut,
  signOutEverywhere,
  signUp,
  resendVerification,
  whoAmI,
  onAccountAsked,
  type Arrived,
  type Who,
} from '../lib/account';
import { planNow } from '../lib/plan';
import './account-card.css';
import { plural, t } from '../lib/i18n';
import { rich } from '../lib/i18n-react';

type Form = 'in' | 'up' | 'forgot' | 'password' | 'devices' | 'delete' | null;

const TITLES: Record<Exclude<Form, null>, string> = {
  in: t('Sign in'),
  up: t('Create an account'),
  forgot: t('Forgotten password'),
  password: t('Change your password'),
  devices: t('Sign out your other devices'),
  delete: t('Delete your account'),
};

export default function AccountCard({ enabled }: { enabled: boolean }) {
  const [who, setWho] = useState<Who>({ signedIn: false });
  const [form, setForm] = useState<Form>(null);
  const [offer, setOffer] = useState<FriendOffer | null>(null);
  /** The last answer from the server, to notice the moment an address becomes confirmed. */
  const seen = useRef<Who | null>(null);
  const toast = useToast();

  // Came by a friend's invite: say what making an account gets them.
  useEffect(() => {
    if (!enabled || who.signedIn) return;
    let live = true;
    void friendOffer().then((found) => live && setOffer(found));
    return () => {
      live = false;
    };
  }, [enabled, who.signedIn]);

  // Sent here by the paywall to make an account: open the form and bring it into view.
  useEffect(() => {
    if (!enabled) return;
    return onAccountAsked(() => {
      setForm('up');
      document.querySelector('.account-card')?.scrollIntoView({ block: 'center' });
    });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const look = () =>
      void whoAmI().then((found) => {
        if (!live) return;
        const before = seen.current;
        // Confirmed in another tab, or in the email app's browser, while this one waited.
        if (before?.signedIn && before.verified === false && found.verified === true) toast(t('Email confirmed. Thank you!'), '✅');
        seen.current = found;
        setWho(found);
      });
    look();
    // Asked again whenever Squish comes back into view: the confirmation link
    // opens somewhere else, and this card should not go on asking for
    // something that has already been done.
    const onShow = () => {
      if (document.visibilityState === 'visible') look();
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, [enabled, toast]);

  if (!enabled) return null;

  return (
    <section className="card card--quiet account-card">
      <div className="card-title">
        <h3>{t('Account')}</h3>
        {who.signedIn && <span className="badge badge--good">{t('Signed in')}</span>}
      </div>

      {who.signedIn ? (
        <>
          <p className="tiny muted">
            {rich('Signed in as <b>{email}</b>. Your diary follows this address, so a new phone is a sign-in rather than a fresh start.', { email: who.email }, { b: (text) => <b>{text}</b> })}
          </p>
          {who.mailReady && who.verified === false && (
            <Unconfirmed
              email={who.email ?? ''}
              onConfirmed={() => setWho({ ...who, verified: true })}
            />
          )}
          <div className="account-actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm('password')}>
              {t('Change password')}
            </button>
            {Boolean(who.otherDevices) && (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm('devices')}>
                {plural(who.otherDevices ?? 0, { one: 'Sign out {n} other device', other: 'Sign out {n} other devices' })}
              </button>
            )}
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              onClick={async () => {
                const done = await signOut();
                if (!done.ok) {
                  toast(done.message, '⚠️');
                  return;
                }
                setWho({ signedIn: false });
                toast(t('Signed out. Your diary is still here.'), '👋');
              }}
            >
              {t('Sign out')}
            </button>
          </div>
          <div className="account-danger">
            <button type="button" className="btn btn--sm btn--quiet-danger" onClick={() => setForm('delete')}>
              {t('Delete account')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="tiny muted">
            {t('You do not need one. It is for two things: moving to a new phone without starting again, and getting your diary back if this one is lost.')}
          </p>
          {offer && (
            <p className="small account-offer">
              {t('🎁 A friend invited you: make an account, use Squish on {days} different days, and you both get {period} of Squish Plus.', {
                days: offer.qualifyDays,
                period: periodWords(offer.rewardDays),
              })}
            </p>
          )}
          <div className="account-actions">
            <button type="button" className="btn btn--sm" onClick={() => setForm('up')}>
              {t('Create an account')}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm('in')}>
              {t('Sign in')}
            </button>
          </div>
        </>
      )}

      <Sheet open={form !== null} onClose={() => setForm(null)} title={form ? TITLES[form] : undefined}>
        {form === 'in' && (
          <Credentials
            submit={t('Sign in')}
            onSubmit={signIn}
            onDone={(arrived) => {
              setWho({ signedIn: true, email: arrived.email });
              void whoAmI().then(setWho);
              setForm(null);
              toast(
                arrived.broughtDiary === false
                  ? t('Signed in. That account already has a diary — Backup will ask which to keep.')
                  : t('Signed in.'),
                '🫧',
              );
            }}
            footer={
              <button type="button" className="linkish tiny" onClick={() => setForm('forgot')}>
                {t('I have forgotten my password')}
              </button>
            }
          />
        )}

        {form === 'up' && (
          <Credentials
            submit={t('Create account')}
            hint={t('Four words you will remember beats one word with a number on the end.')}
            onSubmit={signUp}
            onDone={(arrived) => {
              setForm(null);
              void whoAmI().then(setWho);
              const taste = planNow().plan === 'free' ? planNow().left.photo : 0;
              toast(
                [
                  t('Account made.'),
                  taste > 0 ? t('Your {n} free AI analyses are ready.', { n: taste }) : t('Your diary came with you.'),
                  arrived.verificationSent ? t('Check your email to confirm the address.') : '',
                ]
                  .filter(Boolean)
                  .join(' '),
                '🫧',
              );
            }}
          />
        )}

        {form === 'forgot' && (
          <Forgot
            onDone={() => {
              setForm(null);
              toast(t('If that address has an account, a link is on its way.'), '📮');
            }}
          />
        )}

        {form === 'password' && (
          <NewPassword
            onDone={() => {
              setForm(null);
              toast(t('Password changed.'), '🔒');
            }}
          />
        )}

        {form === 'devices' && (
          <ForgetDevices
            count={who.otherDevices ?? 0}
            onDone={() => {
              setWho({ ...who, otherDevices: 0 });
              setForm(null);
              toast(t('Signed out everywhere else.'), '🔒');
            }}
          />
        )}

        {form === 'delete' && (
          <DeleteAccount
            email={who.email ?? ''}
            onDone={() => {
              setWho({ signedIn: false });
              setForm(null);
              toast(t('Account deleted. Your diary is still on this device.'), '🧼');
            }}
          />
        )}
      </Sheet>
    </section>
  );
}

/**
 * The shared shape of every form here: try, and if it fails say why in place.
 *
 * The message comes from the server rather than being written here, so there
 * is one wording per situation and it cannot drift between the two.
 */
function useSubmit<T>(run: () => Promise<{ ok: true } & T | { ok: false; message: string }>, onDone: (result: T) => void) {
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setTrouble(null);
    const answer = await run();
    setBusy(false);
    if (answer.ok) onDone(answer as T);
    else setTrouble(answer.message);
  };

  return { busy, trouble, go };
}

function Trouble({ says }: { says: string | null }) {
  if (!says) return null;
  return (
    <p className="tiny account-trouble" role="alert">
      {says}
    </p>
  );
}

export function Credentials({
  submit,
  hint,
  onSubmit,
  onDone,
  footer,
}: {
  submit: string;
  hint?: string;
  onSubmit: (email: string, password: string) => Promise<({ ok: true } & Arrived) | { ok: false; message: string }>;
  onDone: (arrived: Arrived) => void;
  footer?: React.ReactNode;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, trouble, go } = useSubmit(() => onSubmit(email, password), onDone);

  return (
    <form
      className="stack account-form"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <div className="field">
        <label htmlFor="account-email">{t('Email')}</label>
        <input
          id="account-email"
          className="input"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <PasswordField
        id="account-password"
        label={t('Password')}
        value={password}
        onChange={setPassword}
        autoComplete={submit === t('Sign in') ? 'current-password' : 'new-password'}
        hint={hint}
      />
      <Trouble says={trouble} />
      <button type="submit" className="btn" disabled={busy || !email || !password}>
        {busy ? t('One moment…') : submit}
      </button>
      {footer && <div className="account-form-footer">{footer}</div>}
    </form>
  );
}

export function Forgot({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const { busy, trouble, go } = useSubmit(() => requestReset(email), onDone);

  return (
    <form
      className="stack account-form"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <p className="tiny muted">
        {t('We will send a link that works for two hours. It says the same thing whether or not that address has an account here, which is deliberate.')}
      </p>
      <div className="field">
        <label htmlFor="forgot-email">{t('Email')}</label>
        <input
          id="forgot-email"
          className="input"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
      </div>
      <Trouble says={trouble} />
      <button type="submit" className="btn" disabled={busy || !email}>
        {busy ? t('One moment…') : t('Send me a link')}
      </button>
    </form>
  );
}

function NewPassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const { busy, trouble, go } = useSubmit(() => changePassword(current, next), onDone);

  return (
    <form
      className="stack account-form"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <PasswordField
        id="old-password"
        label={t('Current password')}
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
      />
      <PasswordField
        id="new-password"
        label={t('New password')}
        value={next}
        onChange={setNext}
        autoComplete="new-password"
      />
      <Trouble says={trouble} />
      <button type="submit" className="btn" disabled={busy || !current || !next}>
        {busy ? t('One moment…') : t('Change password')}
      </button>
    </form>
  );
}

/**
 * Deleting is typed out, not tapped.
 *
 * The password is asked for because a phone left on a train should not be able
 * to do this, and the consequence is spelled out because "delete account" is
 * ambiguous about what happens to the six weeks of lunches on the screen
 * behind the sheet. They stay.
 */
function DeleteAccount({ email, onDone }: { email: string; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const { busy, trouble, go } = useSubmit(() => deleteAccount(password), onDone);

  return (
    <form
      className="stack account-form"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <p className="tiny muted">
        {rich('This deletes the account on <b>{email}</b> and the copy of your diary kept with it. Your diary stays on this device — this is the spare going, not the original. It cannot be undone.', { email }, { b: (text) => <b>{text}</b> })}
      </p>
      <PasswordField
        id="delete-password"
        label={t('Your password')}
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      <Trouble says={trouble} />
      <button type="submit" className="btn btn--danger" disabled={busy || !password}>
        {busy ? t('One moment…') : t('Delete my account')}
      </button>
    </form>
  );
}

/**
 * Cutting loose a device somebody no longer has.
 *
 * The case this exists for is a lost or stolen phone. A device token has no
 * expiry — whoever holds it is that device — so without this, losing a phone
 * meant whoever found it stayed signed in for ever, and changing the password
 * did nothing, because the password is not what the token proves.
 *
 * The password is asked for because this is a lock, and because a phone left
 * on a train must not be able to sign its owner out of their own account.
 */
function ForgetDevices({ count, onDone }: { count: number; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const { busy, trouble, go } = useSubmit(() => signOutEverywhere(password), onDone);

  return (
    <form
      className="stack account-form"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <p className="tiny muted">
        {plural(count, {
          one: "One other device is signed in. This signs it out — use it if you have lost a phone, or used somebody else's computer. This device stays signed in, and nothing in anybody's diary is deleted.",
          other: "{n} other devices are signed in. This signs them out — use it if you have lost a phone, or used somebody else's computer. This device stays signed in, and nothing in anybody's diary is deleted.",
        })}
      </p>
      <PasswordField label={t('Your password')} value={password} onChange={setPassword} autoComplete="current-password" />
      <Trouble says={trouble} />
      <button type="submit" className="btn" disabled={busy || !password}>
        {busy ? t('One moment…') : plural(count, { one: 'Sign it out', other: 'Sign them out' })}
      </button>
    </form>
  );
}

/**
 * A nudge to confirm the address, and a way to get the link again.
 *
 * A nudge, not a wall: nothing in Squish is withheld from an unconfirmed
 * account. What it changes is whether Squish will email you about your own
 * account — security notices only go to an address somebody has shown is
 * theirs — and that is what this says, rather than implying something is
 * broken.
 */
function Unconfirmed({ email, onConfirmed }: { email: string; onConfirmed: () => void }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [trouble, setTrouble] = useState<string | null>(null);

  const again = async () => {
    setState('sending');
    setTrouble(null);
    const done = await resendVerification();
    if (!done.ok) {
      setState('idle');
      setTrouble(done.message);
      return;
    }
    if (done.result === 'already') {
      onConfirmed();
      return;
    }
    setState('sent');
  };

  return (
    <div className="account-unconfirmed">
      <p className="tiny">
        <b>{t('Confirm your email.')}</b>{' '}
        {state === 'sent'
          ? t('Sent — look for it at {email}, and in spam if it is not there.', { email })
          : t("Until you do, Squish won't email you if somebody signs into your account.")}
      </p>
      {state !== 'sent' && (
        <button type="button" className="linkish tiny" disabled={state === 'sending'} onClick={() => void again()}>
          {state === 'sending' ? t('Sending…') : t('Send the link again')}
        </button>
      )}
      <Trouble says={trouble} />
    </div>
  );
}
