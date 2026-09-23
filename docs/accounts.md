# Identity, backup and accounts

Three layers, added in that order, each one optional and each one working
without the ones above it.

| Layer | What it is | Who has one |
|---|---|---|
| **Device** | An opaque token the browser gets on first use | Everybody, automatically |
| **Backup** | A copy of the diary, kept against the device | Everybody, automatically |
| **Account** | An email and password the backup hangs off instead | Only people who ask |

The whole thing switches off when `DATABASE_URL` is unset. There are then no
devices, no backup and no accounts, and Squish behaves exactly as it did before
any of this existed: diary in the browser, nothing on the server. That is not a
degraded mode to apologise for — it is how Squish runs on a laptop, and it is
what stops a database outage taking the app down.

## Why in this order

A device token solves a problem that exists whether or not anybody signs up:
the rate limit used to count requests per IP address, so everybody on the same
mobile network shared one, and a restart forgave everybody at once.

A backup solves the problem that six weeks of logging lived in one browser's
localStorage, one cleared cache from gone — and the people most likely to clear
it are the ones least likely to know what they lost.

An account solves only what a device cannot: following somebody to a new phone,
and being got back after the old one went in the sea. That is a narrow enough
job that most people should never be asked to do it, which is why the card
leads with "you do not need one".

## Decisions worth keeping

**Photographs are not in the backup.** They live in IndexedDB on the device;
the diary carries a ~5 KB thumbnail of each, and that is what is backed up. The
reason is measured rather than aesthetic: a full-size meal photo is 300 KB, a
browser's localStorage is about 5 MB, and seventeen photographed meals filled
it — the eighteenth could not be saved at all. Thumbnails put a thousand meals
inside the 6 MB backup where nineteen used to fit.

**Backup, not sync.** The browser holds the diary and decides what is true; the
server holds a spare. Nothing the backup does changes what is on the device
without somebody pressing Restore.

**Two diaries are never merged.** Merging food diaries by machine means guessing
whether two similar lunches are one lunch logged twice or two lunches actually
eaten. There is no answer right often enough to apply behind somebody's back.
So a device whose backup is stale is refused with a 409 and shown what it is up
against, and the You screen asks which to keep. The same rule governs signing
in: the diary on the phone moves to the account only when the account has none.

**No session token.** Signing in attaches the account to the device row, and
the device token stays the only credential anything presents. It is already
long-lived, already a bearer credential, and already holds the whole diary; a
second one would only be a second thing to leak and expire.

**Both are stored hashed, differently.** A device token is 32 random bytes with
nothing to guess, so SHA-256 is enough. A password is something a person chose,
which means it is in a list somewhere, so it gets scrypt at N=16384 — and the
cost parameters are stored alongside each hash so they can be raised later
without locking anybody out.

**Wrong password and unknown address are the same answer**, and take the same
time — there is a decoy hash for the second case. An endpoint that says "no such
account" is a tool for finding out who has one.

**Reset links** live two hours, work once, are stored hashed, and are voided by
a password change. Asking to reset an unknown address reports success.

## Sending email

Squish sends three kinds of email — a link to confirm an address, a
password-reset link, and security notices — so there is no SMTP dependency and
no provider baked in. It posts `{ from, to, subject, text }` as JSON with a
bearer token, which is exactly what Resend's `POST /emails` takes:

| Variable | Value |
|---|---|
| `SQUISH_MAIL_WEBHOOK` | `https://api.resend.com/emails` |
| `SQUISH_MAIL_TOKEN` | the provider's API key |
| `SQUISH_MAIL_FROM` | `Squish <hello@squish.online>` — on a domain the provider has verified |

Then press **Send me a test email** in the dashboard. Configured is not the
same as working, and the likeliest failure — the provider not yet trusting the
from-address domain — only shows up when something is sent. The dashboard
passes the provider's own explanation through.

With no webhook set, the email is printed to the server log, loudly, saying it
was not sent, and the app hides everything that depends on somebody receiving
mail. Asking people to click a link that will never arrive is worse than not
asking.

**Confirming an address is soft.** Nothing in the app is withheld from an
unconfirmed account. What it gates is security notices: they only go to a
confirmed address, so nobody can sign up as a stranger and have Squish mail
them. Confirmation links survive being followed more than once, because mail
scanners follow links before people do.

**Security notices** go out on a sign-in, a password change and a reset, name
the device coarsely ("Edge on Windows") and never hold up the request that
triggered them — a mail provider having a bad minute must not turn a
successful sign-in into an error.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | unset | Turns all three layers on |
| `SQUISH_MAIL_WEBHOOK` | unset | Where email is posted |
| `SQUISH_MAIL_TOKEN` | unset | Bearer token for that webhook |
| `SQUISH_MAIL_FROM` | `Squish <no-reply@squish.online>` | The sender, on a domain your provider has verified |
| `SQUISH_PUBLIC_ORIGIN` | from the request | The origin in reset links. Set it to the address people actually use — a custom domain, or anything behind a proxy or a redirect — or the links point at wherever the request appeared to arrive. A trailing slash is fine; it is stripped |
| `SQUISH_DAILY_PHOTOS` | 25 | Per device, per day |
| `SQUISH_DAILY_CHATS` | 40 | Per device, per day |
| `SQUISH_DAILY_RECIPES` | 10 | Per device, per day |
| `SQUISH_DAILY_SIGNINS` | 20 | A brake on guessing, not an allowance |
| `SQUISH_DAILY_RESETS` | 5 | Same |

## Still to do before the app stores

- **A privacy policy.** Squish now stores an email address and a copy of the
  diary. Both stores require a policy URL, and Apple requires the data types to
  be declared on the product page. Account deletion from inside the app is
  done — it is the Delete account button on the You screen.
- **Sign in with Apple.** Required alongside any other third-party sign-in. An
  email and password of our own is not third-party sign-in, so this is not
  needed yet; it becomes required the moment a Google or Facebook button
  appears.
- **Export.** Export JSON on the You screen covers the right-to-portability
  case for now.

## Schema

Migrations are numbered and recorded in a `migrations` table, applied once each
on the first request that needs them.

1. `accounts`, `devices`, `diaries`, `usage`
2. `resets`

A device survives its account being deleted, detached rather than removed, so
deleting an account never leaves somebody unable to log lunch.
