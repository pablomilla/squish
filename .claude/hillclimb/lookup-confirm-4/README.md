# The lookup group, with every broken case fixed

Ten `lookup` cases at ten repetitions, Opus 5 against Sonnet 5, 22 September
2026. Fourth and last run of the same question.

|  | run 1 | run 2 | run 3 | run 4 |
|---|---|---|---|---|
| Opus 5, medium | 81% | 92% | 95% | **100%** |
| Sonnet 5, medium | 71% | 78% | 81% | **79%** |

Opus answers all ten cases correctly, ten times out of ten. It was doing that
in run 1 as well; what changed across the four runs was `salt` and
`protein-trend`, both of which had been marking which window an answer chose
rather than whether it was right. Sonnet sat at 78–81% throughout, so the
fixes lifted the measurement, not the models.

100 against 79. The gap no longer rests on one case: take `weekends` out and
it is 90/90 against 79/90, p = 0.001.

| case | Opus | Sonnet |
|---|---|---|
| days-logged, last-fish, named-day, protein-trend, salt, weekends, week-summary, worst-day, usual-breakfast, fibre | **10/10** | — |
| weekends | 10/10 | **0/10** |
| week-summary | 10/10 | **5/10** |
| usual-breakfast | 10/10 | 7/10 |
| fibre | 10/10 | 9/10 |
| protein-trend | 10/10 | 8/10 |

## What Sonnet does

It will not state a computed summary figure, and gives the underlying spread
instead. `weekends`: two ranges, never subtracted — 0/10 here and 2/40 across
all four runs. `week-summary`: Saturday and Sunday named individually, no
weekly mean, and that one fails the **code check** rather than the judge, so
it is arithmetic and not marking taste.

Separately, on `usual-breakfast` it adds a fourth regular breakfast the diary
does not have — "a jacket potato day where breakfast slips" — against a claim
that asks for those breakfasts and no others.

## A limit of this group now

Opus is at the ceiling. The lookup group can no longer tell it apart from
anything better, and a future change that makes lookups worse is all it can
detect. That is the right problem to have here, but it means the number is a
floor check from now on, not a comparison.
