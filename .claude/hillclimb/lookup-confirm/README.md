# Is Sonnet actually worse at reading the diary?

Ten `lookup` cases at ten repetitions, two configurations, 22 September 2026 —
after the date fix. Not a third pass of the suite: one group, asked at a sample
size that could answer it.

The full re-run put `lookup` at 85% for Opus 5 and 75% for Sonnet 5, on twenty
runs each. Twenty runs cannot tell a ten-point gap from nothing, and the
headline figures the three configurations produced (81 / 83 / 84) were inside
±8 of each other, so the group numbers were the only thing left suggesting the
models differed at all. This asks that one question properly.

|  | passed | n |
|---|---|---|
| Opus 5, medium | 81% | 100 |
| Sonnet 5, medium | 71% | 100 |

Ten points, and it does not reach significance (p = 0.10). It is also almost
entirely one case:

| case | Opus 5 | Sonnet 5 |
|---|---|---|
| **weekends** | **7/10** | **0/10** |
| week-summary | 10/10 | 7/10 |
| usual-breakfast | 10/10 | 8/10 |
| fibre | 10/10 | 8/10 |
| last-fish, worst-day, days-logged, named-day | 10/10 | 10/10 |
| protein-trend | 4/10 | 6/10 |
| salt | 0/10 | 2/10 |

Set `weekends` aside and the two are level: 82% against 79%, p = 0.57.

`weekends` is not variance. Sonnet reads the right days and then reports two
ranges — "1,750–1,950 against 2,200–2,500" — without ever subtracting one from
the other, which is what the question asked for. Ten times out of ten. That is
one habit to try a prompt against, not a capability the model lacks.

The other thing here is not about models at all. `salt` fails every run under
Opus and eight of ten under Sonnet, and `protein-trend` fails more often than
it passes under both. Two of the ten lookup cases are broken for everything
that answers them, which is most of what the lookup number has been measuring.
