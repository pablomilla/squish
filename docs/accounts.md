# Identity, backup and accounts

Three layers, added in that order, each one optional and each one working
without the ones above it.

| Layer | What it is | Who has one |
|---|---|---|
| **Device** | An opaque token the browser gets on first use | Everybody, automatically |
| **Backup** | A copy of the diary, kept against the device | Everybody, automatically |
| **Account** | An email and password — or a Google or Apple account — the backup hangs off instead | Only people who ask (offered at the end of onboarding) |

The whole thing switches off when `DATABASE_URL` is unset. There are then no
devices, no backup and no accounts, and Squish behaves exactly as it did before
any of this existed: diary in the browser, nothing on the server. That is not a
degraded mode to apologise for — it is how Squish runs on a laptop, and it is
what stops a database outage taking the app down.

Signing in with Google or Apple is set up separately, and each is offered
only once its client ID is in the environment: see
[sign-in-with.md](sign-in-with.md).

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

**Five devices at once.** (Since 3 October 2026, part of fair use — see
docs/monetisation.md.) Signing in on a sixth device signs out the one used
longest ago (`keepNewestDevices` in `server/fairUse.ts`, on password and on
Google or Apple sign-in), detaching it as signing out everywhere does: it goes
on working as a device of its own. The new device is never the one refused.
`SQUISH_MAX_DEVICES` changes the number.

**Every signed-in device kept in step.** (Since 1 October 2026; before, it was a
backup only, and two phones in use stopped it.) Each device still holds the
diary and works without a network; the server holds the account's copy. A
device that saves without having seen the latest is still refused with a 409
and handed it — and now merges it in (`src/lib/sync.ts`) and saves both,
rather than stopping. It also asks the server whether anything has changed when
the app opens, comes back to the front or back online, and every three minutes
while open (`GET /api/diary?known=N`, answered in a few bytes when nothing has),
and takes the newer copy as it is when nothing has changed on the device.

**What changed, not the whole diary.** (Since 2 October 2026.) A device in
step sends only the parts it changed since its last save — a lunch is a few
hundred bytes where the diary is hundreds of kilobytes — as
`PATCH /api/diary` with the version it was in step with (`base`), and asks
for what changed since its version with `GET /api/diary/changes?since=N`.
The parts are the ones `src/lib/sync.ts` merges by (`changeOf`); the server
puts them into its copy by the same rules (`applyChange`): the later change
wins, a deletion wins over a change at the same moment, and two devices
saving from the same version are both kept rather than one being refused. The
answer is what other devices changed since `base`, plus anything the device
sent that the server did not take (its copy was later), so the device is in
step after one request. Past chats, not parts, are sent whole when they
change and merged on the server by their own rules; `null` stops keeping them.

To answer "since N", each diary keeps the version each part last changed in
(`part_versions`, worked out on every write by comparing the parts' times
before and after) and the version since which that is known (`parts_from`).
A device further behind than that is sent the whole diary, as before: one
written before this existed, until it is next written; one behind a deletion
let go of after four months, which parts can no longer tell it about; and one
behind a whole diary written by an app that kept no times. A device that has
not been in step with this account's diary (just signed in, holding its own)
still sends the whole diary and asks first; so does one after "Combine both"
or "Keep this device's". A server from before this answers 404, and the app
goes back to whole diaries until it is next opened. The 6 MB limit is on the
diary as stored, however it was sent.

**Told at once, while open.** (Since 1 October 2026.) A device saves two
seconds after the last change (`QUIET_MS`), and at once when put away. While
the app is on screen it holds one request open, `GET /api/diary/live`
(server-sent events, read with `fetch` so the device token goes in the
`Authorization` header as everywhere else), and the server writes the diary's
version down it as the line opens and each time the account's diary is saved
(`server/live.ts`). A version newer than the device's own is its cue to check
as above, so another device open beside it shows a change in about two
seconds. The line carries the version number and nothing else.

Saves are announced with Postgres `NOTIFY` on `squish_diary`, and each
instance `LISTEN`s on a connection of its own (`listen` in `server/db.ts`,
reopened if it drops), so a save on one instance reaches devices held open by
another. With that connection down, an instance still tells its own. The line
is closed when the app is put away (a phone would pause it anyway) and
reopened when it comes back, comes back online, or signs in or out; after 20
minutes, and on shutdown, the server closes it and the app reconnects. A
comment every 25 seconds keeps proxies from dropping it as idle. One person
keeps at most ten lines, the oldest going first, and an instance at most
5,000; past that the app is turned away and checks every three minutes, which
is all it did before.

**Merging is not guessing.** Every meal, plan, recipe and shopping line has an
id, so a lunch logged on each device is two lunches, whatever they are called.
The diary is merged part by part — things with ids, days by date, badges, sets
of words, and each setting's fields — and beside it go the times each part last
changed and when it was deleted, found by comparing the diary with itself, so
nothing that changes the diary has to remember to say so. Same on both: kept.
On one only: kept, unless the other deleted it after it last changed.
Different: the later change. Full-size photos are not part of it: other
devices show the thumbnail.

Past chats with the nutritionist (where they are backed up) are merged by
their own rules: the same chat on both keeps the one carried on further. A
chat somebody deletes is noted with its id and when (`chatsGone`, kept for
four months), carried with the diary whether or not chats are backed up, and
deleted on every device that has it; no device takes it back from a copy that
still does. Chats let go by the limits (90 days, 30 chats) are not noted:
every device lets them go by itself. A chat carried on after another device
deleted it — open at the time, or carried on offline before the deletion
arrived — is not lost: it carries on as a new chat, everything said so far
included, and reaches the other devices like any other.

**Two different people's diaries are never merged without asking.** A device
that has just signed in (or out), holding a diary of its own, is not merged
with the diary the server holds for it until something settles it — when both
are real diaries. It is the switch that asks, not a missing version: a device
can lose its version (a save cut off by the page closing) and still be
talking to its own diary. In that case: the You screen asks whether to use the account's, keep the
device's, or combine both. Signing in where the account has no diary still
moves the device's diary to it, as before.

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
no provider baked in. It posts `{ from, to, subject, text, html }` as JSON with
a bearer token, which is exactly what Resend's `POST /emails` takes:

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

### Changing what the emails say

Open **You → Dashboard → Email wording** and press **Edit** on any email. The
subject, the button and the message can all be changed; the preview underneath
redraws as you type, filled in with made-up details. **Send me this version**
sends the unsaved draft to you, marked `[Test]`, so it can be seen in a real
inbox before anybody else gets it. **Put back the original** is always there,
because the original wording lives in `server/emails.ts` and never goes away.

The parts that differ per person are placeholders — `{link}`, `{device}`,
`{time}` and so on. Each email lists the ones it can use, and tapping one puts
it where the cursor is. Two rules keep an edit from breaking an email:

- A placeholder the email does not have is refused, so a typo like `{lnk}`
  never reaches anybody as literal text.
- Some are required. A reset email without `{link}` is a reset nobody can use,
  so it will not save.

Those rules are checked on the server when saving, and again when sending, so
wording that somehow became invalid falls back to the original rather than
going out broken.

### What they look like

Every email goes out twice over: a designed HTML version and a plain-text copy
beside it, for mail apps that do not show designs. The HTML is built the way
email has to be — tables, inline styles, no scripts, no web fonts — with the
Squish icon and name at the top (the name is real text, so it still reads with
images turned off). When the button's placeholder sits on a line of its own it
is drawn as a button, with the plain address underneath for when a button
will not click.

The footer — the company name and address and the privacy link — is not
editable. It is what the law asks every email to carry.

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
3. `accounts.plus_until`
4. `invite_uses`
5. `usage.cost_usd`, `admin_actions`
6. `invites`
7. `accounts.email_verified_at`, `verifications`
8. `email_templates` — wording changed from the dashboard; no row means the original
9. `admin_totp`, `admin_recovery_codes`, `admin_sessions` — the dashboard's second step

A device survives its account being deleted, detached rather than removed, so
deleting an account never leaves somebody unable to log lunch.
