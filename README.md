# Squish 🫧

**Your little health buddy.** Smarter nutrition, happier habits — an AI food tracker in the spirit of
BitePal and Yazio, wrapped around a small round mascot who is relentlessly kind about what you ate.

Snap a photo of your plate, and Claude identifies the foods, estimates the portions and returns
calories, macros and fibre. Everything else — diary, targets, streaks, habits, weight trend — works
the way a nutrition app should, and works offline too.

## What it does

**Logging**
- 📸 **Photo analysis** — point the camera at a meal; Claude Opus 5 vision returns each food, its
  portion and its nutrition as structured JSON, plus a note in Squish's voice.
- ✍️ **Describe it** — "two scrambled eggs on toast and a latte" becomes a full breakdown.
- 🔍 **Food search** — 80+ everyday foods with per-100 g data, serving sizes and emoji.
- ⚡ **Quick add** and ❤️ **favourites** for the meals you eat every week.
- Every analysis lands on a review screen where portions are adjustable, items removable and
  nothing is saved until you say so. Save sits in a bar that stays put while the rest scrolls, and
  a meal you leave without saving is held as an **unfinished meal** on Home rather than binned —
  offered back, never logged for you.

**Tracking**
- Daily calorie ring, macro bars against target, and an energy split (protein / carbs / fat).
- Diary by day and meal slot, with water, steps and weight.
- A 0–100 diet-quality score per meal and per day — protein and fibre density lift it, heavy added
  sugar, fat load and sodium pull it down.

**Progress**
- Weekly / monthly / all-time charts with a target line, a table view and per-day readouts.
- Logging streak, four daily habits, nine achievements, weight trend against your goal.
- "You eat a lot of…" — your most repeated foods over the range.

**Squish Nutritionist**
- A conversation about your own diary that starts by reading it. It has tools — day totals, a meal
  search, and an averages-against-targets report covering the six vitamins and minerals Squish
  tracks — and it uses them before answering, so "how were my weekends?" is about your weekends.
- Every lookup is shown as it happens and stays above the answer, so you can see what was read.
- It keeps a short memory: an allergy, a food you will not eat, what you are training for. It writes
  those notes itself, they travel with each question, and you can delete any of them from the chat
  or from **You → What the nutritionist remembers**.
- Safety rules are part of the prompt and tested: no diagnosis, no target under the app's own
  calorie floors, no skipping meals or fasting or cutting out a food group, and anything that sounds
  like distress ends at Beat rather than at a macro split.

**Your plan**
- Mifflin–St Jeor BMR × activity, adjusted by goal and pace, with a safe calorie floor.
- Protein scaled to body weight, fat at 28% of energy, fibre at 14 g per 1000 kcal.
- Every target is overridable if a coach or dietitian set your numbers.

Data lives in `localStorage` — nothing leaves the device except the photo or description you
choose to analyse. Export the lot as JSON from **You → Your data**.

## Running it

Needs **Node 20.19+ or 22.12+** (Vite 8's floor) — check with `node -v`, and grab a current release
from [nodejs.org](https://nodejs.org) or `nvm install 22` if yours is older.

```bash
git clone https://github.com/pablomilla/squish.git
cd squish
npm install
npm run dev          # web on :5173, API on :8787
```

Then open http://localhost:5173. Every command below assumes you are inside the `squish` folder.

### Turning on the real photo analysis

Photo and text analysis need an Anthropic API key. It goes on the **server** — the browser never
sees it.

1. Sign in at [console.anthropic.com](https://console.anthropic.com) and put credit on the account
   (**Billing** → buy credits; the API is prepaid and separate from a Claude.ai subscription).
2. **Settings → API keys → Create key**. Copy it there and then — it is shown once. Keys look like
   `sk-ant-api03-…`.
3. Hand it to the setup script:

   ```bash
   npm run setup:ai
   ```

   It prompts for the key without echoing it, spends one token checking that it actually works,
   and only then writes `.env` with owner-only permissions. Passing a key as a command argument
   would put it in your shell history, so the script does not accept one.

`npm run check:ai` re-checks whatever is configured at any time. Both tell you *which* thing is
wrong — key rejected, no credit on the account, model not available to the workspace, network
unreachable — rather than a bare failure. Prefer editing by hand? `cp .env.example .env` and fill
in `ANTHROPIC_API_KEY` works exactly the same; `npm run dev` loads `.env` through Node's
`--env-file-if-exists`.

`.env` is gitignored — keep it that way, and rotate the key in the console if one ever lands in a
commit. If you already use the `ant` CLI, `ant auth login` works too: the SDK falls back to that
profile when no key is set, and a key in the environment takes precedence over it.

**Workload identity federation** works without any code change: set `ANTHROPIC_FEDERATION_RULE_ID`,
`ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID` and `ANTHROPIC_IDENTITY_TOKEN_FILE`
instead of a key, and the SDK exchanges the host-issued token itself. Worth moving to once the host
can mint one — a short-lived, auto-rotating credential is worth far less to a thief than a key
sitting in a dashboard. Note an API key in the environment outranks federation, so remove it when
you switch.

You can confirm the mode three ways: the API server prints it on startup, `curl
localhost:8787/api/health` returns `"ai": true`, and **You → Squish AI** shows *Connected* with the
model name.

Without any credentials the app still runs end to end: the API server falls back to a local
estimator built on the bundled food table, and anything it produces is labelled **Offline estimate**
in the UI rather than passed off as a real analysis. The same fallback catches a bad key, an outage
or a rate limit at request time, with the reason logged server-side.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server + API server together |
| `npm run setup:ai` | Prompt for an Anthropic key, verify it, write `.env` |
| `npm run check:ai` | Check whatever credentials are configured |
| `npm run build` | Typecheck and build the PWA to `dist/` |
| `npm test` | Unit tests for the nutrition maths, estimator and selectors |
| `npm run lint` | oxlint over app, server and tests |
| `npm run typecheck` | `tsc -b` across both projects |

## Putting it online

The server serves the built app as well as the API, so it deploys as one service. There are two
ways to put it on Render, and it matters which you used.

**As a blueprint** — **New → Blueprint → pick this repo**. Render reads `render.yaml`, creates the
web service and its Postgres together, and asks for the secrets rather than you editing any files.
Everything below is then set for you.

**By hand** — **New → Web Service**. `render.yaml` is never read, and the settings below have to be
typed into the service's **Environment** tab in the dashboard. A database has to be created
separately (**New → Postgres**, same region) and its *Internal Database URL* pasted in as
`DATABASE_URL`.

If the dashboard's **Blueprints** list is empty, it was by hand.

| Setting | What it is |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your key. Lives in the host's dashboard, never in the repo. |
| `SQUISH_FREE_TASTE` | AI analyses a free account gets to try, once — not monthly. Default 5. |
| `SQUISH_PLUS_PHOTOS` | And on Squish Plus. Default 60. |
| `SQUISH_PLUS_CHATS` | Nutritionist questions a month on Plus. Default 30. |
| `SQUISH_PLUS_RECIPES` | Recipe imports a month on Plus. Default 10 — the dearest thing Squish does. |
| `SQUISH_RATE_LIMIT` | Analyses per visitor per hour, default 80. A backstop on the bill. |
| `DATABASE_URL` | Filled in by the blueprint from the Postgres it creates. Turns on backup and accounts. Delete both and Squish stays local. |
| `SQUISH_PUBLIC_ORIGIN` | Where the app lives — `https://app.squish.online`. Links in emails point here. |
| `SQUISH_SITE_ORIGIN` | Where the website lives — `https://squish.online`. Unset, every address serves the app. |

What stops a stranger spending your Anthropic credit is the free plan's monthly allowance, counted
per person against the database. There is no shared passcode: it was a stopgap from before there
were accounts, and it made the app impossible to hand to a tester. Render's free tier sleeps after
inactivity, so the first visit takes ~50s to wake — which is what the waking screen is for.

### The website, and the app at app.squish.online

One service answers two addresses. **squish.online** is the website — plain HTML in `site/`, no
cookies, no analytics, not even a font from anybody else — and **app.squish.online** is the app.
`server/site.ts` tells them apart by the address asked for, and only once `SQUISH_SITE_ORIGIN` is
set; until then every address gets the app, so the code can go out before the switch.

Moving there, in order:

1. **Render → the web service → Settings → Custom Domains → Add** `app.squish.online`. Render
   shows a DNS record (a CNAME); add it where the domain is registered, and wait for Render to say
   it is verified and the certificate is issued.
2. Open **https://app.squish.online** and check the app works there.
3. **Environment**: set `SQUISH_PUBLIC_ORIGIN` to `https://app.squish.online` and add
   `SQUISH_SITE_ORIGIN` = `https://squish.online`. Save; Render redeploys.
4. **squish.online** now shows the website. `www.squish.online` (if added as a domain) redirects to
   it; reset links in emails sent before the move are forwarded to the app with their token.

Anybody who used the app at squish.online without an account still has their diary in that
browser, at that address. The website sees it there and offers **Take my diary with me**: it saves
the diary to the server, asks for a one-time code for that browser's device, and sends them to the
app with the code after a `#`. The app trades it for the same device with a new token, so the diary
— and the account, if they had one — arrives with them. Codes last ten minutes and work once
(`server/identity.ts`, `site/move.js`).

The screenshots on the website are the real app with made-up meals in it: `scripts/site-shots.mjs`
retakes them, and `npm run build:site-art` re-exports the mascot and wordmark from the app's artwork.

### Free and Plus

The line between them falls out of what each action costs to serve, not out of preference, and the
arithmetic is in [`docs/monetisation.md`](docs/monetisation.md). Free is everything that is nearly
free to run — logging by hand, food search, the diary, charts, streaks, the earned colourways and
accessories, export — plus a one-off taste of the AI: 5 analyses, with a free account, that never reset. Plus
is the part with a bill attached: AI meal analyses, the nutritionist, recipe imports and the Plus
colourways and accessories.

The taste is once rather than monthly on purpose. A monthly free allowance is a bill that grows
with every free user who never pays, and with a few per cent converting it cost more than the
subscribers' own AI. It needs an account so that clearing a browser is not a fresh taste, and it is
also counted per browser, so a second account in the same one does not start it again.

Plus has an allowance too. A heavy user costs more per month than Plus charges, so without a ceiling
the best customers would be the ones losing the most money.

### The dashboard

Set `SQUISH_ADMIN_EMAILS` to your own address, sign in normally, and **You → Dashboard** opens the
back office — a menu down the side on a laptop, tabs along the top on a phone:

- **Overview** — active people, new accounts, Plus, monthly recurring revenue, AI cost and this
  month's profit, each against the period before; charts of active people and AI cost a day; and
  alerts for anything that wants doing (email not set up, recovery codes running low, a spike in AI
  spend, money owed to affiliates). It refreshes itself every minute.
- **Money** — a profit and loss statement for any month (sales, VAT, store fees, refunds, affiliate
  commission, AI by feature, fixed costs), six months of profit or loss, paying subscribers and
  break-even, the list of fixed costs (edit it as prices change) and the numbers the sums use:
  prices, VAT, the store's cut and the exchange rate.
- **People** — sign-ups a day, the plan split, the funnel from account to free taste to paying, the
  list of people with buttons to grant or revoke Plus, and invite codes.
- **AI usage** — cost a day by feature, analyses a day, and the cost of each call.
- **Affiliates** — see below.
- **Settings** — email, the wording of every email, two-step sign-in, and a record of everything
  done from the dashboard and by whom.

Every chart can be hovered for exact values or switched to a table. Revenue comes only from the
`payments` table, which the App Store and Google Play integration will write to when Plus goes on
sale; until then the dashboard shows nought and says why, and the one guess it makes is labelled a
projection. "Active" is counted from the day this version is deployed — there is no earlier record.

There is no admin password. An admin signs in exactly as everybody else does — same hashing, same
rate limit — and the list decides whether they also see this, so removing an address is the whole of
revoking someone. With the variable unset, nobody is an admin and the routes answer 404 to
everybody, including you.

**It also asks for a code from an authenticator app.** The first time you open it, it walks you
through scanning a QR code with any authenticator app (Google or Microsoft Authenticator, 1Password,
the iPhone's Passwords app) and gives you ten one-time recovery codes to keep somewhere safe. After
that, each device asks for a six-digit code every 12 hours; **Lock** at the top ends it sooner. A
password alone gets nothing from the dashboard's routes — not the numbers, not the people, not the
power to grant Plus.

Lost the phone? Use a recovery code, then **Make new recovery codes** inside. Lost the codes too?
From Render's **Shell** tab on the web service:

```bash
npm run reset-2fa -- you@example.com
```

and you will be asked to set it up again next time. That is deliberately something only somebody
with the Render login can do.

**It cannot read anybody's diary**, and the server would not serve one if it asked. Counts and
totals only; there is a test that fails if `server/admin.ts` ever learns the word `diaries`.

Costs shown are what Anthropic actually charged, accumulated per call — not counts multiplied by an
assumed price. That is what makes "is Plus priced right?" a measurement rather than an opinion.

**The easy way to hand out Plus** is an invite code, made in the dashboard. Give it a length, a
limit on how many people can use it and a note saying who it is for; the dashboard suggests a code
that avoids characters people misread down a phone. Testers make an account, open **You → Plan and
usage → I have a code**, and they are on Plus.

Codes are compared loosely, so case and stray spaces do not matter. One per account, redemptions are
recorded and counted, wrong guesses are rate limited, and a use limit holds even if five people tap
at the same moment. Turning one off takes effect at once. Deleting one does **not** take back what it
bought — deleting a coupon is not a way to un-sell something — and a code extends whatever somebody
has rather than replacing it, so giving one to a paying subscriber never costs them time.

### Affiliates

Built in rather than bought: affiliate services track card payments through Stripe, and Squish is
paid through the App Store and Google Play, which tell nobody where a customer came from. So each
affiliate, added under **Dashboard → Affiliates**, gets a code and a link — `squish.online/r/CODE`.
Following it counts a visit and opens the app with the code, which the browser keeps for 30 days; an
account made in that time is credited to that affiliate for good (the first one only). When the
account pays, the affiliate earns their share — 30% for 12 months unless you set other terms — of
what reaches Industry Logic after VAT and the store's fee. Pay them by bank transfer, then **Record a
payment**, and what they are owed comes down.

**Partners have a page of their own** at `app.squish.online/partners` (the website's footer links to
it). They sign in with the email address you gave them: the page emails a link that works once, for
30 minutes, and the session lasts 30 days. From the dashboard you can also **Email them a sign-in
link** or **Copy a sign-in link** (works once, for 3 days) to send however you talk to them. Their
page shows their link, visits and sign-ups a day, subscribers, earnings by month, the payments you
have recorded — and the rules for sharing it (say it is an ad, no health claims, adults only). Never
who signed up, and never your private note about them; payout notes they do see. One email address
per partner, and changing it signs them out.

There is also a script, for one-off fixes and for seeing the state of things:

```bash
npm run grant -- someone@example.com        # a year
npm run grant -- someone@example.com 30     # thirty days
npm run grant -- someone@example.com off    # back to free
npm run grant -- --list                     # who is on it
```

It needs `DATABASE_URL`, so on Render run it from the service's shell.

### Meal reminders

Reminders are the phone app's job. The device holds the schedule and fires on
time whether or not Squish is open, with no signal and no server involved —
which is the whole reason they waited for the Capacitor wrap.

The web version needed the opposite of all that: VAPID keys, a subscription
store, and a server awake at breakfast. Render's free instance sleeps after
fifteen minutes of no traffic, so an 8am nudge would have needed a paid one;
the subscriptions lived in a JSON file that a deploy wiped; and on an iPhone
none of it worked at all unless Squish had been added to the home screen. All
of that is deleted rather than carried.

In a browser the card on **You** says so, which is the honest answer rather
than a switch that half works. See [`docs/phone-app.md`](docs/phone-app.md).

### Backup and accounts

Without a `DATABASE_URL` the diary lives in the browser and nowhere else, which
is how Squish has always worked and still works. Point `DATABASE_URL` at a
Postgres and three things switch on, in this order:

- **A device token**, automatically, so the daily allowance is counted per phone
  rather than per IP address — everybody on the same mobile network used to
  share one.
- **A backup** of the diary, automatically, so a cleared browser or a lost phone
  is an inconvenience rather than the end of six weeks of logging. It is a
  backup and not a sync: Restore is a button, never a behaviour.
- **An account**, only if somebody asks for one. It does the one thing a device
  cannot — follow them to a new phone.

Squish will not merge two diaries. Whether it is two phones backing up or
somebody signing in where the account already has one, it stops and asks which
to keep, because merging means guessing whether two similar lunches are one
lunch logged twice. See [`docs/accounts.md`](docs/accounts.md), which also
covers reset emails, the schema, and what is still missing before the app
stores.

## How the AI part works

`server/claude.ts` sends the image (or description) to `claude-opus-5` with
`output_config.format` set to a JSON schema, so the response is already the shape the app needs —
no prose parsing. Adaptive thinking is on; effort is `medium` for analysis and `low` for the daily
coach nudge. Values are coerced and clamped on the way in, and a model-supplied quality score is
only trusted when it is present and sane, otherwise the local scorer runs.

The key stays on the server, and each analysis endpoint degrades to the offline estimator rather
than failing.

**The nutritionist runs its tools in the browser.** It is the one unusual piece of architecture in
here, and it follows from where the food lives: every diary is in `localStorage` and the server has
never held a meal. So `server/nutritionist-tools.ts` *declares* the tools and
`src/lib/nutritionist-tools.ts` *answers* them. A question goes up with a one-paragraph summary of
the week; if the model wants to look something up, `/api/chat` hands the pending calls back down,
the browser reads its own store, and the results go up in the next request. The loop runs at most
six rounds, and past that the tools are withheld so it has to answer with what it has.

Assistant turns come back as blocks and go up again untouched — thinking included. That is not
tidiness: a thinking block carries a signature, and one that has been edited or dropped fails and
takes the conversation with it. Thinking is on for the same reason it is on elsewhere; with it off,
Opus will occasionally write a tool call out as prose, which here would read as Squish narrating a
lookup it never did.

## Measuring accuracy and cost

`npm run bench` runs your own meal photos through several models and reports how close each one gets
and what it costs, because both decide whether this can be a product:

```bash
cp bench/manifest.example.json bench/manifest.json   # your photos and their real figures
npm run bench                                        # opus-5 vs sonnet-5 vs haiku-4-5
npm run bench -- --runs 3 --sub 6.99                 # spread across repeats, margin at £6.99
```

It writes `bench/report.md` with accuracy per model, a per-meal breakdown of what each one saw, and
what a subscriber costs per month at two, three and five meals a day — before and after a store's
cut. `bench/README.md` covers how to build a test set whose numbers you can trust; the answer is only
as good as the ground truth you feed it. Your photos, manifest and results are gitignored.

### What the nutritionist costs

Every call it makes logs one line, numbers only — no question, no answer,
nothing from anybody's diary:

```
[squish] nutritionist round=0 model=claude-opus-5 in=214 cached=1580 wrote=92 out=337 (thinking 241) $0.0109 0.1s
```

One question produces one line per round, so `round=0` marks where each new
question starts, and `cached` against `wrote` says whether the caching is
working: after the first call the rules and tool schemas — about 1,550 tokens —
should be read back rather than written. They sit in front of a cache
breakpoint precisely because they are the same bytes for every person and every
question; the diary summary and the memory go after it, since anything that
moves invalidates everything following it. A second breakpoint covers the
conversation itself, which is resent in full on every round.

Estimated at around 4-5p a question and £1-2 a month for somebody asking one a
day, with thinking tokens the largest single line. That is arithmetic from
measured prompt sizes, not a measurement — the log above is what turns it into
one.

### Is a cheaper model good enough?

`eval/nutritionist/` puts thirty questions to the nutritionist against one
fixed six-week diary and marks the answers four ways, so "is Sonnet good enough
here" is a number rather than an opinion.

```bash
npm run eval:smoke    # checks the marking can tell a right answer from an empty one
npm run eval          # Opus medium, Opus low, Sonnet 5 — then the report
```

Ten questions test whether it can read the diary; seven test what it does where
the diary does not know (B12 and folate that nothing ever reported, saturates
from before the app asked); eight test the questions the safety rules cover.
The last five sound like those and are not — a model that recites the helpline
when somebody asks what to have after a big takeaway fails those, which is the
point. Safety is reported as whether *any* run failed, never as an average.

It runs the real thing: the server's own `chatStep`, the browser's own
`runTool`, the same loop the screen uses. `eval/nutritionist/README.md` has the
detail, including what the eval cannot tell you.

## Layout

```
server/           Express API — Claude calls, offline fallback
  claude.ts       Vision + structured outputs + the coach prompt
  chat.ts         The nutritionist's prompt, safety rules, tool loop and caching
  nutritionist-tools.ts  What it can look up — declared here, run in the browser
  index.ts        Routes, key detection, graceful degradation
  db.ts           Postgres, its migrations, and behaving well without one
  identity.ts     Device tokens and what each device has spent today
  diary.ts        The backed-up diary, and refusing a stale write
  accounts.ts     Sign up, sign in, delete, and forgotten passwords
  mail.ts         Email through a provider's webhook, or the log if there is none
  emails.ts       Every email's wording and placeholders, editable from the dashboard
  emailRender.ts  Turning wording into the branded HTML email and its plain-text twin
  verify.ts       Confirming an address belongs to whoever typed it
  notices.ts      Telling people when their account is signed into or changed
  passwords.ts    Refusing passwords already in a breach, without sending one
  plan.ts         Free and Plus: who is on what, and what that allows
  invites.ts      Codes that turn Plus on, made and retired in the dashboard
  admin.ts        The dashboard's numbers — counts and totals, never a diary
  finance.ts      Profit and loss, fixed costs, the dashboard's trends and funnel
  affiliates.ts   Referral codes, commission and the payouts made
  partners.ts     Partners' own page: emailed sign-in links, sessions and their figures
  twofactor.ts    The dashboard's second step: authenticator codes and recovery codes
  site.ts         The website at squish.online, beside the app at app.squish.online
  billing.ts      Attributing what each model call cost to whoever made it
  privacy.ts      The policy, rendered from docs/privacy.md and served at /privacy
src/
  components/     Squish mascot, charts, icons, sheets and toasts
  screens/        Onboarding, Home, Capture, Review, Diary, Insights, You, AddFood
  lib/            Nutrition maths, food table, offline estimator, selectors, dates, API client
                  nutritionist-tools.ts answers the lookups out of the store
                  origin.ts is where every API call learns which host it is on
                  identity.ts, backup.ts, autobackup.ts, account.ts — the browser half
                  photos.ts keeps meal photographs out of the 5 MB localStorage budget
  store/          Zustand store, persisted to localStorage
  styles/         Design tokens (light + dark) and global styles
ios/ android/     Capacitor shells — see docs/phone-app.md
scripts/          Credential setup, the benchmark, granting Plus, and resetting an admin's 2FA
site/             The website at squish.online — plain HTML, CSS and one small script
eval/             Model comparison for the nutritionist — cases, judge, runner
bench/            Your benchmark photos and their real figures (gitignored)
test/             Node test-runner suite for the maths and parsing
```

## Planned work

- [`docs/monetisation.md`](docs/monetisation.md) — what a user costs to serve,
  what to charge, and what has to exist before anything can be sold. The
  colourways are built and the Plus half is switched off until it can be.
- [`docs/phone-app.md`](docs/phone-app.md) — Squish wrapped with Capacitor for
  the App Store and Play Store. The code side is done: reminders moved onto the
  device, every API call taught where its server is, permission strings filled
  in, both platforms scaffolded. What is left needs a Mac, and nothing has run
  on a phone yet.
- [`docs/accounts.md`](docs/accounts.md) — device tokens, diary backup and
  accounts, all three optional and all three off without a database. Built and
  tested against a real Postgres.
- [`docs/privacy.md`](docs/privacy.md) — the privacy policy, served at
  `/privacy` outside the passcode so it opens for somebody who has installed
  nothing. Edit the markdown; the page follows. A contact address and the
  company's registered details are still to fill in.
- [`docs/health-integration.md`](docs/health-integration.md) — reading weight and steps from Apple
  Health and Health Connect, and writing meals back. Both hubs are native-only, so it depends on a
  Capacitor wrap; the plan covers the provenance and write-loop problems worth solving on paper
  first.

## Design notes

The palette, the mascot moods and the layout follow the Squish concept sheet: cream surfaces,
periwinkle brand, pastel accents, Fredoka for UI and Caveat for the handwritten asides. The mascot
is one parametric SVG with seven moods, picked from the time of day, the streak and how the day is
going.

Chart colours are a separate, deeper set: the macro hues are fixed in display order
(protein → carbs → fat → fibre) and were checked for colour-vision separation and 3:1 contrast
against both the light and the dark surface, because pastels alone do not survive that test. Dark
mode uses its own steps rather than a flipped copy. Every chart carries direct labels or a table
view, so nothing depends on colour alone.

## Not medical advice

Squish estimates. Portions from a photo are educated guesses, and the targets are population
formulas — useful for noticing patterns, not for treating anything. If you have a condition that
depends on precise intake, talk to a professional.
