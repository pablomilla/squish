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
| `--sub 4.99` | 4.99 | Subscription price for the margin table |
| `--yes` | off | Skip the "this spends money" prompt |

## Reading the result

**Within 20%** is the number that matters most. A calorie estimate inside 20% is close enough that
someone can use it and trust it; consistently worse than that and they stop logging. Mean error can
hide a model that is usually excellent and occasionally absurd, so look at the per-meal table too.

**Run spread** (with `--runs 3`) tells you whether the same photo gives the same answer twice. A
model that swings 30% between runs on one photo will feel broken to a user even if its average is
good.

The cost table answers the business question: at three meals a day, what does one subscriber cost
you every month, and what is left after the store takes its cut.
