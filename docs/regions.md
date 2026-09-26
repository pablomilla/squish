# Regions

Squish works in six English-speaking countries: the United Kingdom, Ireland,
the United States, Canada, Australia and New Zealand. The language is shared;
the packet is not. Everything that differs lives in `src/lib/region.ts`.

## What changes

| | UK | Ireland | US | Canada | Australia | New Zealand |
|---|---|---|---|---|---|---|
| Price | £ | € | $ | C$ | A$ | NZ$ |
| Energy | kcal | kcal | kcal | kcal | **kJ** | **kJ** |
| Salt on packets | salt, g | salt, g | sodium, mg | sodium, mg | sodium, mg | sodium, mg |
| Daily sodium limit | 2,400 mg (6 g salt) | 2,400 mg | 2,300 mg | 2,300 mg | 2,000 mg | 2,000 mg |
| Imperial body weight | stones | stones | pounds | pounds | pounds | pounds |
| Starts on | metric | metric | imperial | metric | metric | metric |
| Vitamins and minerals | UK RNIs | UK RNIs | US/Canada DRIs | US/Canada DRIs | ANZ NRVs | ANZ NRVs |
| Spelling | fibre | fibre | **fiber** | fibre | fibre | fibre |

Food names follow the country: chips are fries in North America and hot chips
in Australia and New Zealand; crisps are chips everywhere but here. The
built-in food table carries local names and local sizes (a US can of cola is
355 ml, an Australian one 375, a schooner of beer 425), and the British name
stays on each food as a search word.

Energy can be switched between kcal and kJ on You, whatever the country.

## What does not change

What is stored. Energy is always kcal and salt is always sodium in milligrams,
so a diary means the same wherever it was logged, and switching country only
changes how it is shown. Moving country recomputes the suggested targets, as
any change to "About you" does.

## How it is chosen

A new person starts on the country their browser's languages name ("en-AU")
and can change it in onboarding or on You → About you. Anybody whose profile
predates regions is British — they signed up to a British app — rather than
being moved by a guess.

## The AI

The app sends `X-Squish-Region` and `X-Squish-Energy` on every call.
`server/region.ts` holds them for the request and each prompt ends with a
note for its job: the variety of English and local food words everywhere; how
a label is laid out when reading one (UK salt and fibre-excluded carbohydrate,
US Nutrition Facts with fibre inside total carbohydrate and an added sugars
line, the ANZ panel in kJ); the country's official advice for the
nutritionist; the local supermarket for a weekly plan. The JSON the model
returns is in kcal and sodium mg whatever the country.

## Languages for the AI

Separate from the country (`src/lib/language.ts`): somebody in Texas may want
Spanish, somebody in Montréal French, while still shopping, reading labels
and counting in their own country's way. The country decides the food and
the numbers; the language decides the words.

24 languages: English, then the ones most spoken at home across the six
countries (Spanish, Polish, Punjabi, Mandarin, Arabic, Tagalog, Hindi,
Vietnamese and others), plus Welsh, Irish and te reo Māori. A new person
starts on the first of their browser's languages Squish can write in;
everybody else stays on English. It is set in onboarding and on You → About
you, beside the country.

What changes is everything the AI writes: meal titles and food names, the
coach's notes and daily nudge, the nutritionist's replies (even to the app's
English suggested questions), notes it keeps, and weekly plans. The prompt
asks for the language as spoken in their country ("the Spanish people in the
United States use") and keeps JSON keys, enum values and unit symbols in
English, so nothing downstream has to understand another language.

Around it:

- **Voice input** listens in their language, in their country's variety
  where there is one (es-US, fr-CA).
- **Right to left.** Arabic and Urdu text from the AI — meal names, notes,
  replies, plans, the shopping list — has `dir="auto"`, so each piece
  lays itself out the right way.
- **The shopping list** sorts by aisle from the ingredient's name, which only
  works in English, so a weekly plan now states each ingredient's aisle and
  the list uses that first.
- **Headers.** The language travels as `X-Squish-Language`, and only a value
  from the fixed list reaches a prompt.

## The interface

The app itself is translated too — see docs/translation.md. Choosing a
language on the first screen or on You → About you switches both the app and
its AI, and restarts Squish in it.

## Not yet

- A meal planned from a photo or description (rather than a weekly plan) in
  another language has no aisle, so it lands under "Other" on the list.
- Barcode lookups return Open Food Facts' own product names.
- Store prices are set here, not read from the stores. The website shows the
  same ones, in the visitor's currency (see docs/translation.md).
