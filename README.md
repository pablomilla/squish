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
  nothing is saved until you say so.

**Tracking**
- Daily calorie ring, macro bars against target, and an energy split (protein / carbs / fat).
- Diary by day and meal slot, with water, steps and weight.
- A 0–100 diet-quality score per meal and per day — protein and fibre density lift it, heavy added
  sugar, fat load and sodium pull it down.

**Progress**
- Weekly / monthly / all-time charts with a target line, a table view and per-day readouts.
- Logging streak, four daily habits, nine achievements, weight trend against your goal.
- "You eat a lot of…" — your most repeated foods over the range.

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

The server serves the built app as well as the API, so it deploys as one service.
`render.yaml` is a Render blueprint: **New → Blueprint → pick this repo**, and it asks for the two
secrets rather than you editing any files.

| Setting | What it is |
| --- | --- |
| `ANTHROPIC_API_KEY` | Your key. Lives in the host's dashboard, never in the repo. |
| `SQUISH_PASSCODE` | **Set this.** Without it, anyone who finds the URL spends your credit. |
| `SQUISH_RATE_LIMIT` | Analyses per visitor per hour, default 80. A backstop on the bill. |

With a passcode set, the app opens on a lock screen and every analysis endpoint returns 401 until it
is entered. It is a shared passcode, not a login — everyone who knows it shares one Squish. Render's
free tier sleeps after inactivity, so the first visit takes ~50s to wake.

## How the AI part works

`server/claude.ts` sends the image (or description) to `claude-opus-5` with
`output_config.format` set to a JSON schema, so the response is already the shape the app needs —
no prose parsing. Adaptive thinking is on; effort is `medium` for analysis and `low` for the daily
coach nudge. Values are coerced and clamped on the way in, and a model-supplied quality score is
only trusted when it is present and sane, otherwise the local scorer runs.

The key stays on the server. `POST /api/analyse/photo`, `/api/analyse/text` and `/api/coach` are
the only endpoints, and each one degrades to the offline estimator rather than failing.

## Layout

```
server/           Express API — Claude calls, offline fallback
  claude.ts       Vision + structured outputs + the coach prompt
  index.ts        Routes, key detection, graceful degradation
src/
  components/     Squish mascot, charts, icons, sheets and toasts
  screens/        Onboarding, Home, Capture, Review, Diary, Insights, You, AddFood
  lib/            Nutrition maths, food table, offline estimator, selectors, dates, API client
  store/          Zustand store, persisted to localStorage
  styles/         Design tokens (light + dark) and global styles
scripts/          Credential setup and check
test/             Node test-runner suite for the maths and parsing
```

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
