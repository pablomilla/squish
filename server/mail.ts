/**
 * Sending an email, or being honest about not sending one.
 *
 * Squish needs to send exactly one kind of email — a password reset link — and
 * that is not enough to justify an SMTP dependency, an API key for a sending
 * provider, or a decision about which one. So this is an interface with two
 * implementations: post it somewhere, or write it to the log.
 *
 * The log one is not a stub to be replaced later. It is what runs in
 * development and on anybody's laptop, and a reset link printed on the console
 * is a working password reset for the person who can read that console. What
 * it must never do is fail silently in a way that looks like success, which is
 * why it says loudly what it did.
 *
 * To send real email, set SQUISH_MAIL_WEBHOOK to something that accepts a
 * JSON post of { to, subject, text }. Any transactional provider will, either
 * directly or behind three lines of glue, and swapping providers then means
 * changing an environment variable rather than this file.
 */
const WEBHOOK = process.env.SQUISH_MAIL_WEBHOOK?.trim();
const TOKEN = process.env.SQUISH_MAIL_TOKEN?.trim();

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** True when mail actually leaves the building. */
export const canSendMail = (): boolean => Boolean(WEBHOOK);

export async function sendMail(mail: Mail): Promise<void> {
  if (!WEBHOOK) {
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

  const response = await fetch(WEBHOOK, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    body: JSON.stringify(mail),
  });

  if (!response.ok) {
    // Thrown rather than swallowed. A reset somebody never receives and is
    // never told about is worse than one that visibly failed.
    throw new Error(`mail webhook returned ${response.status}`);
  }
}
