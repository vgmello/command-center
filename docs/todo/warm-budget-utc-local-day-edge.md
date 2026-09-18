# The warm-budget deployment rows fail in the hour before the UTC day turns

**Status:** open. Reproduced on a clean tree at 23:58 UTC; green again at 00:01 UTC.

## What is missing

Three tests in `src/lib/server/platform/warm-budget.test.ts` — `deployments stays within its
warm budget`, `the store costs three requests cold…` and `the two deployment series
accumulate…` — fail in the last hour of the UTC day and pass the rest of it. The harness
takes `now = new Date()`; the Octopus mock spreads its runs backwards from that instant; the
deployment series accumulate on a **day** bucket aligned to epoch milliseconds, so the
"newest provisional day" is almost empty and the previous day is still settling. In that
hour the warm read asks for more of the window than the ceilings allow (18 against 16; 15
against 10; the cold-minus-warm saving drops to exactly 30). Nothing in the path reads a
local calendar — the file passes under `TZ=Pacific/Honolulu` and `TZ=Pacific/Kiritimati`
alike at 00:04 UTC — so the timezone of the machine is not the variable; the wall-clock UTC
hour is.

## Why it matters

A green suite that turns red on the clock is a suite nobody trusts at midnight — and CI in
another timezone will meet this hour at a different wall-clock time than a laptop does.

## What done looks like

The harness pins `now` to a fixed UTC instant well inside a day (the fixture rule —
"anything time-relative takes the clock as an argument"), and a test runs the file with
`now` at 23:58 UTC and at 00:02 UTC, both green.

## Where the code is

- `src/lib/server/platform/warm-budget.test.ts` — `harness()` (`const now = new Date()`), the
  `WARM_CEILING` table, the two "what the store actually buys" tests
- `src/lib/server/sources/providers/octopus/mock/data.ts` — `buildEstate({ now })`
- `src/lib/server/sources/series.ts` — the day-bucket geometry for `deployment.*`

**Blocked on:** nothing.
