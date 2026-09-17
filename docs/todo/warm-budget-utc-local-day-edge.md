# The warm-budget deployment rows fail for one hour a day

**Status:** open. Reproduced on a clean tree at 00:58 Europe/Dublin (23:58 UTC).

## What is missing

Three tests in `src/lib/server/platform/warm-budget.test.ts` — `deployments stays within its
warm budget`, `the store costs three requests cold…` and `the two deployment series
accumulate…` — fail between 00:00 and 01:00 Irish time, and pass the rest of the day. The
harness takes `now = new Date()`; the Octopus mock spreads its runs backwards from that
instant; the deployment series accumulate on a **day** bucket. For the hour in which the
local date and the UTC date disagree, the "newest provisional day" straddles two days and
the warm read asks for more of the window than the ceilings allow (18 against 16; 15
against 10; the cold-minus-warm saving drops to exactly 30).

## Why it matters

A green suite that turns red on the clock is a suite nobody trusts at midnight — and CI in
another timezone will meet this hour at a different wall-clock time than a laptop does.

## What done looks like

Either the harness pins `now` to a fixed UTC instant well inside a day (the fixture rule —
"anything time-relative takes the clock as an argument"), or the day bucket and the mock
agree on one calendar. Then a test that runs the file with `now` at 23:58 UTC and at
00:02 UTC, both green.

## Where the code is

- `src/lib/server/platform/warm-budget.test.ts` — `harness()` (`const now = new Date()`), the
  `WARM_CEILING` table, the two "what the store actually buys" tests
- `src/lib/server/sources/providers/octopus/mock/data.ts` — `buildEstate({ now })`
- `src/lib/server/sources/series.ts` — the day-bucket geometry for `deployment.*`

**Blocked on:** nothing.
