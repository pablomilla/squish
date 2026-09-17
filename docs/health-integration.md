# Plan: Apple Health and Health Connect

**Status:** proposed, not started. Nothing in this document is built yet.

## Why this, and not per-brand integrations

Most scales and trackers have no public API — Renpho, the one that prompted this, has none at
all. What they do have is an app that writes into **Apple Health** on iOS and **Health Connect** on
Android.

Read the hub and you inherit the whole ecosystem in one piece of work: Renpho, Withings, Eufy,
Tanita, Garmin, Fitbit, Oura, Whoop, Strava. Integrate per brand and you do the work repeatedly,
forever, and still cannot reach a Renpho user.

Both hubs are native-only. No web API exists for either, so this cannot ship until Squish is
wrapped as a native app.

## Scope

**Read** — body weight, steps, active energy. Weight is the valuable one: it removes a daily
chore, and a person who does not have to weigh-and-type is a person who keeps using the app.

**Write** — meals as nutrition records, and water as hydration. This is what makes Squish a good
citizen: someone's ring-closing app, their doctor's export and their other tools all see the food
they logged here.

Out of scope for now: heart rate, sleep, workouts, blood glucose. Each one widens the permission
request and the store declaration for no benefit to a food tracker.

## Where it lands in this codebase

| File | Change |
| --- | --- |
| `src/lib/health.ts` | **New.** The bridge interface: `isAvailable()`, `requestPermissions()`, `readWeight(range)`, `readSteps(range)`, `writeMeal(entry)`, `writeWater(date, glasses)`. A no-op implementation on web, the plugin behind it on device. |
| `src/types.ts` | `DayLog` gains provenance per field; `MealEntry` gains a written-to-hub marker. See below. |
| `src/store/useSquish.ts` | `setWeight` / `setSteps` / `setWater` need to know whether a human or the hub supplied the value. New action for ingesting a batch from the hub. |
| `src/screens/You.tsx` | A connection card: connect, disconnect, what is shared each way, last sync time. |
| `src/screens/Home.tsx`, `Diary.tsx` | Show where a number came from, so nobody wonders why their steps changed by themselves. |
| `capacitor.config.ts`, `ios/`, `android/` | **New.** The native shells. |

## The two problems worth designing before writing code

### 1. Provenance, or: whose number is this?

Today a day's weight and steps are bare numbers. Once two sources can write them, every field
needs to know where it came from:

```ts
interface DayLog {
  date: string;
  water: number;
  steps: number;
  weightKg?: number;
  source?: { steps?: 'manual' | 'health'; weight?: 'manual' | 'health'; water?: 'manual' | 'health' };
  syncedAt?: string;
}
```

Rules to settle:

- **A person always outranks the hub.** If someone types their weight, a later sync must not
  quietly overwrite it. The hub fills gaps; it does not correct people.
- **Steps are a total, not a sum.** When the hub supplies steps, the manual `+1k` buttons must be
  hidden, not added on top. Two sources of steps silently summed is the classic bug here.
- **Deduplication is the hub's job, not ours.** A phone and a watch both report steps; Apple Health
  and Health Connect already resolve that. Ask them for the aggregate rather than raw samples, and
  never add samples up by hand.

### 2. The write-back loop

Squish writes nutrition into the hub. Squish also reads energy from the hub. Without care it reads
back what it just wrote, doubles the day's calories, and the number drifts upward every sync.

Three defences, all of them needed:

- Do not read dietary energy at all. We are the source of truth for food; there is no reason to
  read it.
- Tag everything we write with our own bundle identifier, and filter our own records out of any
  read.
- Make writes idempotent: one hub record per `MealEntry.id`. Editing a meal updates that record;
  deleting a meal deletes it. `MealEntry` therefore needs to remember the hub's record id.

## Phases

**Phase 1 — Wrap it (prerequisite).** Capacitor, `ios/` and `android/` projects, icons, splash,
the in-app camera swapped for the native one. Nothing health-related. This is the phase that also
unlocks the app stores and push notifications, so it pays for itself regardless.

**Phase 2 — Read weight and steps.** The bridge interface, the provenance model, the connection
screen in You, a sync on app open and on resume. Ship this alone and the daily weigh-in becomes
automatic — the single biggest habit win available.

**Phase 3 — Write nutrition and water.** Per-meal records with the idempotency above. Needs a
backfill decision: on first connect, write the last 30 days, or only meals from here on? Backfill
is kinder but slower and noisier in the other app's timeline.

**Phase 4 — Store submission.** Declarations, privacy policy, review. Budget real weeks; see the
gates below.

## Platform specifics

**iOS / HealthKit** — read `bodyMass`, `stepCount`, `activeEnergyBurned`. Write
`dietaryEnergyConsumed`, `dietaryProtein`, `dietaryCarbohydrates`, `dietaryFatTotal`,
`dietaryFiber`, `dietaryWater`. Group each meal's values into a single correlation of type `food`
so the other app shows one meal, not six loose numbers. `Info.plist` needs
`NSHealthShareUsageDescription` and `NSHealthUpdateUsageDescription`, and the strings are read by
reviewers — write them for a person, not a form.

**Android / Health Connect** — read `WeightRecord`, `StepsRecord`, `ActiveCaloriesBurnedRecord`.
Write `NutritionRecord` (energy, protein, totalCarbohydrate, totalFat, dietaryFiber) and
`HydrationRecord`. Permissions are declared in the manifest and requested at runtime; Android 16
splits them more granularly, so check the current set at build time rather than trusting this list.

## Plugin choice, and the risk in it

Two candidates, both worth a day of evaluation before committing:

- **Capawesome Capacitor Health** — one typed API across both platforms, aggregation and source
  deduplication handled for you. Requires Capacitor 8+ and a paid Insiders subscription.
- **`@capgo/capacitor-health`** — free, unified API, read and write.

**The risk:** their published feature lists lead on steps, weight, hydration and workouts.
Detailed *nutrition writing* — energy plus four macros, correlated into one meal — is the part
least likely to be covered. Verify this first, before any other native work, because the answer
changes the estimate: if nutrition write is missing, Phase 3 needs a small custom Capacitor plugin
(a few hundred lines of Swift and Kotlin). That is very doable, but it is not an afternoon.

## Store gates

**Apple.** Health data cannot be used for advertising or sold. A privacy policy is required.
HealthKit apps get closer review, and the usage-description strings are part of what is judged.

**Google Play.** A **Health apps declaration form** in Play Console, separate from and additional
to the Data Safety form — and every developer must complete it, even apps with no health features.
Reading health records now requires justifying that the data is essential to the app's primary
function. For Squish that argument is easy (it is a nutrition app reading body weight), but it must
be made deliberately, and the requirements have changed twice recently. Check the current rules
when you get there rather than trusting this paragraph.

## Privacy and legal

Body weight and food logs are special-category data under UK GDPR. This is the point where the app
stops being a hobby project in legal terms.

- Health data stays on the device and in the hub. It does not go to the Squish server. The server
  sees a meal photo for a few seconds and nothing else.
- Connecting is opt-in, per direction (read and write are separate consents), and disconnecting
  must actually stop the sync and say what it leaves behind in the hub.
- Never use health data for advertising or analytics. Both stores prohibit it and it is the fastest
  way to be removed.
- Get a lawyer to look at the privacy policy before you charge anyone. Not optional at this stage.

## Testing

The awkward part: neither hub works properly in a simulator. This needs a real iPhone and a real
Android device, and ideally a real Renpho or Withings scale to prove the end-to-end path — scale to
vendor app to hub to Squish. Budget for the devices.

Worth writing as automated tests regardless: the provenance rules and the deduplication logic are
pure functions over data, and that is where the subtle bugs will be. Test those in `test/` the way
the unit conversions are tested, so the device testing can focus on the plumbing.

## Rough effort

| Phase | Estimate | Note |
| --- | --- | --- |
| 1 — Capacitor wrap | 3–5 days | Needed for the stores anyway |
| 2 — Read weight + steps | 3–5 days | Add a week if the plugin disappoints |
| 3 — Write nutrition | 2–4 days, or 1–2 weeks | The wide range is the custom-plugin risk |
| 4 — Store declarations | 1–2 days of work, weeks of waiting | Play's 12-tester rule runs in parallel |

Developer time, assuming the native projects behave. They often do not the first time.

## Decisions needed before starting

1. **Which plugin**, after verifying nutrition write support.
2. **Backfill on first connect** — last 30 days, or from now on?
3. **Steps as a target at all?** If the hub supplies them, the manual buttons go. If most testers
   have no tracker, manual entry stays and the two need a clear precedence rule.
4. **iOS first, or both together?** iOS alone is faster to a testable build; both together avoids
   designing the abstraction twice.
