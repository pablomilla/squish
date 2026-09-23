/**
 * Every email Squish sends, in one place, editable from the dashboard.
 *
 * The wording used to live inside four different server files, which meant
 * changing a subject line was a code change and a deploy. It lives here now as
 * a default for each email, and the dashboard can store a replacement for the
 * subject, the body and the button — with "put back the original" always one
 * tap away, because the default never goes anywhere.
 *
 * The parts that differ per person are placeholders — `{link}`, `{device}`,
 * `{time}` — and the rules about them are the point of this file:
 *
 *   - Only the placeholders an email actually has can be used in it. A typo
 *     like `{lnk}` would otherwise go out to people as the literal text.
 *   - Some are required. A password-reset email saved without `{link}` would
 *     be a reset nobody can use, so it cannot be saved.
 *
 * Each email goes out twice over: a branded HTML version and a plain-text one
 * beside it, for mail apps that do not show designs and for anybody who has
 * images and styling turned off.
 */
import { hasDatabase, migrate, query } from './db';

export type EmailKey = 'verify' | 'reset' | 'signin' | 'password-changed' | 'password-reset' | 'test';

export interface Placeholder {
  name: string;
  /** What it becomes, said for the person editing. */
  about: string;
  /** What the preview and test sends fill it with. */
  sample: string;
  /** Rendered as a link in the HTML version. */
  url?: boolean;
}

export interface EmailDefinition {
  key: EmailKey;
  label: string;
  /** When it is sent, for the dashboard. */
  when: string;
  subject: string;
  body: string;
  /**
   * The one thing somebody is meant to do. When its placeholder sits on a
   * line of its own, the HTML version draws it as a button.
   */
  button: { placeholder: string; label: string; fallback: boolean } | null;
  placeholders: Placeholder[];
  required: string[];
}

const LINK = (about: string, sample: string): Placeholder => ({ name: 'link', about, sample, url: true });
const APP: Placeholder = {
  name: 'app_link',
  about: 'The address of Squish itself',
  sample: 'https://squish.online',
  url: true,
};
const TIME: Placeholder = {
  name: 'time',
  about: 'When it happened, in UK time',
  sample: 'Wednesday 23 September at 09:41 (UK time)',
};

const IF_NOT_YOU =
  "If it wasn't, reset your password from the sign-in screen straight away. Resetting signs out every device, including whoever did this.";

export const EMAILS: Record<EmailKey, EmailDefinition> = {
  verify: {
    key: 'verify',
    label: 'Confirm your email',
    when: 'When somebody makes an account, or asks for the link again',
    subject: 'Confirm your email for Squish',
    body: [
      'Somebody — hopefully you — made a Squish account with this address.',
      '',
      'To confirm it is yours:',
      '',
      '{link}',
      '',
      'That link works for {days} days.',
      '',
      "If you didn't make an account, you can ignore this. Nothing more will be sent to you unless somebody follows the link.",
    ].join('\n'),
    button: { placeholder: 'link', label: 'Confirm my email', fallback: true },
    placeholders: [
      LINK('The confirmation link', 'https://squish.online/verify?token=example'),
      { name: 'days', about: 'How many days the link works for', sample: '7' },
    ],
    required: ['link'],
  },

  reset: {
    key: 'reset',
    label: 'Reset your password',
    when: 'When somebody asks to reset a forgotten password',
    subject: 'Reset your Squish password',
    body: [
      'Somebody asked to reset the password on this Squish account.',
      '',
      '{link}',
      '',
      'That link works for {hours} hours and once only.',
      '',
      "If it wasn't you, nothing has happened and you can ignore this.",
    ].join('\n'),
    button: { placeholder: 'link', label: 'Choose a new password', fallback: true },
    placeholders: [
      LINK('The reset link', 'https://squish.online/reset?token=example'),
      { name: 'hours', about: 'How many hours the link works for', sample: '2' },
    ],
    required: ['link'],
  },

  signin: {
    key: 'signin',
    label: 'New sign-in',
    when: 'When an account is signed into — only to confirmed addresses',
    subject: 'New sign-in to Squish',
    body: [
      'Your Squish account was signed into on {device}, {time}.',
      '',
      'If that was you, there is nothing to do.',
      '',
      IF_NOT_YOU,
      '',
      '{app_link}',
    ].join('\n'),
    button: { placeholder: 'app_link', label: 'Open Squish', fallback: false },
    placeholders: [
      { name: 'device', about: 'Roughly what signed in, e.g. "Safari on iPhone"', sample: 'Safari on iPhone' },
      TIME,
      APP,
    ],
    required: [],
  },

  'password-changed': {
    key: 'password-changed',
    label: 'Password changed',
    when: 'When somebody changes their password — only to confirmed addresses',
    subject: 'Your Squish password was changed',
    body: [
      'The password on your Squish account was changed on {time}.',
      'Every other device that was signed in has been signed out.',
      '',
      'If that was you, there is nothing to do.',
      '',
      IF_NOT_YOU,
      '',
      '{app_link}',
    ].join('\n'),
    button: { placeholder: 'app_link', label: 'Open Squish', fallback: false },
    placeholders: [TIME, APP],
    required: [],
  },

  'password-reset': {
    key: 'password-reset',
    label: 'Password reset',
    when: 'When a reset link is used — only to confirmed addresses',
    subject: 'Your Squish password was reset',
    body: [
      'The password on your Squish account was reset on {time}.',
      'Every device that was signed in has been signed out.',
      '',
      'If that was you, there is nothing to do.',
      '',
      IF_NOT_YOU,
      '',
      '{app_link}',
    ].join('\n'),
    button: { placeholder: 'app_link', label: 'Open Squish', fallback: false },
    placeholders: [TIME, APP],
    required: [],
  },

  test: {
    key: 'test',
    label: 'Test email',
    when: 'When you press "Send me a test email" in the dashboard',
    subject: 'Squish can send email',
    body: [
      'This is the test email from the Squish dashboard.',
      '',
      'If you are reading it, confirmation links, password resets and security notices will reach people too.',
    ].join('\n'),
    button: null,
    placeholders: [],
    required: [],
  },
};

export const isEmailKey = (key: string): key is EmailKey => Object.hasOwn(EMAILS, key);

export interface Wording {
  subject: string;
  body: string;
  /** Null for an email with no button. */
  buttonLabel: string | null;
}

export const defaultWording = (definition: EmailDefinition): Wording => ({
  subject: definition.subject,
  body: definition.body,
  buttonLabel: definition.button?.label ?? null,
});

const PLACEHOLDER = /\{([a-zA-Z_]+)\}/g;

/**
 * Everything wrong with a proposed wording, in sentences for the person
 * editing. Empty means it can be saved.
 */
export function problemsWith(definition: EmailDefinition, wording: Wording): string[] {
  const problems: string[] = [];
  const subject = wording.subject ?? '';
  const body = wording.body ?? '';

  if (!subject.trim()) problems.push('The subject cannot be empty.');
  if (subject.length > 150) problems.push('The subject is over 150 characters, and most inboxes will cut it off.');
  if (/[\r\n]/.test(subject)) problems.push('The subject has to be on one line.');
  if (!body.trim()) problems.push('The email cannot be empty.');
  if (body.length > 5000) problems.push('The email is over 5,000 characters. Nobody reads that far.');

  if (definition.button) {
    const label = wording.buttonLabel ?? '';
    if (!label.trim()) problems.push('The button needs some words on it.');
    if (label.length > 40) problems.push('The button text is over 40 characters, which will not fit on a phone.');
  }

  const known = new Set(definition.placeholders.map((p) => p.name));
  const used = [...`${subject}\n${body}`.matchAll(PLACEHOLDER)].map((m) => m[1]);
  const unknown = [...new Set(used.filter((name) => !known.has(name)))];
  if (unknown.length) {
    const can = definition.placeholders.map((p) => `{${p.name}}`).join(', ');
    problems.push(
      `${unknown.map((name) => `{${name}}`).join(', ')} ${unknown.length === 1 ? "isn't" : "aren't"} something Squish can fill in here. ${
        can ? `This email can use ${can}.` : 'This email has nothing to fill in.'
      }`,
    );
  }

  for (const name of definition.required) {
    if (!body.includes(`{${name}}`)) {
      problems.push(`The email has to include {${name}} — without it, nobody can do what the email is for.`);
    }
  }

  return problems;
}

/* ------------------------------------------------------------------ *
 * Stored wording
 * ------------------------------------------------------------------ */

/** The wording in force: the dashboard's, or the default where there is none. */
export async function wordingFor(key: EmailKey): Promise<{ wording: Wording; customised: boolean }> {
  const definition = EMAILS[key];
  if (!hasDatabase()) return { wording: defaultWording(definition), customised: false };

  try {
    await migrate();
    const rows = await query<{ subject: string; body: string; button_label: string | null }>(
      'select subject, body, button_label from email_templates where key = $1',
      [key],
    );
    const saved = rows[0];
    if (!saved) return { wording: defaultWording(definition), customised: false };

    const wording = { subject: saved.subject, body: saved.body, buttonLabel: saved.button_label };
    // Checked again on the way out, not only on the way in. If a later
    // version of Squish renames or requires a placeholder, a wording saved
    // before then must fall back to the default rather than send a reset
    // email with no link in it.
    if (problemsWith(definition, wording).length) {
      console.warn(`[squish] saved wording for the "${key}" email no longer fits; sending the default`);
      return { wording: defaultWording(definition), customised: false };
    }
    return { wording, customised: true };
  } catch {
    // An email somebody is waiting for must not fail because the store of
    // customisations could not be read.
    return { wording: defaultWording(definition), customised: false };
  }
}

export async function saveWording(key: EmailKey, wording: Wording, by: string): Promise<string[]> {
  const problems = problemsWith(EMAILS[key], wording);
  if (problems.length) return problems;

  await migrate();
  await query(
    `insert into email_templates (key, subject, body, button_label, updated_by)
     values ($1, $2, $3, $4, $5)
     on conflict (key) do update
       set subject = excluded.subject, body = excluded.body, button_label = excluded.button_label,
           updated_by = excluded.updated_by, updated_at = now()`,
    [key, wording.subject.trim(), wording.body.replace(/\s+$/, ''), wording.buttonLabel?.trim() || null, by],
  );
  await query('insert into admin_actions (admin, action, subject) values ($1, $2, $3)', [by, 'edit email', key]);
  return [];
}

export async function resetWording(key: EmailKey, by: string): Promise<void> {
  await migrate();
  await query('delete from email_templates where key = $1', [key]);
  await query('insert into admin_actions (admin, action, subject) values ($1, $2, $3)', [by, 'reset email', key]);
}

export async function listWording(): Promise<
  (EmailDefinition & { original: Wording; current: Wording; customised: boolean; updatedAt: string | null; updatedBy: string | null })[]
> {
  const saved = new Map<string, { updated_at: Date; updated_by: string | null }>();
  if (hasDatabase()) {
    await migrate();
    const rows = await query<{ key: string; updated_at: Date; updated_by: string | null }>(
      'select key, updated_at, updated_by from email_templates',
    );
    for (const row of rows) saved.set(row.key, row);
  }

  return Promise.all(
    Object.values(EMAILS).map(async (definition) => {
      const { wording, customised } = await wordingFor(definition.key);
      const row = saved.get(definition.key);
      return {
        ...definition,
        original: defaultWording(definition),
        current: wording,
        customised,
        updatedAt: customised && row ? row.updated_at.toISOString() : null,
        updatedBy: customised && row ? row.updated_by : null,
      };
    }),
  );
}

/** Sample values for every placeholder, for previews and test sends. */
export const samplesFor = (definition: EmailDefinition): Record<string, string> =>
  Object.fromEntries(definition.placeholders.map((p) => [p.name, p.sample]));

/* ------------------------------------------------------------------ *
 * Composing one
 * ------------------------------------------------------------------ */

/**
 * The public address of Squish, for the header image and the footer links.
 *
 * Taken from the link being sent where there is one, since that was built from
 * the request and is right by definition; otherwise the configured origin.
 */
export function originOf(link?: string): string {
  if (link) {
    try {
      return new URL(link).origin;
    } catch {
      /* not a URL — fall through */
    }
  }
  return (process.env.SQUISH_PUBLIC_ORIGIN?.trim() || 'https://squish.online').replace(/\/$/, '');
}

/** An email ready to hand to sendMail: the wording in force, filled in, both versions. */
export async function compose(
  key: EmailKey,
  to: string,
  values: Record<string, string>,
  origin: string,
): Promise<{ to: string; subject: string; text: string; html: string }> {
  const { renderEmail } = await import('./emailRender');
  const { wording } = await wordingFor(key);
  return { to, ...renderEmail(EMAILS[key], wording, values, origin) };
}
