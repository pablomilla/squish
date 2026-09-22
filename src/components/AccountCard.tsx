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
import { useEffect, useState } from 'react';
import { Sheet, useToast } from './ui';
import {
  changePassword,
  deleteAccount,
  requestReset,
  signIn,
  signOut,
  signUp,
  whoAmI,
  type Who,
} from '../lib/account';
import './account-card.css';

type Form = 'in' | 'up' | 'forgot' | 'password' | 'delete' | null;

const TITLES: Record<Exclude<Form, null>, string> = {
  in: 'Sign in',
  up: 'Create an account',
  forgot: 'Forgotten password',
  password: 'Change your password',
  delete: 'Delete your account',
};

export default function AccountCard({ enabled }: { enabled: boolean }) {
  const [who, setWho] = useState<Who>({ signedIn: false });
  const [form, setForm] = useState<Form>(null);
  const toast = useToast();

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void whoAmI().then((found) => {
      if (live) setWho(found);
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>Account</h3>
        {who.signedIn && <span className="badge badge--good">Signed in</span>}
      </div>

      {who.signedIn ? (
        <>
          <p className="tiny muted">
            Signed in as <b>{who.email}</b>. Your diary follows this address, so a new phone is a sign-in rather than a
            fresh start.
          </p>
          <div className="account-actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm('password')}>
              Change password
            </button>
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
                toast('Signed out. Your diary is still here.', '👋');
              }}
            >
              Sign out
            </button>
          </div>
          <div className="account-danger">
            <button type="button" className="btn btn--sm btn--quiet-danger" onClick={() => setForm('delete')}>
              Delete account
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="tiny muted">
            You do not need one. It is for two things: moving to a new phone without starting again, and getting your
            diary back if this one is lost.
          </p>
          <div className="account-actions">
            <button type="button" className="btn btn--sm" onClick={() => setForm('up')}>
              Create an account
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setForm('in')}>
              Sign in
            </button>
          </div>
        </>
      )}

      <Sheet open={form !== null} onClose={() => setForm(null)} title={form ? TITLES[form] : undefined}>
        {form === 'in' && (
          <Credentials
            submit="Sign in"
            onSubmit={signIn}
            onDone={(arrived) => {
              setWho({ signedIn: true, email: arrived.email });
              setForm(null);
              toast(
                arrived.broughtDiary === false
                  ? 'Signed in. That account already has a diary — Backup will ask which to keep.'
                  : 'Signed in.',
                '🫧',
              );
            }}
            footer={
              <button type="button" className="linkish tiny" onClick={() => setForm('forgot')}>
                I have forgotten my password
              </button>
            }
          />
        )}

        {form === 'up' && (
          <Credentials
            submit="Create account"
            hint="Four words you will remember beats one word with a number on the end."
            onSubmit={signUp}
            onDone={(arrived) => {
              setWho({ signedIn: true, email: arrived.email });
              setForm(null);
              toast('Account made. Your diary came with you.', '🫧');
            }}
          />
        )}

        {form === 'forgot' && (
          <Forgot
            onDone={() => {
              setForm(null);
              toast('If that address has an account, a link is on its way.', '📮');
            }}
          />
        )}

        {form === 'password' && (
          <NewPassword
            onDone={() => {
              setForm(null);
              toast('Password changed.', '🔒');
            }}
          />
        )}

        {form === 'delete' && (
          <DeleteAccount
            email={who.email ?? ''}
            onDone={() => {
              setWho({ signedIn: false });
              setForm(null);
              toast('Account deleted. Your diary is still on this device.', '🧼');
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

function Credentials({
  submit,
  hint,
  onSubmit,
  onDone,
  footer,
}: {
  submit: string;
  hint?: string;
  onSubmit: (email: string, password: string) => Promise<{ ok: true; email?: string; broughtDiary?: boolean } | { ok: false; message: string }>;
  onDone: (arrived: { email?: string; broughtDiary?: boolean }) => void;
  footer?: React.ReactNode;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, trouble, go } = useSubmit(() => onSubmit(email, password), onDone);

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <div className="field">
        <label htmlFor="account-email">Email</label>
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
      <div className="field">
        <label htmlFor="account-password">Password</label>
        <input
          id="account-password"
          className="input"
          type="password"
          autoComplete={submit === 'Sign in' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        {hint && <p className="tiny muted">{hint}</p>}
      </div>
      <Trouble says={trouble} />
      <button type="submit" className="btn" disabled={busy || !email || !password}>
        {busy ? 'One moment…' : submit}
      </button>
      {footer}
    </form>
  );
}

function Forgot({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const { busy, trouble, go } = useSubmit(() => requestReset(email), onDone);

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <p className="tiny muted">
        We will send a link that works for two hours. It says the same thing whether or not that address has an account
        here, which is deliberate.
      </p>
      <div className="field">
        <label htmlFor="forgot-email">Email</label>
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
        {busy ? 'One moment…' : 'Send me a link'}
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
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <div className="field">
        <label htmlFor="old-password">Current password</label>
        <input
          id="old-password"
          className="input"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">New password</label>
        <input
          id="new-password"
          className="input"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => setNext(event.target.value)}
          required
        />
      </div>
      <Trouble says={trouble} />
      <button type="submit" className="btn" disabled={busy || !current || !next}>
        {busy ? 'One moment…' : 'Change password'}
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
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        void go();
      }}
    >
      <p className="tiny muted">
        This deletes the account on <b>{email}</b> and the copy of your diary kept with it. Your diary stays on this
        device — this is the spare going, not the original. It cannot be undone.
      </p>
      <div className="field">
        <label htmlFor="delete-password">Your password</label>
        <input
          id="delete-password"
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </div>
      <Trouble says={trouble} />
      <button type="submit" className="btn btn--danger" disabled={busy || !password}>
        {busy ? 'One moment…' : 'Delete my account'}
      </button>
    </form>
  );
}
