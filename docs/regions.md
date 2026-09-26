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

## Not yet

- The app's own text is British English everywhere except the words above.
  A full American translation, and other languages, come later.
- Emails are British.
- Store prices are set here, not read from the stores.
