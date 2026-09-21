# The lookup group with salt and the protein window fixed

Ten `lookup` cases at ten repetitions, Opus 5 against Sonnet 5, 22 September
2026. Third run of the same question; `lookup-confirm/` was the first,
`lookup-confirm-2/` the second, after `salt` was fixed.

|  | run 1 | run 2 | run 3 |
|---|---|---|---|
| Opus 5, medium | 81% | 92% | **95%** |
| Sonnet 5, medium | 71% | 78% | **81%** |

Both arms rose each time a case stopped marking the window instead of the
answer. Neither model changed.

95 against 81, p = 0.002. This is no longer one case.

| case | Opus | Sonnet |
|---|---|---|
| days-logged, last-fish, named-day, salt, usual-breakfast, worst-day | 10/10 | 10/10 |
| fibre | 10/10 | 9/10 |
| week-summary | 10/10 | **5/10** |
| protein-trend | 6/10 | 5/10 |
| weekends | 9/10 | **2/10** |

## What Sonnet is actually doing

It declines to state a computed summary figure, and gives the underlying
spread instead. The same behaviour in three cases:

- `weekends` — reports two ranges, "1,750–1,950 against 2,200–2,500", and
  never subtracts one from the other, which is the question.
- `protein-trend` — "often dipping into the 80–110g range" instead of a
  starting average.
- `week-summary` — names Saturday at 2,520 kcal and Sunday at 2,090, and
  never gives the week's average.

`week-summary` is the one to trust most: it fails on the **code check**, not
the judge. No figure within 120 of 1,947 appears anywhere in the answer. That
is arithmetic, not marking taste.

Opus states the summary figure in all three and scores 10/10, 10/10 and 6/10.

## protein-trend is still not fixed

Opus fails it 4/10, and on the window again, not on the trend: "the fortnight
to 3 May you averaged about 114 g", "mid-April, around 108 g". The claim was
widened to say a longer opening stretch reads higher, but it still anchors on
93 g and the judge still rejects 108 and 114 against it.

Worth 3 points to each arm when it was half-fixed; the rest is still sitting
there. Opus's real lookup figure is above 95%.
