# What Squish costs to run, and what it should charge

Written down on 22 September 2026, before there was anything to buy, because
the arithmetic is the part that gets forgotten and it is the part that decides
everything else.

## The shape of the problem

**Squish costs money every month somebody is active. A colourway is a one-off
payment.** That single sentence is the whole of it. Cosmetics cannot be what
funds the app; they are a top-up on people who already pay.

The per-action costs below are measured — from real prompt sizes, real token
counts and the Claude pricing at the time. **The actions per person are a
guess**, and they are the number that matters most, so treat the monthly
totals as a shape rather than a figure.

Replacing that guess is now a matter of looking: every call's price is kept
against the person who made it, and the dashboard (`You → Dashboard`, for
addresses in `SQUISH_ADMIN_EMAILS`) shows the month's real spend by kind. When
there are enough users to mean anything, take the numbers from there rather
than from this table.

| | Moderate (2 photos + 1 question a day) | Heavy (3 + 3) |
|---|---|---|
| Photo analysis, $0.033 each | $1.97 | $2.95 |
| Nutritionist, $0.047 a question | $1.42 | $4.27 |
| **Per person per month** | **~$3.40 (£2.65)** | **~$7.20 (£5.65)** |

Plus about $7 a month, flat, for a host that does not fall asleep.

A £1.99 colourway pack nets about £1.41 once VAT and the store's cut are
off. That is under three weeks of one moderate user. From month two you are
paying for them.

## What to charge

**£49.99 a year with 3 days free, or £2.99 a week — and £6.99 a month, with
the first month £3.99, only for somebody leaving without either.** Since 3
October 2026 (before that, £6.99 a month or £49.99 a year, offered side by
side):

- **The year is the one shown first**, marked "Best value", with a 3-day free
  trial so the nutritionist can earn it before anybody pays. The trial is on
  the year only: a free week of a weekly plan is most of what it sells.
- **The week is the way in for somebody not ready to commit.** £2.99 a week
  is about £13 a month — dearer than a month on purpose, so the year looks
  like the bargain it is (the paywall says "save 67%" against 52 weeks), and
  somebody who stays on weekly pays the most.
- **The month is the exit offer.** "Carry on without it" on the paywall,
  once a visit, offers a month instead, the first at £3.99, then £6.99. It is
  not on the website or the main paywall, so it does not undercut the other
  two; "No thanks" closes it, and it does not come back until the next time
  the paywall does.

The stores need each set up: the year as a subscription with a 3-day free
trial (an introductory offer on the App Store, a free-trial phase on Google
Play), the week as a plain subscription, and the month with a one-period
introductory price for the first month. All three in one subscription group,
so somebody can move between them.

| Price | Squish receives (15% tier) | A month |
|---|---|---|
| £2.99 a week | £2.12 | £9.18 |
| £49.99 a year | £35.41 | £2.95 |
| £6.99 a month | £4.95 | £4.95 |
| £3.99 first month | £2.83 | — |

Until 3 October 2026 Plus had a monthly
allowance (60 analyses, 30 questions, 10 recipe imports), because on Claude a
heavy user cost £5.65 a month and without one the best customers lost the
most money. With Gemini as the main AI, Plus is **unlimited under fair use** —
see "Fair use" below; the reasoning that follows about prices still holds.

## Fair use (since 3 October 2026)

Gemini made "unlimited" affordable. At Gemini 3.8 Flash's price from 2027
($1.50 / $7.50 per million tokens; less until the end of 2026), with the
token sizes behind today's Claude figures:

| | Photo analysis | Question |
|---|---|---|
| Claude Opus 5.5 | 2.6¢ | 4.7¢ |
| Gemini 3.8 Flash (2027 price) | 1.0¢ | 1.8¢ |

A real heavy user — five meals photographed and three questions a day, a few
recipes and plans — is about **$3–4 a month**, inside even the yearly price
(about $3.75 a month after store fees). Estimates until the dashboard has a
month of real Gemini spend; Gemini counts image tokens differently and
usually fewer.

**What Plus promises:** unlimited analyses, questions and recipe imports for
one person's own eating, and two weekly plans a week (the largest single
request, so a stated number rather than "unlimited").

**What keeps it unlimited** (server/plan.ts, server/fairUse.ts):

| | Limit | Why there |
|---|---|---|
| Analyses a day | 40 | eight times a heavy day |
| Questions a day | 50 | about fifteen times a heavy day |
| Recipe imports a day | 10 | a busy Sunday of meal prep is three or four |
| Weekly plans | 2 a week (Mon–Sun) | a fresh plan when the first does not suit |
| Starting in a minute | 10 analyses, 15 questions, 5 recipes | a person never does; a script does at once |
| Devices signed in | 5 | a sixth signs out the one used longest ago |

The daily ceilings reset at midnight UTC. Somebody at every ceiling every
day would cost about $40 a month, which is why there are ceilings at all —
but nobody eating reaches them, and an account that reaches one on 3 or more
days in a month is marked "Over fair use" on the dashboard's People list (with
a filter for just those). Nothing happens automatically: a person looks.

**The advertising rules.** In the UK, "unlimited" is acceptable only when a
legitimate user is not charged or cut off for passing a fair-use threshold,
and the limits are moderate and stated where "unlimited" is said (the ASA's
guidance on unlimited claims, written for broadband but the principle is
general). So: reaching a ceiling never charges anybody or stops their
account, only that one thing until midnight; the ceilings are far past real
use; and they are stated on the plans page, in the app beside "unlimited",
and in the terms ("Fair use"). Lowering them far changes whether "unlimited"
is honest, not only the margin. Not legal advice — worth a look from whoever
handles the terms.

**The free taste** grew with the switch: 10 analyses and 5 questions, once,
about 20 cents on Gemini, because the taste is what converts.

**Inviting a friend while on Plus** used to add extra AI as well as saving
the month; with Plus unlimited there is nothing to add, so it is the month
saved, at the end of their current Plus.

**Before switching everything to Gemini**, run the photo benchmark (`bench/`)
on real keys and compare portion accuracy with Claude; then set
`SQUISH_GEMINI_FOR_EVERYONE=on` in Render and change everybody's routes on
the dashboard's Models card. Claude stays as the backup.

It was £4.99 and £39.99 until 23 September 2026, before anything was sold.
What changed was doing the sum properly. UK store prices include 20% VAT, and
the store's cut comes off what is left:

| Price | Squish receives (15% tier) | A month |
|---|---|---|
| £4.99 a month | £3.53 | £3.53 |
| £39.99 a year | £28.33 | **£2.36** |
| £6.99 a month | £4.95 | £4.95 |
| £49.99 a year | £35.41 | £2.95 |

On Claude, somebody who used all of the old allowance cost about £2.65 a month
before recipe imports. On the old yearly price, the people most likely to buy a year
— the heavy users — would each have lost money. At £49.99 they do not, and
the year is still about 40% cheaper than twelve months, which is the reason
to choose it.

**The 15% is not automatic.** Apple's Small Business Program and Google
Play's equivalent both have to be applied for. At the standard 30%, even
£6.99 is thin for a heavy user.

### Outside the UK

Squish is set up for six countries, each with its own price in its own
money (`src/lib/region.ts`). These are what the store listings should be set
to; the paywall shows them and nothing is charged through the web app.

| Country | A year | A year, a week | A week | A month | First month |
|---|---|---|---|---|---|
| United Kingdom | £49.99 | £0.97 | £2.99 | £6.99 | £3.99 |
| Ireland | €57.99 | €1.12 | €3.49 | €7.99 | €4.49 |
| United States | $59.99 | $1.16 | $3.49 | $7.99 | $4.49 |
| Canada | C$74.99 | C$1.45 | C$4.49 | C$9.99 | C$5.49 |
| Australia | A$84.99 | A$1.64 | A$4.99 | A$11.99 | A$6.99 |
| New Zealand | NZ$89.99 | NZ$1.74 | NZ$5.49 | NZ$12.99 | NZ$6.99 |

The week is 42–45% of a month everywhere, and the first month a little
over half.

They are set by what people pay for apps in each place rather than by the
exchange rate, and each keeps the same shape as the UK's: the year about 40%
cheaper than twelve months. Irish, Australian and New Zealand store prices
include their VAT or GST (23%, 10%, 15%), American and Canadian ones do not —
sales tax is added at the till — so the US price does the most work per
dollar. Worth checking each against a heavy user's cost before launch there,
the same sum as the table above.

### Offers

Discounts come from the stores' own offers, off a price people genuinely pay:

- **At launch:** a 7-day free trial, or an introductory "first year £34.99"
  (£24.78 to Squish, about £2.07 a month — roughly break-even on a heavy user,
  which is a fair price for a subscriber).
- **Offer codes** for partners and promotions; **win-back offers** for people
  who cancelled.

Not a list price set high so that a "discount" looks bigger: UK law (the
Digital Markets, Competition and Consumers Act 2024) treats a misleading
reference price as unfair, and a "was" price has to be one that was really
charged. New UK subscription rules — clear notice before a trial or offer
rolls onto the full price, and easy cancellation — are also on the way; check
where they stand before launch.

Once there are paying users, the dashboard's real cost per person replaces
every estimate here. If typical subscribers cost far less than the ceiling,
the price can come down; the margin can also simply stay.

The free/paid line falls out of the costs rather than being chosen:

| Free, forever | Paid |
|---|---|
| Manual logging, food search, barcodes, favourites | AI meal analysis — photo or description — after a one-off taste of 5 |
| The diary, charts, streaks, achievements | The nutritionist |
| The earned colourways | Recipe imports |
| Export | The Plus colourways |

Everything on the left is near-free to serve, so there is no reason to gate it,
and gating it would make the app useless to somebody deciding whether to pay.
Everything on the right is the part with a bill attached.

### Plus recipe imports: 10 a month

Plus came with 30 recipe imports a month until 23 September 2026. A recipe
import reads a whole web page (up to 12,000 characters), which makes it the
dearest thing Squish does — about $0.05 each, estimated from its prompt size.
At 30, a yearly subscriber who used all of Plus cost about £3.70 a month in AI
against the £2.70 they leave after VAT, the store, refunds and affiliates.
At 10 that is about £2.92 — about 20p a month short, and only for somebody who
uses every last allowance; everybody else is comfortably profitable. (Since 3 October
2026 recipes are unlimited under fair use, 10 a day: see "Fair use".)

### Plus weekly plans: 2 a week (4 a month until 3 October 2026)

The nutritionist's weekly plan (`/api/weekplan`, `server/weekplan.ts`) counts
as one of the month's 30 questions for the nutritionist, and is capped at 4 a
month on top — one a week, which is what it is for. The cap is separate
because one plan is several questions' worth of AI: a week of meals, each
ingredient with its nutrition, is 8,000–12,000 output tokens with thinking.
That is an estimate from the schema, not a measurement (no key was available
where it was built); the server logs each plan's real cost as
`[squish] weekplan … $0.xxxx`, and the dashboard counts it under the
nutritionist.

At an estimated $0.20–0.30 a plan, four a month is up to about 80p on top of
the figures above, for somebody who uses everything. Two knobs, neither
needing a deploy: `SQUISH_PLUS_WEEKPLANS_A_WEEK` sets the weekly cap (2), and
`SQUISH_WEEKPLAN_MODEL` can put plans on a cheaper model (Sonnet 5's output
is $10 per million tokens against Opus 5's $25) without touching the rest.
Check the logged costs after the first week and set them from those.

A plan is made in the background (`server/weekplanJobs.ts`): the request
answers at once with a job id, and the app asks after it every few seconds,
for up to fifteen minutes, and again whenever the planner is next opened.
Until 27 September 2026 the app held one request open and gave up after two
and a half minutes, and a week with thinking could take longer — so the plan
was finished and paid for on the server, counted against the person, and
never seen. A plan that fails gives its question back, and is not counted as
a plan.

### Cooking steps for a planned meal

Tapping a planned meal opens it as a recipe: its ingredients (the plan's own,
free to everybody) and, for Plus, the method — written the first time the meal
is opened (`/api/cook`, `server/cook.ts`), not with the plan, so a plan costs
no more and arrives no later for meals that are never cooked from the app.

A method is a short answer on the cheaper text model with thinking off: about
800 tokens in and 300 out, so a fraction of a penny. It is kept by meal,
language and country (`cook_steps`), so the same meal opened again — by
anybody — costs nothing, and the app keeps it on the plan as well. Not counted
against any allowance; a daily guard (`SQUISH_DAILY_COOK_STEPS`, 40) stops
one device writing new ones all day. Its cost is shown with meal plans on the
dashboard.

### Swapping and keeping planned meals

A planned meal can be swapped for another (`/api/weekplan/swap`): one meal
under the weekly plan's rules, on the cheaper text model with thinking off,
sized to the calories of the meal it replaces so the day still adds up. About
1,500 tokens in and 600 out, roughly a penny, plus a fill-in question when the
food table cannot answer an ingredient. Plus only and not counted against the
month — a plan that needs a few swaps is the plan working — with a daily guard
(`SQUISH_DAILY_SWAPS`, 30). Its cost is shown with meal plans.

Cooking for a household (the shopping list, the week's plan and a meal's
recipe all say how many) costs nothing extra in itself: the recipe and the
shopping are multiplied in the app, and what is logged stays one portion.
Steps written for four are a different answer from steps for one, so they are
kept separately — a meal cooked for several can cost one more cooking-steps
call, once.

Keeping a meal costs nothing: it is a flag on the plan in the app. A new week
leaves kept meals (and anything they planned themselves) where they are, is
told about them so it plans the rest of those days around them, and replaces
only the nutritionist's unkept meals on its days.

A plan also survives the server restarting, which happens on every deploy.
The request is kept with the job, and so is where the person is — country,
energy unit and language — so a plan made again on another instance is
still made for them: their supermarket, their wording, their food table first; the instance making it vouches for it every
ten seconds; and every instance looks every fifteen for a job nobody has
vouched for in a minute, and makes it again. A deploy hands its plans over as
it stops, so they are taken up at once. After three tries, or twenty minutes,
the plan is failed and its question given back by the server itself — the
app does not have to be open. Before this, a plan being made during a deploy
sat at "working" for a quarter of an hour with its question spent, and was
given back only if the planner happened to be opened at the right time.
A plan's ingredients are checked against the food tables too, as meals are
(see "How the AI part works" in the README): with a table loaded, an
ingredient the table can answer carries only calories and free sugar in the
plan, and the ones it cannot are filled in by one short question to the text
model for the whole week. A plan is the biggest answer Squish asks for, and
mostly plain ingredients, so this is where not asking for figures the table
already has should save the most; each plan logs how many of its ingredients
came from the table (`[squish] weekplan table first: …`).

A plan, and a swap, then gets one more short question on the same cheaper
model: **the seasoning check** (`SEASONING_SYSTEM` in `server/weekplan.ts`).
It is shown every meal's title and ingredients and says what each is missing
to taste of what it is — the paprika in a paprika chicken, the salt and pepper
on a grilled steak — because the recipe and the shopping list are made from
the ingredients alone, and a teaspoon of spice weighs so little that plans
leave it off. What it adds is small (40 g at most, four to a meal), never
something they avoid, and matched to the food table like any other
ingredient. About 1,500 tokens in and a few hundred out: well under a penny
a plan. If it fails, the plan goes as it came (`[squish] weekplan
seasoning: …` says what it added).

A **recipe import** gets the same check, with the page's own ingredient list
beside what was read: the "1 tbsp smoked paprika" and the "salt and pepper,
to taste" a reading lets go are put back at one serving's share. For a recipe
it adds only what the recipe calls for, so it needs no diet to go by. Under a
penny an import, beside the $0.05 of the reading (`[squish] recipe seasoning:
…`).

A **photo** gets it too, as what somebody ate: what its title names (the
paprika in a "paprika chicken") and the salt and pepper cooked savoury food is
seasoned with, never a sauce or topping the photo would have shown. Labels are
not checked: their figures are printed. It is asked as soon as the photo has
been read, alongside the food-table matching and fill-in, so it adds little or
nothing to the wait. About 900 tokens in and 100 out on the text model, roughly
$0.003 a photo beside the photo's own $0.026 on Opus 5.5, so about 10% on the
photo line of the bill; a Plus subscriber who uses all 60 photos costs about
18¢ a month more. `[squish] photo seasoning: …` says what it added. The
benchmark's cost column does not include it.

A **typed or spoken meal** gets it as well, with their own words as the record:
what the words or the title name, and salt and pepper on cooked savoury food,
never anything they did not mention. A correction ("no salt") or the answer to
the AI's question is never checked, so it cannot put back what was taken out.
Words are read on the cheaper model already, so the same $0.003 is a larger
share there: about a third on top of a typed meal's roughly $0.009
(`[squish] words seasoning: …`).

**Dashboard → AI usage → Weekly plans** lists the last day's plans: whose,
how long each took, how many tries, whether it has been seen, and why any
failed (never what was planned). A plan that restarts is made, and paid to
Anthropic for, twice.

A plan counts as one of the month's four **when it reaches the person**, not
when it is made. One made while nobody was looking — the app closed, or given
up on — is kept for a day and handed over the next time the planner is opened
(`GET /api/weekplan/waiting`), and counted then. Plans on the way (being made,
or made and not yet seen) count towards the cap too, so starting several at
once is no way round it. Until 27 September 2026 a plan was counted as it was
made, which is how plans nobody saw used up somebody's month; **Dashboard →
People** now has **Give back a plan** and **Give back a question** for
putting that right, each written to the record of what was done. The planner
says how many plans are left before anybody asks, and says the month is used
up rather than letting the request be refused.

### Words go to a cheaper model

Since 27 September 2026 a meal typed or spoken, a correction ("it was
grilled, not fried") and the answer to the AI's own question go to
**Sonnet 5** (`SQUISH_TEXT_MODEL`), at $2 / $10 per million tokens against
Opus 5's $5 / $25, and quicker. Photos and labels stay on Opus: reading a
picture is the hard part, and whether a cheaper model is good enough at it is
a question for `npm run bench` against weighed meals, not a guess. If the text
model fails a request, the main model answers it, so a cheaper model's bad
moment never becomes an offline estimate.

### Opus 5.5 is the main model

Since 30 September 2026 the jobs that were on Opus 5 — photos, labels, recipe
imports, the nutritionist, meal plans, the nudge and translation — are on
**Opus 5.5** (`SQUISH_MODEL`), at $4 / $20 per million tokens against Opus 5's
$5 / $25, with cached input at $0.20 rather than $0.50. That is a fifth off
every call it answers, and more on the nutritionist, whose rules are read from
the cache on every round. The per-action costs at the top of this page are
Opus 5's; until the dashboard has a month of real ones, take about 20% off.

Three things differ, and the server allows for each:

- **It always thinks.** It cannot be told not to, so the calls that turned
  thinking off (the nudge, cooking steps, swaps, translation) leave it on and
  set how hard it thinks with effort instead, and the ones sized for an answer alone are given 4,000
  tokens more room (`withThinkingRoom`), which costs nothing unless used.
- **Its thinking belongs to the conversation.** The nutritionist asks for
  thinking the conversation has outgrown to be dropped, not refused.
- **Its safety checks are broader.** A question it declines is asked of the
  backup, as a photo it declines already was.

Setting `SQUISH_MODEL=claude-opus-5` in Render puts it all back, and the
dashboard's AI models card changes any one job.

### The AI's one question, free

When the AI cannot tell one thing that would move a meal by about 50 kcal —
the dressing, the cooking fat, whole or skimmed milk — it reads the meal on
its best guess and asks about that one thing, with two to four answers to
tap (Review screen). Tapping one re-reads the meal with the answer on the
text model and costs the person **nothing**: the question was ours. That is
what the signature is for (`server/clarify.ts`): the server signs each
question with the answers it offered and an hour's life, so the free route
(`POST /api/analyse/clarify`) only answers questions it asked, with one of
its answers — it is not a free re-read of any meal. It is also capped at 30
a day per browser (`SQUISH_DAILY_CLARIFY`). A meal asks once; the re-read
never asks again. Most meals should ask nothing, and the prompt says so.

### A failed call costs nothing

Every AI allowance is counted before the call, so ten requests at once
cannot all see the last one free. Since 27 September 2026 anything that then
gets nothing from the AI gives it back: a bad request, no key on the server,
a recipe page that could not be read, the AI failing — where the photo and
description routes hand back a rough offline guess instead, that guess is
free too. A request refused for being over the allowance is not counted
either, so "used" never reads more than the allowance. Only what the same
request was counted for is ever given back, once (`giveBack` in
`server/index.ts`): a follow-up lookup round, which is not counted, cannot
be used to wipe out questions really asked.

### The nutritionist: 3 free questions, and a question counts once

Plus is sold on the nutritionist, and nobody pays for something they have
never tried. So a free account now gets **3 questions**, once, like the 5
free analyses (`SQUISH_FREE_CHATS`; signed-out browsers are told an account
unlocks them). Weekly plans stay Plus only.

At a few cents a question, the taste costs about 10–15 cents per account that
uses all of it — once, not monthly.

Until 27 September 2026 every *lookup* the nutritionist made was metered as a
question: it asks the app for a day or a meal, the app answers, and each of
those round trips went through the meter. A question that checked three
things spent four of the month's 30. Now only the round that starts with a
typed question is counted; lookup rounds are billed to it but not counted
again (and refused to anybody with no allowance, so a hand-made lookup is not
a way in). The cost per month is unchanged for the same use — what changes
is that "30 questions" now means thirty questions.

### Why the free AI is a taste, not an allowance

Until 23 September 2026 the free plan had 10 AI analyses and 2 recipe imports
**every month**. The costing (`squish-costing` calculator, and the figures
below) showed that to be the biggest cost in the business: at 5% of active
users paying, there are 19 free users behind every subscriber, and at 1,000
active users their AI came to about £120 a month — more than the subscribers'
own, and about 70% of everything that reached the company. It grows with every
free user who never pays, so growth made the loss bigger, not smaller.

So the free plan is now a diary, which costs almost nothing to run, plus a
**one-off taste** of 5 analyses. That answers the only question a free user is
asking — is the analysis any good? — at a capped cost of about 12p per person,
once. The taste:

- **needs an account**, so clearing a browser is not a fresh taste;
- is **counted per browser as well as per account**, so a second account in
  the same browser does not start it again;
- is **already spent** for anybody who has used 5 analyses before, including a
  subscriber whose Plus lapses.

At 300 new accounts a month that is about £36 a month on Opus 5, flat, rather
than a free-user bill that grows without end. Running the taste on Sonnet 5
would make it about £14; it stays on Opus 5 for now, because the taste is the
thing somebody decides to pay for, and it should be the analysis they would
get.

## The cosmetics layer

Six colourways are earned and six come with Plus (`src/lib/looks.ts`). Three
rules, which are cheap to hold now and expensive to reintroduce later:

1. **Nothing is both earned and sold.** It devalues the earning and insults the
   buying. The `Unlock` union makes it unwriteable rather than merely
   discouraged.
2. **Nothing rewards logging more food than somebody ate.** Every unlock is a
   streak, a first meal or a nutrient target — showing up, not eating. In a
   food diary this is not a nicety.
3. **No accessories that pick a gender.** Hats and scarves are fine. Bows,
   hair and lashes are not, for the reasons in `docs/artwork-brief.md`.

A new character is not a colourway: it is seven commissioned poses plus a
`build:mascot` run. Price it like the commission it is, or do not do it.

### Accessories

Nineteen things Squish can wear, one each on the head, face and neck
(`src/lib/outfit.ts`; artwork in `design/extras`, turned into app code by
`npm run build:accessories`). They follow the same three rules:

- **Earned:** party hat (first meal), round glasses (three days running),
  knitted scarf (a full week), headphones (fifty days logged, in a row or
  not), squad cap (a friend you invited got going).
- **Plus:** crown, heart sunglasses.
- **Packs, bought once:** Chef (hat, neckerchief), Sporty (sweatband, medal),
  Cosy (beanie, earmuffs). Shown in the app but not on sale — there is nowhere
  for a purchase to live yet (below).
- **Seasonal:** one or two per season (Santa hat and antlers in December,
  glitter glasses at New Year, then Valentine's, Spring, Summer, Halloween).
  Listed only in season, and worn with Plus while it lasts. The brief promises
  that anyone who gets a seasonal item keeps it; that needs the purchase record
  too, so for now it goes back in the box when the season ends.

What is worn is re-checked every time Squish is drawn, so a lapsed
subscription or an ended season takes the item off without anything having to
tidy up, and it comes back if they do.

### Home scenes

Twelve places for the Home card to show behind Squish, each light and dark
(`src/lib/scenes.ts`; copied into `src/assets/scenes` by
`npm run build:scenes`). Morning kitchen is earned at two weeks of logging and
the park picnic at thirty days, and the beach by coming back after a week or
more away ("Welcome back"); starry night and space come with Plus;
the rainy window is in the Cosy pack; and each season has one (snowy village,
fireworks, sweet shop, blossom garden, ice-lolly stand, pumpkin patch), on the
same terms as seasonal accessories. The same every-render check applies: a
scene somebody may no longer use falls back to the plain card.

### Share frames and stickers

For the progress card (`src/lib/shareDecor.ts`; copied into
`src/assets/share` by `npm run build:share-art`): one frame and up to two
stickers, picked on the share sheet. Frames: scallop (earned by sharing once),
confetti (a full week), botanical and gold foil (Plus), and a frame per
season with Plus. Stickers: eight earned against existing achievements (first
meal, three days, water goal, fibre target, a 75+ day, a full week), four with
Plus, streak badges at 7, 30, 100 and 365 days, and three per season that are
free for everybody while it lasts, as the brief asked.

## Inviting friends

Every account has an invite link (squish.online/r/SQ…, on You and sent with
any shared card). A friend who joins by it and then **confirms their email and
uses Squish on three different days** gets a month of Plus, and so does the
person who invited them — up to twelve months a year for the inviter
(`server/friends.ts`). The three days are counted from the server's own record
of the days a device was seen since sign-up, so they cannot be faked from the
phone or squeezed into one afternoon.

**For somebody already on Plus** — above all on a yearly plan — a month more
at the far end of their subscription is a thank-you they would not notice for
months. So they get extra AI straight away (20 photo analyses and 10
nutritionist questions on top of their allowance, for 30 days), and the month
is saved: added to the end of their current Plus. The friend, new, gets Plus
switched on. Which one happened is recorded on each side
(`friend_referrals.referrer_kind` / `friend_kind`).

The numbers are environment variables: `SQUISH_FRIEND_DAYS` (30),
`SQUISH_FRIEND_QUALIFY_DAYS` (3), `SQUISH_FRIEND_CAP` (12), and for the
subscriber's extra AI `SQUISH_FRIEND_BOOST_PHOTOS` (20),
`SQUISH_FRIEND_BOOST_CHATS` (10) and `SQUISH_FRIEND_BOOST_DAYS` (30). The
extra AI costs about £1 at most per reward.

And for every inviter, on or off Plus, the **squad set**: a cap for Squish, a
share frame and a "Squad" badge, earned the first time a friend they invited
gets going and never sold (the `squad` achievement). Home says so, and the
invite card plays the badge's one-second unlock once — the still badge for
anybody who has asked for less motion.

What it costs: a month of Plus is at most about £2.92 of AI for somebody who
uses every allowance, and nearer £1 for a typical user — per side, so up to
about £6 for a friend who has already shown they will use Squish.

**Before the iPhone and Android apps take payments,** this needs another
look. The saved month extends `plus_until` on our server, which is fine while
Plus is granted rather than bought. For somebody paying through a store it
does nothing to their store subscription, so the saved month should become:
on Google Play, deferring their next payment by a month (the Play Developer
API's subscription defer); on the App Store, a promotional offer of a free
month, which Apple applies at their next renewal. The extra AI needs no change
— it is ours to give. Apple also reviews incentives
for inviting people, so check the guidelines at submission.

## What has to exist first

**Accounts.** Not for their own sake — for three things that cannot be done
without them:

- **Billing.** Obvious, and the least interesting of the three.
- **Capping.** Done: allowances are counted per person per month against the
  database. The per-IP limit it replaced is still there underneath, for the
  case there is no database to count against.
- **Somewhere for a purchase to live.** This is the one people miss. A
  purchase in `localStorage` evaporates when somebody clears their browser, and
  that is a refund request and a one-star review. It is the same storage risk
  that threatens the diary itself (`docs/phone-app.md`).

**A way to give it away.** Done. Testers, press, and goodwill after something
went wrong all need the paid tier without a card, and invite codes do it —
made in the dashboard, with a use limit and a note, and retired the same way.
It matters that this is not a developer job: anything that needs a shell gets
done grudgingly or not at all.

**And a receipt that cannot be edited.** Half done. The answer now comes from
the server (`src/lib/plan.ts` asks, `server/plan.ts` decides) rather than from
a value in the browser, which was the rule that mattered — a paywall a devtools
console defeats funds nothing. What is still missing is the receipt itself:
`plus_until` is set by hand or by an invite code today, and when there is real
money it has to be set by something a store signed, via RevenueCat or by
verifying Apple and Google on our own server.

## When this moves to the phone

- Apple and Google take **30%, or 15%** under their small-business programmes,
  which Squish qualifies for until it is turning over a million a year. Apply
  for both; it is a form, not a negotiation.
- **Subscriptions must be sold through the stores' own billing** on iOS. There
  is no arguing with this one.
- **If there are accounts, Apple requires in-app account deletion.** Not a
  support email — a button. Build it with the accounts rather than after.
- The web version can take payment however it likes, which is worth
  remembering: the same subscriber, subscribing on the web, is worth 15–30%
  more.
