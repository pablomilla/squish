/**
 * The dashboard's settings: email, the wording of every email, the second
 * sign-in step, and the record of what has been done from here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet, useToast } from '../../components/ui';
import { TwoFactorStatus } from '../../components/TwoFactor';
import {
  fetchEmails,
  fetchPeople,
  previewEmail,
  resetEmail,
  saveEmail,
  sendTestMail,
  testEmail,
  type AdminAction,
  type EmailPreview,
  type EmailTemplate,
  type EmailWording,
  type TwoFactorState,
} from '../../lib/admin';
import { friendlyDate } from '../../lib/date';

const day = (iso: string) => friendlyDate(iso.slice(0, 10));

export default function Settings({
  mailReady,
  twoFactor,
  onRecheck,
}: {
  mailReady: boolean;
  twoFactor: TwoFactorState;
  onRecheck: () => void;
}) {
  const [actions, setActions] = useState<AdminAction[] | null>(null);

  useEffect(() => {
    void fetchPeople('').then((list) => setActions(list?.actions ?? []));
  }, []);

  return (
    <div className="admin-section">
      <div className="admin-cols">
        <div className="admin-col">
          <MailStatus ready={mailReady} />
          <TwoFactorStatus recoveryLeft={twoFactor.recoveryLeft} onChanged={onRecheck} />
        </div>
        <div className="admin-col">
          <Emails mailReady={mailReady} />
        </div>
      </div>

      <section className="card card--quiet">
        <div className="card-title">
          <h3>What has been done</h3>
        </div>
        {!actions ? (
          <p className="tiny muted">Loading…</p>
        ) : actions.length === 0 ? (
          <p className="tiny muted">Nothing yet. Changes made from the dashboard are written here, with who made them.</p>
        ) : (
          <div className="admin-rows">
            {actions.map((entry, index) => (
              <div className="admin-row" key={`${entry.at}-${index}`}>
                <span className="tiny">
                  {entry.action} {entry.subject}
                  <span className="muted"> · {entry.admin}</span>
                </span>
                <span className="tiny muted">{entry.detail ?? ''}</span>
                <span className="tiny muted">{day(entry.at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
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
