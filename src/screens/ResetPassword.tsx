/**
 * The screen a reset link lands on.
 *
 * Shown instead of the app, not inside it, because somebody arriving here has
 * one thing to do and may well be doing it on a phone they have just picked
 * up, with no diary on it and nothing else to look at yet.
 *
 * It never says whether the link was ever valid until it is used, and once it
 * has been used the token comes out of the address bar — a live reset link
 * sitting in a browser history is the sort of thing that gets shared by
 * accident.
 */
import { useState } from 'react';
import Squish from '../components/Squish';
import PasswordField from '../components/PasswordField';
import { clearResetUrl, completeReset } from '../lib/account';
import './reset.css';

export default function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const go = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setTrouble(null);
    const answer = await completeReset(token, password);
    setBusy(false);
    if (answer.ok) {
      setDone(true);
      clearResetUrl();
      return;
    }
    setTrouble(answer.message);
  };

  return (
    <main className="reset">
      <Squish mood={done ? 'cheering' : 'thinking'} size={96} />
      {/* Somebody arriving from an email should be able to see whose link it was. */}
      <p className="reset-mark">Squish</p>

      {done ? (
        <>
          <h1>That is done</h1>
          <p className="small muted">You can sign in with your new password now.</p>
          <button type="button" className="btn" onClick={() => location.assign('/')}>
            Open Squish
          </button>
        </>
      ) : (
        <>
          <h1>Pick a new password</h1>
          <form className="stack reset-form" onSubmit={(event) => void go(event)}>
            <PasswordField
              id="reset-password"
              label="New password"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint="Four words you will remember beats one word with a number on the end."
            />
            {trouble && (
              <p className="tiny reset-trouble" role="alert">
                {trouble}
              </p>
            )}
            <button type="submit" className="btn" disabled={busy || !password}>
              {busy ? 'One moment…' : 'Set my password'}
            </button>
          </form>
        </>
      )}
    </main>
  );
}
