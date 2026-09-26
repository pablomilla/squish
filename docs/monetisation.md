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

**£6.99 a month, or £49.99 a year**, with a usage allowance **even on the paid
tier**. The allowance is not meanness: a heavy user costs £5.65, so without one
the best customers are the ones losing the most money. Every app in this
category caps AI usage on paid plans for exactly this reason.

It was £4.99 and £39.99 until 23 September 2026, before anything was sold.
What changed was doing the sum properly. UK store prices include 20% VAT, and
the store's cut comes off what is left:

| Price | Squish receives (15% tier) | A month |
|---|---|---|
| £4.99 a month | £3.53 | £3.53 |
| £39.99 a year | £28.33 | **£2.36** |
| £6.99 a month | £4.95 | £4.95 |
| £49.99 a year | £35.41 | £2.95 |

Somebody who uses all of Plus's allowance costs about £2.65 a month before
recipe imports. On the old yearly price, the people most likely to buy a year
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

| Country | A month | A year | A year, a week |
|---|---|---|---|
| United Kingdom | £6.99 | £49.99 | £0.97 |
| Ireland | €7.99 | €57.99 | €1.12 |
| United States | $7.99 | $59.99 | $1.16 |
| Canada | C$9.99 | C$74.99 | C$1.45 |
| Australia | A$11.99 | A$84.99 | A$1.64 |
| New Zealand | NZ$12.99 | NZ$89.99 | NZ$1.74 |

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
uses every last allowance; everybody else is comfortably profitable. `SQUISH_PLUS_RECIPES`
changes it without a deploy.

### Plus weekly plans: 4 a month

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
needing a deploy: `SQUISH_PLUS_WEEKPLANS` sets the monthly cap, and
`SQUISH_WEEKPLAN_MODEL` can put plans on a cheaper model (Sonnet 5's output
is $10 per million tokens against Opus 5's $25) without touching the rest.
Check the logged costs after the first week and set them from those.

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
