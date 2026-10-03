# Translating the interface, the emails and the website

Every word Squish shows is written in British English in the source and
translated into 23 other languages by Claude, once, on the live server. The
emails and the website come from the same store, the same way.

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

## American English

The source is British English, which is what Britain, Ireland, Australia, New
Zealand and Canada read. English in the US gets its own word set, `en-US`,
made and served exactly like a language (`/api/i18n/en-US`) — only the
request is different: not a translation but a light rewrite
(`AMERICAN_RULES` in `server/translate.ts`), changing spelling, food words
and British phrasing and leaving everything else as it is. Units and
salt/sodium are left alone: the app converts those itself, by country.

Which set loads is `packFor(language, region)` in `src/lib/language.ts`:
a language's own everywhere; for English, American in the US and none
elsewhere. The emails use the same rule. Until the American set has loaded,
`localWords` keeps swapping the food words in the US as before; once it has,
it steps aside, or the American "chips" would become "fries".

## Emails

Each account keeps the language, country and time zone its app last sent
(`X-Squish-Language`, `X-Squish-Region`, `X-Squish-Zone`; `server/reader.ts`),
so an email written while nobody is asking — a security notice, a friend's
reward — still knows who it is for. A new account's first email uses what the
sign-up request said.

The wording (`server/emails.ts`, or the dashboard's edit of it) is translated
**line by line**: the subject, the button, and each line of the body with
words in it. A line that is only a placeholder, such as `{link}`, is left
alone, so the button stays a button. The default wordings are registered at
start-up and translated with everything else; an edited wording is new English,
translated the first time somebody needs it in that language (the email waits
up to 20 seconds for it, then goes with English for any line not back). A line
whose translation loses a placeholder is thrown out like any other, so the
worst an email can be is partly English — never missing its link.

Values that are words themselves are written in the reader's language too:
the device ("Safari en iPhone"), the time (on their clock, with its zone's
short name), the reward sentence. The footer, and the page a confirmation link
opens, are ordinary `t()` strings in the app's catalog.

In English outside the US, the wording also goes through the app's table of
country words (`localWords`): an email that says "talk to your GP" says
"talk to your family doctor" to a reader in Canada. None of the default
wordings has such a word today; it matters for wording edited in the
dashboard. Unlike the privacy policy, a country-worded email carries no note
about which version counts, on purpose: that matters for a legal text, and in
a reset or security email it would only get in the way.

The partner and test emails go to the business and stay English.

## The website

The pages in `site/` stay hand-written English HTML. `server/htmlWords.ts`
reads a page into the pieces a person reads — a paragraph, heading, list
item, link or button as one string, with its inner markup as tags a
translator can move (`Open <a1>app.squish.online</a1> in any browser`), plus
alt text, aria-labels and the page description — and puts the translations
back, restoring each numbered tag's attributes from the original. A
translation can reorder a link but not change where it goes, and any other
markup in it is escaped. `server/site.ts` registers every page's strings at
start-up.

- `/` is in the browser's first language Squish has (`Vary: Accept-Language`);
  `/es/`, `/es/help`, `/en/` are fixed, and their links keep the language.
  The footer lists every language; each page carries `hreflang` alternates.
- The privacy policy is the same: `/privacy?lang=es`, or the browser's
  language. Translated, it opens by saying the English is the one that counts.
- What `move.js` says is in a `<template>` on the page, so it is translated
  with it.
- A page with strings still untranslated shows them in English and sets the
  language translating in the background, like the app.
- Prices are placeholders in the pages (`{yearly}`, `{weekly}`, `{monthly}`, `{free}`),
  filled in after translating with the country's price from
  `src/lib/region.ts` — the same one the paywall shows — in its currency,
  written the page's language's way. The server picks the country from one
  chosen under the plans (`?country=AU`), else the one the browser's
  languages name (`en-AU`), else Britain. Then, unless a country was chosen,
  `site/guess.js` and `site/prices.js` swap in the country the device's clock is set to, if
  it is one of the six — the table is `TIME_ZONES` in `src/lib/region.ts`,
  and every country's prices come on the page in a JSON block, so the script
  asks nothing of anybody. It is what puts pounds in front of somebody in
  Britain with a browser set to American English.
- In English the country decides the spelling too: American for the US
  (`packFor`, as in the app), British everywhere else, `<html lang>` to
  match. Spelling cannot be swapped in the browser the way a price can, so
  when the clock names a country that reads the page in other words, the
  page asks for itself again once, as `?country=GB&guess`. That is
  `site/guess.js`, which the server inlines in the head straight after the
  data: it runs before anything is drawn and hides the page while the right
  one comes, so the wrong spelling is never on screen (and shows it again
  after three seconds if the page is somehow still there). Where only the
  prices differ it leaves its guess on `<html data-guess>` for `prices.js`. A guess can be
  guessed again (so a shared link still suits whoever opens it); a country
  picked from the list cannot. Every page carries the data for this, not
  only those with prices. Another language is the same in every country.
- Elsewhere, English pages are the British source with the country's own
  words for the few that differ, from the app's table (`localWords`, via
  `pageInTheirWords` in `server/site.ts`): "your family doctor" on the support
  page in Canada, where Britain says "your GP". The clock's guess only reloads
  a page for them where that page has such a word.
- The email confirmation page follows the account's country the same way.
- So does the privacy policy: American for the US, with a note at the top
  that the British English version is the one that counts; elsewhere in
  English, the country's own words from the same table, like the pages, with
  a note of its own ("This is the policy with Canadian words for a few
  things…") whenever any word differs. None of the policy's words differ
  today, so no reader outside the US sees a note yet. The policy has no
  script, so it cannot read the clock; every link to it says the language
  and, in English, the country outright — the website's
  (`/privacy?lang=en&country=GB`, the clock's guess included), the app's and
  the emails'. Opened with neither, it goes by the browser's languages.
- The screenshots are pictures of the English app.

### The screenshots, in each language

The phones on the website are the real app, photographed in each language
with a made-up fortnight in it (`src/lib/demoDiary.ts`). The meals are marked
for translation like the interface, so they arrive in every language's pack,
and `scripts/site-shots.ts` fills the diary in the language it is
photographing: the Spanish page shows a Spanish breakfast. It writes
`site/img/shots/<language>/` (and `en-US/` for American English), and the
server swaps each `/img/shots/en/…` on a page for the language's own file
where there is one (`withShots` in `server/site.ts`) — English until then.

The script waits for a language to be completely translated and skips it
otherwise, so a set is never half English. To retake them all from the live
app: GitHub → Actions → **Website screenshots** → Run workflow. It commits
the new sets to the branch it ran on, which redeploys the site.

## What it costs

About 1,600 interface strings, and about 250 more for the emails, the website
and the privacy policy — a little over 30,000 words in all. Translating all of it into
one language is a few dollars of Claude time, once (American English about the
same, since every string goes and comes back); after that only changed
strings are sent. The cost is logged by the server, not charged to anybody's
allowance.

## Checking

- `?lang=qps` opens the app in a made-up "pseudo" language: every letter is
  swapped for an accented look-alike and each string is bracketed. Anything
  still in plain English on screen was missed; anything cut off will not fit a
  longer language.
- The owner's dashboard, two-step sign-in, the partner portal and the partner
  and test emails stay in English: they are for the business, not the people
  using Squish.
- `test/translate-pages.test.ts` covers the emails and the website with a
  stand-in translator.

## Not yet

- Native-speaker review. Claude's translations are good but not checked by a
  person; the ones that matter most (onboarding, the paywall) are worth a look
  by someone fluent in each launch language.
- The Quick snap widgets' labels (Android and iPhone). They are in the native
  projects, not the catalog, and wait until the widgets run on a phone: see
  [widgets.md](widgets.md#to-do-once-the-widgets-are-running-on-a-phone).
  The iPhone share extension's two messages ("Sending to Squish…", "Sent to
  Squish…", in `ios/App/SquishShare/ShareViewController.swift`) go with them.
