/**
 * The dashboard.
 *
 * Built for the person running Squish rather than the person using it, which
 * means it answers three questions and does not try to be a product: what is
 * this costing, who is signed up, and give that person Plus.
 *
 * Costs are what Anthropic actually charged, accumulated per call, not counts
 * multiplied by an assumed price. That distinction is the whole reason it is
 * worth looking at: "Plus is priced right" should be a measurement.
 *
 * It cannot show anybody's diary, and the server would not serve one if it
 * asked. Running a service means knowing somebody used eleven analyses; it
 * does not mean reading their lunch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon } from '../components/icons';
import { Sheet, useToast } from '../components/ui';
import { TwoFactorPrompt, TwoFactorSetup, TwoFactorStatus } from '../components/TwoFactor';
import { PLUS } from '../lib/plan';
import {
  createInvite,
  deleteInvite,
  fetchEmails,
  fetchOverview,
  fetchTwoFactor,
  lockDashboard,
  fetchPeople,
  previewEmail,
  resetEmail,
  saveEmail,
  setInviteDisabled,
  sendTestMail,
  setPlan,
  testEmail,
  type AdminAction,
  type EmailPreview,
  type EmailTemplate,
  type EmailWording,
  type Invite,
  type Overview,
  type Person,
  type TwoFactorState,
} from '../lib/admin';
import { friendlyDate } from '../lib/date';
import './admin.css';

const money = (usd: number) => `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
const day = (iso: string | null) => (iso ? friendlyDate(iso.slice(0, 10)) : '—');

const KIND: Record<string, string> = { photo: 'Photo analyses', chat: 'Nutritionist', recipe: 'Recipe imports' };

/**
 * The door. Nothing below is fetched until the server says this device has
 * passed the second step — and the server says no to every dashboard request
 * until it has, so this is the app keeping up, not the lock.
 */
export default function Admin({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<TwoFactorState | null>(null);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    const next = await fetchTwoFactor();
    setFailed(!next);
    setState(next);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (state?.passed) {
    return <Dashboard onClose={onClose} twoFactor={state} onRecheck={check} />;
  }

  return (
    <div className="screen admin">
      <Head subtitle="Two-step sign-in" onClose={onClose} />
      {!state ? (
        <p className="tiny muted admin-foot">{failed ? 'Could not reach Squish just now.' : 'Loading…'}</p>
      ) : state.enrolled ? (
        <TwoFactorPrompt onPassed={() => void check()} />
      ) : (
        <TwoFactorSetup onDone={() => void check()} />
      )}
    </div>
  );
}

function Head({ subtitle, onClose, onLock }: { subtitle: string; onClose: () => void; onLock?: () => void }) {
  return (
    <header className="screen-head">
      <div>
        <h1>Dashboard</h1>
        <p>{subtitle}</p>
      </div>
      <div className="row" style={{ gap: 8 }}>
        {onLock && (
          <button type="button" className="btn btn--sm btn--ghost" onClick={onLock}>
            Lock
          </button>
        )}
        <button type="button" className="btn btn--sm btn--ghost" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </div>
    </header>
  );
}

function Dashboard({
  onClose,
  twoFactor,
  onRecheck,
}: {
  onClose: () => void;
  twoFactor: TwoFactorState;
  onRecheck: () => void;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async (q: string) => {
    const [head, list] = await Promise.all([fetchOverview(), fetchPeople(q)]);
    // Most likely the twelve hours are up. Asking again puts the code box back
    // if so, and changes nothing if it was only a blip.
    if (!head) onRecheck();
    if (head) setOverview(head);
    if (list) {
      setPeople(list.people);
      setActions(list.actions);
    }
  }, [onRecheck]);

  useEffect(() => {
    void load(search);
  }, [load, search]);

  const change = async (email: string, days: number) => {
    setBusy(email);
    const done = await setPlan(email, days);
    setBusy(null);
    if (!done.ok) {
      toast(done.message, '⚠️');
      return;
    }
    toast(days > 0 ? `${email} is on ${PLUS}.` : `${email} is back on free.`, days > 0 ? '🎉' : '↩️');
    await load(search);
  };

  return (
    <div className="screen admin">
      <Head
        subtitle={overview ? `This month, ${overview.month}` : 'Loading…'}
        onClose={onClose}
        onLock={async () => {
          await lockDashboard();
          onRecheck();
        }}
      />

      {overview && (
        <>
          <section className="card card--quiet">
            <div className="admin-figures">
              <Figure label="Accounts" value={overview.accounts} />
              <Figure label={PLUS} value={overview.plus} />
              <Figure label="Devices" value={overview.devices} />
              <Figure label="Active" value={overview.activeThisMonth} />
            </div>
          </section>

          <section className="card card--quiet">
            <div className="card-title">
              <h3>What it cost</h3>
              <span className="badge">{money(overview.totalUsd)}</span>
            </div>
            {overview.spend.length === 0 ? (
              <p className="tiny muted">Nothing yet this month.</p>
            ) : (
              <div className="admin-rows">
                {overview.spend.map((row) => (
                  <div className="admin-row" key={row.kind}>
                    <span className="tiny">{KIND[row.kind] ?? row.kind}</span>
                    <span className="tiny muted">{row.calls} calls</span>
                    <b className="small">{money(row.usd)}</b>
                  </div>
                ))}
              </div>
            )}
            <p className="tiny muted" style={{ marginTop: 10 }}>
              What Anthropic charged, added up per call — not an estimate. Free gets{' '}
              {overview.allowances.free.photo} photos a month; {PLUS} gets {overview.allowances.plus.photo} and{' '}
              {overview.allowances.plus.chat} questions.
            </p>
          </section>

          <MailStatus ready={overview.mailReady} />

          <Emails mailReady={overview.mailReady} />

          <Invites
            invites={overview.invites}
            suggestion={overview.suggestion}
            onChanged={() => void load(search)}
          />

        </>
      )}

      <section className="card card--quiet">
        <div className="card-title">
          <h3>People</h3>
        </div>
        <input
          className="input"
          value={search}
          placeholder="Search by email…"
          aria-label="Search people"
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="admin-people">
          {people.length === 0 && <p className="tiny muted">Nobody yet.</p>}
          {people.map((person) => (
            <div className="admin-person" key={person.id}>
              <div className="admin-person-head">
                <b className="small">
                  {person.email}
                  {!person.verified && <span className="tiny muted admin-unconfirmed"> · unconfirmed</span>}
                </b>
                <span className={`badge ${person.plan === 'plus' ? 'badge--good' : ''}`}>
                  {person.plan === 'plus' ? PLUS : 'Free'}
                </span>
              </div>
              <p className="tiny muted">
                Joined {day(person.joined)}
                {person.plan === 'plus' && ` · until ${day(person.plusUntil)}`} · {person.used.photo} photos,{' '}
                {person.used.chat} questions this month · {money(person.usd)}
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  disabled={busy === person.email}
                  onClick={() => void change(person.email, 30)}
                >
                  +30 days
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  disabled={busy === person.email}
                  onClick={() => void change(person.email, 365)}
                >
                  +1 year
                </button>
                {person.plan === 'plus' && (
                  <button
                    type="button"
                    className="btn btn--sm btn--quiet-danger"
                    disabled={busy === person.email}
                    onClick={() => void change(person.email, 0)}
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {actions.length > 0 && (
        <section className="card card--quiet">
          <div className="card-title">
            <h3>What has been done</h3>
          </div>
          <div className="admin-rows">
            {actions.map((entry, index) => (
              <div className="admin-row" key={`${entry.at}-${index}`}>
                <span className="tiny">
                  {entry.action} {entry.subject}
                </span>
                <span className="tiny muted">{entry.detail ?? ''}</span>
                <span className="tiny muted">{day(entry.at)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <TwoFactorStatus recoveryLeft={twoFactor.recoveryLeft} onChanged={onRecheck} />

      <p className="tiny muted admin-foot">
        Counts and totals only. Nobody's diary is readable from here, by design — see docs/privacy.md.
      </p>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-figure">
      <b>{value}</b>
      <span className="tiny muted">{label}</span>
    </div>
  );
}

/**
 * Making and retiring invite codes.
 *
 * These were an environment variable for about a day, which meant every
 * change was a deploy and a code could never know how many people had used
 * it. Here a code is a row: it has a length, a limit, a note saying who it
 * was for, and a count of who took it up.
 *
 * Switching one off is offered before deleting it, and deleting is offered
 * last, because off is almost always what somebody means — and deleting does
 * not take back what the code already bought.
 */
function Invites({
  invites,
  suggestion,
  onChanged,
}: {
  invites: Invite[];
  suggestion: string;
  onChanged: () => void;
}) {
  const [code, setCode] = useState(suggestion);
  const [days, setDays] = useState(365);
  const [uses, setUses] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const toast = useToast();

  const make = async () => {
    setBusy(true);
    setTrouble(null);
    const made = await createInvite({
      code,
      days,
      uses: uses.trim() ? Number(uses) : null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (!made.ok) {
      setTrouble(made.message);
      return;
    }
    toast(`${made.invite.code} is live.`, '🎟️');
    setCode('');
    setNote('');
    setUses('');
    onChanged();
  };

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>Invite codes</h3>
      </div>

      {invites.length === 0 ? (
        <p className="tiny muted">None yet. Make one below and hand it to whoever should have Plus.</p>
      ) : (
        <div className="admin-invites">
          {invites.map((invite) => (
            <div className={`admin-invite${invite.disabled ? ' admin-invite--off' : ''}`} key={invite.code}>
              <div className="admin-invite-head">
                <code>{invite.code}</code>
                <span className="tiny muted">
                  {invite.used} used{invite.usesLeft !== null && ` · ${invite.usesLeft} left`}
                </span>
              </div>
              <p className="tiny muted">
                {invite.days} days{invite.note && ` · ${invite.note}`}
                {invite.disabled && ' · off'}
              </p>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={async () => {
                    await setInviteDisabled(invite.code, !invite.disabled);
                    onChanged();
                  }}
                >
                  {invite.disabled ? 'Turn on' : 'Turn off'}
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--quiet-danger"
                  onClick={async () => {
                    await deleteInvite(invite.code);
                    toast('Code deleted. Anybody who used it keeps their Plus.', '🗑️');
                    onChanged();
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        className="admin-new-invite"
        onSubmit={(event) => {
          event.preventDefault();
          void make();
        }}
      >
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input grow"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="CODE"
            aria-label="New code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setCode(suggestion)}>
            Suggest
          </button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <label className="tiny muted grow">
            Days
            <input
              className="input"
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              aria-label="Days each code is worth"
            />
          </label>
          <label className="tiny muted grow">
            Uses (blank = any)
            <input
              className="input"
              type="number"
              min={1}
              value={uses}
              onChange={(event) => setUses(event.target.value)}
              aria-label="How many times it can be used"
            />
          </label>
        </div>
        <input
          className="input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="What it is for — only you see this"
          aria-label="Note"
        />
        {trouble && (
          <p className="tiny account-trouble" role="alert">
            {trouble}
          </p>
        )}
        <button type="submit" className="btn btn--sm" disabled={busy || !code.trim()}>
          {busy ? 'One moment…' : 'Make this code'}
        </button>
      </form>
    </section>
  );
}

/**
 * Whether Squish can send email, and a way to find out for certain.
 *
 * Configured is not the same as working. The only honest check is receiving
 * one, and the likeliest failure — the provider not yet trusting the
 * from-address domain — only shows up when something is actually sent. The
 * provider's own explanation is passed through, because it is the useful
 * part.
 */
function MailStatus({ ready }: { ready: boolean }) {
  const [state, setState] = useState<{ kind: 'idle' | 'sending' } | { kind: 'sent'; to: string } | { kind: 'failed'; message: string }>({
    kind: 'idle',
  });

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>Email</h3>
        <span className={`badge ${ready ? 'badge--good' : 'badge--warn'}`}>{ready ? 'Set up' : 'Not set up'}</span>
      </div>
      {ready ? (
        <>
          <p className="tiny muted">
            Confirmation links, password resets and security notices go out through your provider. Send yourself one to
            be sure it arrives.
          </p>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            style={{ marginTop: 10 }}
            disabled={state.kind === 'sending'}
            onClick={async () => {
              setState({ kind: 'sending' });
              const done = await sendTestMail();
              setState(done.ok ? { kind: 'sent', to: done.to } : { kind: 'failed', message: done.message });
            }}
          >
            {state.kind === 'sending' ? 'Sending…' : 'Send me a test email'}
          </button>
          {state.kind === 'sent' && <p className="tiny" style={{ marginTop: 8 }}>Sent to {state.to}. Check spam if it is not there in a minute.</p>}
          {state.kind === 'failed' && (
            <p className="tiny account-trouble" role="alert" style={{ marginTop: 8 }}>
              {state.message}
            </p>
          )}
        </>
      ) : (
        <p className="tiny muted">
          Nothing is emailed yet: password-reset links go to the server log, and the app does not ask anybody to confirm
          their address. Set <code>SQUISH_MAIL_WEBHOOK</code>, <code>SQUISH_MAIL_TOKEN</code> and{' '}
          <code>SQUISH_MAIL_FROM</code> in the host's dashboard to turn it on.
        </p>
      )}
    </section>
  );
}

/**
 * The wording of every email Squish sends.
 *
 * The rules live on the server — which placeholders an email may use, which
 * it must — and the editor simply asks, as somebody types, what the email
 * would look like and what is wrong with it. So a reset email without its
 * link cannot be saved from here, and could not be saved around it either.
 */
function Emails({ mailReady }: { mailReady: boolean }) {
  const [emails, setEmails] = useState<EmailTemplate[] | null>(null);
  const [editing, setEditing] = useState<EmailTemplate | null>(null);

  const load = useCallback(async () => {
    const list = await fetchEmails();
    if (list) setEmails(list.emails);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card card--quiet">
      <div className="card-title">
        <h3>Email wording</h3>
      </div>
      {!emails ? (
        <p className="tiny muted">Loading…</p>
      ) : (
        <div className="admin-emails">
          {emails.map((email) => (
            <div className="admin-email" key={email.key}>
              <div className="admin-email-text">
                <b className="small">
                  {email.label}
                  {email.customised && <span className="badge badge--good admin-email-badge">Customised</span>}
                </b>
                <p className="tiny muted">{email.when}</p>
              </div>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing(email)}>
                Edit
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="tiny muted" style={{ marginTop: 10 }}>
        Every email goes out with the Squish header and a plain-text copy beside it. The footer — company details and
        the privacy link — is fixed, because the law wants it there.
      </p>
      {editing && (
        <EmailEditor
          key={editing.key}
          email={editing}
          mailReady={mailReady}
          onClose={() => setEditing(null)}
          onSaved={() => void load()}
        />
      )}
    </section>
  );
}

const same = (a: EmailWording, b: EmailWording) =>
  a.subject === b.subject && a.body === b.body && (a.buttonLabel ?? '') === (b.buttonLabel ?? '');

function EmailEditor({
  email,
  mailReady,
  onClose,
  onSaved,
}: {
  email: EmailTemplate;
  mailReady: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState<EmailWording>(email.current);
  const [draft, setDraft] = useState<EmailWording>(email.current);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [busy, setBusy] = useState<'save' | 'reset' | 'test' | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  // Ask for a fresh preview once typing pauses. Answers can land out of order,
  // so only the newest one is kept.
  const asked = useRef(0);
  useEffect(() => {
    const ask = ++asked.current;
    const timer = window.setTimeout(async () => {
      const answer = await previewEmail(email.key, draft);
      if (answer && ask === asked.current) setPreview(answer);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [email.key, draft]);

  const problems = preview?.problems ?? [];
  const dirty = !same(draft, saved);
  const original = same(draft, email.original);

  const edit = (change: Partial<EmailWording>) => {
    setTrouble(null);
    setDraft((current) => ({ ...current, ...change }));
  };

  /** Put `{name}` where the cursor is, and leave the cursor after it. */
  const insert = (name: string) => {
    const field = body.current;
    const token = `{${name}}`;
    const start = field?.selectionStart ?? draft.body.length;
    const end = field?.selectionEnd ?? draft.body.length;
    edit({ body: draft.body.slice(0, start) + token + draft.body.slice(end) });
    requestAnimationFrame(() => {
      if (!field) return;
      field.focus();
      field.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const close = () => {
    if (dirty && !window.confirm('Close without saving these changes?')) return;
    onClose();
  };

  const save = async () => {
    setBusy('save');
    const done = await saveEmail(email.key, draft);
    setBusy(null);
    if (!done.ok) {
      setTrouble(done.message);
      return;
    }
    setSaved(draft);
    toast('Saved. The next one sent uses this.', '✉️');
    onSaved();
  };

  const reset = async () => {
    setBusy('reset');
    const done = await resetEmail(email.key);
    setBusy(null);
    if (!done.ok) {
      setTrouble(done.message);
      return;
    }
    setSaved(email.original);
    setDraft(email.original);
    toast('Back to the original wording.', '↩️');
    onSaved();
  };

  const test = async () => {
    setBusy('test');
    const done = await testEmail(email.key, draft);
    setBusy(null);
    if (!done.ok) {
      setTrouble(done.message);
      return;
    }
    toast(`Sent to ${done.to ?? 'you'}.`, '📬');
  };

  return (
    <Sheet
      open
      wide
      onClose={close}
      title={email.label}
      footer={
        <div className="admin-email-actions">
          <button type="button" className="btn" disabled={!dirty || problems.length > 0 || busy !== null} onClick={() => void save()}>
            {busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
          {mailReady && (
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={problems.length > 0 || busy !== null}
              onClick={() => void test()}
            >
              {busy === 'test' ? 'Sending…' : 'Send me this version'}
            </button>
          )}
          {(email.customised || !original) && (
            <button
              type="button"
              className="btn btn--sm btn--quiet-danger"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm('Put back the original wording? What you wrote here will be gone.')) void reset();
              }}
            >
              Put back the original
            </button>
          )}
        </div>
      }
    >
      <div className="admin-editor">
        <p className="tiny muted">{email.when}.</p>

        <label className="tiny muted">
          Subject
          <input className="input" value={draft.subject} onChange={(event) => edit({ subject: event.target.value })} />
        </label>

        {email.button && (
          <label className="tiny muted">
            Button
            <input
              className="input"
              value={draft.buttonLabel ?? ''}
              onChange={(event) => edit({ buttonLabel: event.target.value })}
            />
          </label>
        )}

        <label className="tiny muted">
          Message
          <textarea
            ref={body}
            className="textarea admin-editor-body"
            value={draft.body}
            rows={12}
            onChange={(event) => edit({ body: event.target.value })}
          />
        </label>

        {(problems.length > 0 || trouble) && (
          <div className="account-trouble tiny" role="alert">
            {trouble && !problems.includes(trouble) && <p>{trouble}</p>}
            {problems.map((problem) => (
              <p key={problem}>{problem}</p>
            ))}
          </div>
        )}

        {email.placeholders.length > 0 && (
          <div className="admin-editor-fill">
            <p className="tiny muted">Tap to put one in where the cursor is:</p>
            <div className="admin-editor-chips">
              {email.placeholders.map((placeholder) => (
                <button
                  type="button"
                  className="chip"
                  key={placeholder.name}
                  title={placeholder.about}
                  onClick={() => insert(placeholder.name)}
                >
                  {`{${placeholder.name}}`}
                  {email.required.includes(placeholder.name) && <span aria-label="required"> *</span>}
                </button>
              ))}
            </div>
            <ul className="tiny muted admin-editor-legend">
              {email.placeholders.map((placeholder) => (
                <li key={placeholder.name}>
                  <code>{`{${placeholder.name}}`}</code> — {placeholder.about}
                  {email.required.includes(placeholder.name) && ' (must be in the message)'}
                </li>
              ))}
            </ul>
            {email.button && (
              <p className="tiny muted">
                Put <code>{`{${email.button.placeholder}}`}</code> on a line of its own and it becomes the button.
              </p>
            )}
          </div>
        )}

        <div className="admin-preview">
          <p className="tiny muted">Preview, with made-up details filled in</p>
          {preview ? (
            <>
              <p className="small admin-preview-subject">
                <b>{preview.subject}</b>
              </p>
              <iframe title="Email preview" className="admin-preview-frame" sandbox="" srcDoc={preview.html} />
            </>
          ) : (
            <p className="tiny muted">Loading…</p>
          )}
        </div>
      </div>
    </Sheet>
  );
}
