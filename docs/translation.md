# Translating the interface

Every word Squish shows is written in British English in the source and
translated into 23 other languages by Claude, once, on the live server.

## How it fits together

1. **Marking.** Interface text goes through `t('…')` (`src/lib/i18n.ts`).
   Sentences with bold words or links use `rich('… <b>{x}</b> …', vars, tags)`
   (`src/lib/i18n-react.tsx`); counted ones use
   `plural(n, { one: '{n} meal', other: '{n} meals' })`, so Polish, Arabic and
   Welsh get all the plural forms they need. Text kept in a table goes through
   `pluralForms()` or `msg()`, and messages the server sends are marked with
   `msg()` there and translated in the app with `t(message)`. Placeholders are
   named — never glue translated pieces together, because other languages put
   them in a different order.
2. **Collecting.** `npm run i18n` reads the source and writes
   `src/i18n/catalog.json` (every string, where it is used) and
   `src/i18n/version.ts`. `test/i18n.test.ts` fails if the catalog is out of
   date, so a new string cannot ship unnoticed. Run it and commit both files
   after changing any wording.
3. **Translating.** `server/translate.ts` hands missing strings to Claude in
   batches of 60 with the screen each is used on, and keeps each answer only if
   it has exactly the English's placeholders and tags (and every plural form
   the language needs). Accepted translations go in the `ui_translations`
   table, keyed by the English string's id: a changed string is a new id and is
   translated afresh; an unchanged one is never paid for twice.
4. **Serving.** `GET /api/i18n/:language` returns what is translated so far
   and starts translating the rest. After a deploy the server works through
   all 23 languages by itself (`SQUISH_I18N_WARM=off` stops that).
5. **Loading.** `main.tsx` picks the language (the profile's, else the
   browser's) and loads its words *before* importing the rest of the app, so
   text translated as modules load is already right. The words are cached in
   the browser; a newer set is fetched in the background for next time. The
   first launch in a language waits up to six seconds behind the splash
   screen. Anything missing shows in English — never a blank.

Arabic and Urdu set the page right to left; a few left/right positions are
mirrored at the end of `global.css`.

## What it costs

About 1,600 strings, a little under 25,000 words. Translating all of it into
one language is a few dollars of Claude time, once; after that only changed
strings are sent. The cost is logged by the server, not charged to anybody's
allowance.

## Checking

- `?lang=qps` opens the app in a made-up "pseudo" language: every letter is
  swapped for an accented look-alike and each string is bracketed. Anything
  still in plain English on screen was missed; anything cut off will not fit a
  longer language.
- The owner's dashboard, two-step sign-in and the partner portal stay in
  English: they are for the business, not the people using Squish.
- Emails are still English.

## Not yet

- Native-speaker review. Claude's translations are good but not checked by a
  person; the ones that matter most (onboarding, the paywall) are worth a look
  by someone fluent in each launch language.
- Emails and the marketing website.
