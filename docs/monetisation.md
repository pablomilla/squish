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
| Manual logging, food search, favourites | Photo analysis, beyond a small monthly allowance |
| The diary, charts, streaks, achievements | The nutritionist |
| The earned colourways | The Plus colourways |
| Export | |

Everything on the left is near-free to serve, so there is no reason to gate it,
and gating it would make the app useless to somebody deciding whether to pay.
Everything on the right is the part with a bill attached.

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
