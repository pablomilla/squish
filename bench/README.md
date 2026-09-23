# The benchmark set

The benchmark is only as good as the numbers you put in `manifest.json`. Everything the report says
about accuracy is really a comparison against *your* figures, so they have to be right.

## Getting ground truth

Ranked by how much you can trust them:

1. **Packaged food, eaten whole.** A ready meal, a protein bar, a sandwich. The label is the answer.
   Photograph the food, not the packet.
2. **Weighed ingredients.** Kitchen scales and a reference table. Weigh everything, including the oil
   — cooking fat is where photo estimates go wrong, and if you leave it out of your figures you will
   blame the model for your own omission.
3. **Chain restaurants** that publish nutrition. Accurate enough, as long as you order it as listed.
4. **Your own estimate.** Don't. You would be measuring the model against a guess.

## Weighing the plate, not just the ingredients

If you want to know how good the **portion** estimates are — which is the thing that decides whether
a calorie number is any use — put a `grams` figure in the manifest: what the food on the plate
weighed, plated, before you ate it. Tare the scales with the empty plate on them and serve onto it.

It is worth the extra thirty seconds because calories can come out right off a portion guessed
wrong. A model that thinks your 165 g of porridge is 330 g of something half as rich lands the
calorie number perfectly and has understood nothing. The portion column catches that; the calorie
column cannot.

`grams` is optional per meal. Meals without it are scored on calories and macros as before, and the
portion figures are worked out over the ones that have it.

## Does telling Squish your plate size help?

Squish can be told the width of your dinner plate, and passes it to the model as a scale reference.
Whether that actually improves anything is an empirical question, and this answers it:

```bash
npm run bench -- --compare-plate --plate 27 --bowl 400
```

Every photo is analysed twice — once with the plate size and once without — and the report opens
with the difference. Two things to know before you read the answer:

- **It doubles the cost.** Two arms means two analyses per photo per model.
- **Photograph the plate.** The plate size can only help if the plate is in the frame. If your
  photos are close crops of the food, this measures nothing, and the honest result will be "no
  difference" for a reason that has nothing to do with the feature.

The verdict is deliberately hedged below twenty analyses. Six photographs cannot settle this, and a
confident answer off six photographs would be worse than no answer.

## Choosing the meals

Twenty meals is enough to see a real difference between models. Aim for a set that looks like what
people will actually photograph, not a set that flatters the model:

- A spread across breakfast, lunch, dinner and snacks.
- **Mixed dishes** — curry, stew, pasta bake. Where the ingredients are not visible is where this
  gets hard, and it is most of British home cooking.
- **Hidden fat** — anything fried, dressed, or buttered.
- **Awkward portions** — a half-eaten plate, a shared platter, a huge bowl of something light.
- **Drinks** — a latte, a pint, a smoothie. Easy to miss entirely.
- A couple of **near-identical meals at different sizes**, to see whether portion estimation is real
  or whether it is pattern-matching the dish.

Photograph them the way a user will: phone in one hand, from above, whole plate in frame, normal
kitchen light. A beautifully styled photo tells you nothing about Tuesday night.

## Running it

```bash
cp bench/manifest.example.json bench/manifest.json   # then edit it to match your photos
npm run bench
```

Your photos and results stay out of git — they are meals from your kitchen, and the repo is public.

| Flag | Default | What it does |
| --- | --- | --- |
| `--models a,b` | opus-5, sonnet-5, haiku-4-5 | Which models to compare |
| `--runs 3` | 1 | Repeat each photo, to see run-to-run spread |
| `--sub 6.99` | 6.99 | Subscription price for the margin table, VAT included as on the stores |
| `--yes` | off | Skip the "this spends money" prompt |
| `--plate 27` | off | Tell the model your dinner plate's width, in cm |
| `--bowl 400` | off | And your usual bowl's volume, in ml |
| `--compare-plate` | off | Run every photo twice, with the plate size and without |

## Reading the result

**Portion error** is the one to look at if you weighed anything. It is the mean percentage error
against what the food on the plate weighed, and it is the only measure of portion estimation that
cannot be flattered by two errors cancelling.

**Within 20%** is the number that matters most for calories. A calorie estimate inside 20% is close enough that
someone can use it and trust it; consistently worse than that and they stop logging. Mean error can
hide a model that is usually excellent and occasionally absurd, so look at the per-meal table too.

**Run spread** (with `--runs 3`) tells you whether the same photo gives the same answer twice. A
model that swings 30% between runs on one photo will feel broken to a user even if its average is
good.

The cost table answers the business question: at three meals a day, what does one subscriber cost
you every month, and what is left after the store takes its cut.
