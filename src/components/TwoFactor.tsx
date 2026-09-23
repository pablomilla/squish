/**
 * The dashboard's second step, as the admin sees it.
 *
 * Three moments: setting an authenticator app up once, typing a code each
 * time the dashboard is opened on a device, and keeping the recovery codes
 * that stand in for a lost phone. The rules — what counts as a code, how many
 * wrong ones lock it — are all on the server; this only asks.
 */
import { useState, type FormEvent } from 'react';
import { useToast } from './ui';
import { PLUS } from '../lib/plan';
import PasswordField from './PasswordField';
import {
  enableTwoFactor,
  newRecoveryCodes,
  startTwoFactor,
  verifyTwoFactor,
  type TwoFactorSetup as Setup,
} from '../lib/admin';

/** Split into fours, the way authenticator apps print a key to type. */
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

export function TwoFactorSetup({ onDone }: { onDone: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  const start = async () => {
    setBusy(true);
    setTrouble(null);
    const answer = await startTwoFactor();
    setBusy(false);
    if (!answer.ok) {
      setTrouble(answer.message);
      return;
    }
    setSetup(answer);
  };

  const finish = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setTrouble(null);
    const answer = await enableTwoFactor(password, code);
    setBusy(false);
    if (!answer.ok) {
      setTrouble(answer.message);
      return;
    }
    setPassword('');
    setCodes(answer.recoveryCodes);
  };

  if (codes) return <RecoveryCodes codes={codes} onDone={onDone} first />;

  return (
    <section className="card card--quiet twofactor">
      <div className="card-title">
        <h3>Set up two-step sign-in</h3>
      </div>
      <p className="small">
        The dashboard can give away {PLUS}, see everybody's email address and change what Squish emails
        people, so it asks for more than a password: a six-digit code from an authenticator app on your phone.
      </p>

      {!setup ? (
        <>
          <p className="tiny muted">
            Any authenticator app works — Google Authenticator, Microsoft Authenticator, 1Password, or the Passwords app
            on an iPhone. It takes about a minute, once.
          </p>
          {trouble && (
            <p className="tiny account-trouble" role="alert">
              {trouble}
            </p>
          )}
          <button type="button" className="btn" disabled={busy} onClick={() => void start()}>
            {busy ? 'One moment…' : 'Start'}
          </button>
        </>
      ) : (
        <form className="twofactor-steps" onSubmit={(event) => void finish(event)}>
          <ol className="twofactor-list">
            <li>
              <p className="small">In your authenticator app, add an account and scan this:</p>
              <img className="twofactor-qr" src={setup.qr} alt="QR code for your authenticator app" width={200} height={200} />
              <p className="tiny muted">
                On this phone already? <a href={setup.uri}>Open it in your authenticator app</a>, or type this key in:
              </p>
              <code className="twofactor-secret">{grouped(setup.secret)}</code>
            </li>
            <li>
              <p className="small">Type the six-digit code it shows, and your password:</p>
              <CodeInput value={code} onChange={setCode} />
              <PasswordField
                id="twofactor-password"
                label="Password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
              />
            </li>
          </ol>
          {trouble && (
            <p className="tiny account-trouble" role="alert">
              {trouble}
            </p>
          )}
          <button type="submit" className="btn" disabled={busy || code.length < 6 || !password}>
            {busy ? 'Checking…' : 'Turn it on'}
          </button>
        </form>
      )}
    </section>
  );
}

export function TwoFactorPrompt({ onPassed }: { onPassed: () => void }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setTrouble(null);
    const answer = await verifyTwoFactor(code);
    setBusy(false);
    if (!answer.ok) {
      setTrouble(answer.message);
      setCode('');
      return;
    }
    if (answer.usedRecovery) {
      toast(
        answer.recoveryLeft === 0
          ? 'That was your last recovery code. Make new ones below.'
          : `Recovery code used. ${answer.recoveryLeft} left.`,
        '🔑',
      );
    }
    onPassed();
  };

  return (
    <section className="card card--quiet twofactor">
      <div className="card-title">
        <h3>{recovery ? 'Use a recovery code' : 'Enter your code'}</h3>
      </div>
      <form className="twofactor-steps" onSubmit={(event) => void submit(event)}>
        {recovery ? (
          <>
            <p className="small">One of the ten codes you saved when you set this up. Each works once.</p>
            <input
              className="input twofactor-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="xxxxx-xxxxx"
              aria-label="Recovery code"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </>
        ) : (
          <>
            <p className="small">Open your authenticator app and type the six-digit code for Squish.</p>
            <CodeInput value={code} onChange={setCode} autoFocus />
          </>
        )}
        {trouble && (
          <p className="tiny account-trouble" role="alert">
            {trouble}
          </p>
        )}
        <button type="submit" className="btn" disabled={busy || code.trim().length < 6}>
          {busy ? 'Checking…' : 'Open the dashboard'}
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => {
            setRecovery(!recovery);
            setCode('');
            setTrouble(null);
          }}
        >
          {recovery ? 'Use the app instead' : 'Lost your phone? Use a recovery code'}
        </button>
      </form>
    </section>
  );
}

/** The two-step card inside the dashboard: how many recovery codes are left, and a way to make more. */
export function TwoFactorStatus({ recoveryLeft, onChanged }: { recoveryLeft: number; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  if (codes) {
    return (
      <RecoveryCodes
        codes={codes}
        onDone={() => {
          setCodes(null);
          onChanged();
        }}
      />
    );
  }

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>Two-step sign-in</h3>
        <span className="badge badge--good">On</span>
      </div>
      <p className="tiny muted">
        {recoveryLeft === 0
          ? 'No recovery codes left. Make new ones now, while you still have your phone.'
          : `${recoveryLeft} recovery code${recoveryLeft === 1 ? '' : 's'} left for a lost phone.`}{' '}
        Each device is asked for a code every 12 hours.
      </p>
      {!asking ? (
        <button type="button" className="btn btn--sm btn--ghost" style={{ marginTop: 10 }} onClick={() => setAsking(true)}>
          Make new recovery codes
        </button>
      ) : (
        <form
          className="twofactor-steps"
          style={{ marginTop: 10 }}
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setTrouble(null);
            const answer = await newRecoveryCodes(password);
            setBusy(false);
            if (!answer.ok) {
              setTrouble(answer.message);
              return;
            }
            setPassword('');
            setAsking(false);
            setCodes(answer.recoveryCodes);
          }}
        >
          <p className="tiny muted">The old ones stop working the moment the new ones are made.</p>
          <PasswordField
            id="twofactor-recovery-password"
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
          />
          {trouble && (
            <p className="tiny account-trouble" role="alert">
              {trouble}
            </p>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="submit" className="btn btn--sm" disabled={busy || !password}>
              {busy ? 'Making…' : 'Make them'}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => setAsking(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Recovery codes, shown the one time they exist in readable form.
 *
 * The button to carry on stays off until somebody says they have kept them,
 * because "I'll write them down later" is how people get locked out.
 */
function RecoveryCodes({ codes, onDone, first = false }: { codes: string[]; onDone: () => void; first?: boolean }) {
  const [kept, setKept] = useState(false);
  const toast = useToast();
  const text = `Squish dashboard recovery codes\nEach works once, in place of a code from your authenticator app.\n\n${codes.join('\n')}\n`;

  return (
    <section className="card card--quiet twofactor">
      <div className="card-title">
        <h3>{first ? 'Two-step sign-in is on' : 'New recovery codes'}</h3>
      </div>
      <p className="small">
        If you lose your phone, each of these opens the dashboard once. Keep them somewhere that isn't this phone — a
        password manager, or on paper. This is the only time they are shown.
      </p>
      <ul className="twofactor-codes" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn--sm btn--ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast('Copied.', '📋');
            } catch {
              toast('Could not copy — select them instead.', '⚠️');
            }
          }}
        >
          Copy
        </button>
        <a
          className="btn btn--sm btn--ghost"
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="squish-recovery-codes.txt"
        >
          Download
        </a>
      </div>
      <label className="twofactor-kept small">
        <input type="checkbox" checked={kept} onChange={(event) => setKept(event.target.checked)} /> I have saved these
      </label>
      <button type="button" className="btn" disabled={!kept} onClick={onDone}>
        {first ? 'Open the dashboard' : 'Done'}
      </button>
    </section>
  );
}

function CodeInput({
  value,
  onChange,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <input
      className="input twofactor-code"
      value={value}
      onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      placeholder="123456"
      aria-label="Six-digit code"
      autoFocus={autoFocus}
    />
  );
}
