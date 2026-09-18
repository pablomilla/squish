import { useState } from 'react';
import Squish from '../components/Squish';
import Wordmark from '../components/Wordmark';
import { unlock } from '../lib/api';
import './lock.css';

/**
 * Shown when the server was started with SQUISH_PASSCODE set. It keeps a
 * public URL from being a stranger's free Claude account — it is not a login,
 * and everyone who knows the passcode shares the same Squish.
 */
export default function Lock({ onUnlocked }: { onUnlocked: () => void }) {
  const [passcode, setPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError('');
    if (await unlock(passcode.trim())) {
      onUnlocked();
    } else {
      setError('That passcode did not match. Have another go?');
      setPasscode('');
      setBusy(false);
    }
  };

  return (
    <div className="app lock">
      <form className="screen lock-body" onSubmit={submit}>
        <Squish mood={error ? 'calm' : 'excited'} size={150} heart={!error} />
        <h1 className="lock-logo">
          <Wordmark width={200} />
        </h1>
        <p className="muted center">Pop in your passcode and let's get logging.</p>

        <div className="field lock-field">
          <label htmlFor="passcode" className="visually-hidden">
            Passcode
          </label>
          <input
            id="passcode"
            className="input center"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={passcode}
            placeholder="Passcode"
            onChange={(event) => setPasscode(event.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'passcode-error' : undefined}
          />
          {error && (
            <p id="passcode-error" className="lock-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <button type="submit" className="btn btn--block" disabled={busy || !passcode.trim()}>
          {busy ? 'Checking…' : 'Let me in'}
        </button>
      </form>
    </div>
  );
}
