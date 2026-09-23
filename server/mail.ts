/**
 * Sending an email, or being honest about not sending one.
 *
 * Squish sends three kinds of email: a link to confirm an address, a link to
 * reset a password, and a notice when something security-related happens on
 * an account. None of that justifies an SMTP dependency or a provider baked
 * into the code, so this posts JSON somewhere, or writes to the log.
 *
 * The payload is `{ from, to, subject, text }`, which is what Resend's
 * `POST /emails` takes as it stands, so pointing at a real provider is
 * environment variables rather than glue code:
 *
 *   SQUISH_MAIL_WEBHOOK=https://api.resend.com/emails
 *   SQUISH_MAIL_TOKEN=re_...                     (the provider's API key)
 *   SQUISH_MAIL_FROM=Squish <hello@squish.online>
 *
 * Anything else that accepts that shape works the same way.
 *
 * With no webhook, the email goes to the log, loudly saying it was not sent.
 * That is a working password reset for whoever can read the log, which is the
 * right behaviour on a laptop — and it is why the app hides everything that
 * depends on somebody receiving mail until mail is set up.
 */

/*
 * Read when used rather than when the module loads, so a setting changed in
 * the host's dashboard takes effect without anybody knowing that it would not
 * have, and so a test can point this at a stand-in.
 */
const webhook = () => process.env.SQUISH_MAIL_WEBHOOK?.trim() || '';
const token = () => process.env.SQUISH_MAIL_TOKEN?.trim() || '';
const from = () => process.env.SQUISH_MAIL_FROM?.trim() || 'Squish <no-reply@squish.online>';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** True when mail actually leaves the building. */
export const canSendMail = (): boolean => Boolean(webhook());

export async function sendMail(mail: Mail): Promise<void> {
  if (!canSendMail()) {
    console.log(
      [
        '',
        '[squish] No SQUISH_MAIL_WEBHOOK set, so this email was not sent.',
        `         To:      ${mail.to}`,
        `         Subject: ${mail.subject}`,
        ...mail.text.split('\n').map((line) => `         ${line}`),
        '',
      ].join('\n'),
    );
    return;
  }

  const response = await fetch(webhook(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
    },
    body: JSON.stringify({ from: from(), ...mail }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // Thrown rather than swallowed. A reset somebody never receives and is
    // never told about is worse than one that visibly failed. The body is
    // kept short because providers explain themselves there, and "403" alone
    // tells nobody that the from-address domain is not verified.
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`mail webhook returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
}

/**
 * Send, and never let it fail the thing that asked.
 *
 * For notices — "somebody signed in" — where the request that triggered it
 * has already succeeded, and a mail provider having a bad minute must not
 * turn a successful sign-in into an error.
 */
export function sendQuietly(mail: Mail, what: string): void {
  void sendMail(mail).catch((error: unknown) => {
    console.warn(`[squish] ${what} email not sent:`, error instanceof Error ? error.message : error);
  });
}
