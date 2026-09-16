# Warm-store grain switch double-counts deployment runs

**Status:** open. **HIGH PRIORITY** — this is the exact class of failure this project
exists to prevent, already reaching production numbers today.

## What is missing

Reading a deployment trend against a warm store, then reading the same capability at a
different grain, double-counts runs. Measured while reviewing Task 9: `readTrends(scope,
'daily')` followed by `readTrends(scope, 'monthly')` against one warm store reports **64
runs for 32 real ones**. On `b56de59` — before Task 9 touched anything — the same
experiment against a longer window gave **423 runs for a cold reading of 237**. The bug
predates this branch; Task 9 only widened where it can be triggered from.

**Cause.** `gapFor`'s high-water mark and a provider's window both key off the _requested
grain_, inside one capability partition (`source_series` is partitioned by capability, not
by grain — see `CLAUDE.md`'s "What the store buys, and what it cannot", the Task 9
correction). A daily read advances the high-water mark by daily buckets; a monthly read
against the same partition sees "already covered" for a range it has in fact only ever
seen bucketed differently, and asks the provider for an overlapping window on top of what
is already stored — so the same runs are counted once under the daily buckets and again
under the monthly ones.

**What Task 9 widened.** Before this branch, only the estate screen's own grain switching
(fortnight/quarter/year, `readTrends`) could trigger this. Now `readTrends` and
`readServiceTrends` share the `deployment.serviceTrends` partition (`estateTrendsOf`
collapses the per-service rows), so a domain tab's daily read and the estate screen's
monthly read poison the same partition. A reader who opens a domain's Deployments tab and
then the estate Deployments screen can now trigger the double-count that previously needed
two reads of the same screen.

## Why it matters

Wrong deployment counts are the specific failure this codebase's whole gap-handling
doctrine exists to prevent — a stated gap is honest, a silently wrong number is not. "64
runs for 32 real ones" is not a rounding error; it is double the truth, and it degrades
silently with no panel, no log line and no test currently watching for it.

## What to do

Needs a design decision, not a mechanical fix — two candidates, both real edits to the
store's accumulation core:

1. **Key the partition by grain.** Reverses `1476c40`'s deliberate "grains share rows"
   decision, which exists specifically so three grains do not each pay for their own
   window. Fixes the bug at the cost of the thing that commit was for.
2. **Align the provider's bucketing to the geometry rather than the requested grain**, so
   `gapFor`'s high-water mark means the same thing regardless of which grain asked for it.

Either needs a Postgres-backed test that reads two grains in sequence against one warm
store and asserts the total does not move — `warm-budget.test.ts`'s harness is the right
shape to extend, but it currently asserts request _counts_, not result _correctness_, and
this bug would pass every existing budget assertion unnoticed.

## Where

- `src/lib/server/sources/store/postgres-store.ts` — `gapFor`, the high-water mark
- `src/lib/server/sources/routers/deployment-series-shape.ts` — the geometry
  (`bucketSeconds`, `settlingSeconds`) each grain reads against
- `src/lib/server/sources/routers/deployment.ts` — `readTrends`/`readServiceTrends`, the
  two capabilities now sharing the widened blast radius
- `src/lib/server/platform/warm-budget.test.ts` — where a correctness assertion belongs
  beside the existing cost assertions
