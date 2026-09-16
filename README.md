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

```bash
npm install
npm run dev          # web on :5173, API on :8787
```

Then open http://localhost:5173.

For real photo analysis, give the **server** an Anthropic key (the browser never sees it):

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY=sk-ant-...
npm run dev
```

Without a key the app still runs end to end: the API server falls back to a local estimator built
on the bundled food table, and anything it produces is labelled **Offline estimate** in the UI
rather than passed off as a real analysis.

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server + API server together |
| `npm run build` | Typecheck and build the PWA to `dist/` |
| `npm test` | Unit tests for the nutrition maths, estimator and selectors |
| `npm run lint` | oxlint over app, server and tests |
| `npm run typecheck` | `tsc -b` across both projects |

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
