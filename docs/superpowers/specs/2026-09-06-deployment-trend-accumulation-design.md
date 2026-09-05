# Deployment trend accumulation

**Status:** proposed
**Supersedes nothing.** Extends `2026-09-04-source-store-design.md`, which defined the
three capability tiers and built the accumulation path for exactly one capability.

## The problem, measured

The deployments page costs 45 upstream requests warm — the same as cold — on an instance
with a warm Postgres. Every other screen improves. Measured per capability against the
Octopus mock, on a second instance with an empty memory tier:

| Warm read                      | Requests |
| ------------------------------ | -------: |
| `readSummary`                  |        0 |
| `readDomainBreakdown`          |        0 |
| `listDeployingDomains`         |        0 |
| `listDeployments(8)` — the log |        6 |
| `readTrends`                   |       45 |
| `readStatusTrend`              |       45 |

The live log is not the expensive part. At six requests it is already cheap, and it stays
`live` deliberately: a deployment feed read back off disk is a feed that has stopped
reporting.

The 45 is one full window. `loadWindow` pages 400 rows at 30 per page, and each page costs
three requests — the page itself plus a `/api/tasks` and a `/api/Spaces-1/releases`
enrichment call — so fourteen pages cost 42, plus three for the catalogue.

## Root cause: a tier with no implementation

`deployment.trends` and `deployment.statusTrend` are declared `series` in `tiers.ts`.
`fanOutSeries` is called in exactly one place — `routers/service.ts`, for
`apm.metricSeries`. The deployment router uses `fanOut` and `fanOutSingle`.

So these two fall through **both** storage strategies:

- `isDocument()` is false, because that is true only for `reference` — so the cache never
  persists them.
- No router calls `fanOutSeries` for them — so they never reach `source_series` either.

They are declared into a tier that nothing implements on their behalf, and the result is
silent: no error, no gap, just a full window fetched on every read forever.

**This is the defect worth fixing structurally, not just for these two.** Any future
capability declared `series` inherits the same silence.

## Why `fanOutSeries` cannot simply be called here

Three mismatches, each of which would produce wrong data rather than merely no saving.

**1. These capabilities ignore `scope.timeRange`.** `fanOutSeries` derives its window from
the scope. The provider does not: `readTrends` uses `TREND_DAYS[grain]` — daily 14 days,
weekly 84, monthly 365 — and `readStatusTrend` always uses 14 days. With the default scope
of `15m`, `fanOutSeries` would store a fortnight of data against a fifteen-minute window
and then serve fifteen minutes of it.

**2. The stored horizon is 24 hours.** `MAX_STORED_SECONDS` is a module constant, and
`fanOutSeries` falls back to a plain fetch above it. Every grain here exceeds it.

**3. The canonical bucket is 60 seconds, and deployments are sparse.** Metrics are
continuous — every bucket has a reading. Deployments are discrete events: 400 runs across
14 days is 400 non-empty buckets out of 20,160. Storing at 60-second resolution would write
twenty thousand rows of mostly zeros per metric, per connection, to describe four hundred
facts.

## Design

### Increment 1 — reclassify, and take the measured win now

Change both capabilities from `series` to `reference` in `tiers.ts`. Two lines.

They then persist as documents through the path `readSummary` and `readDomainBreakdown`
already use, and which already measures zero requests warm. Their existing TTLs are
unchanged and already sensible (`deployment.trends` 300s, `deployment.statusTrend` 60s) and
consistent with the sibling aggregates derived from the same window.

Measured, with only this change applied:

| Deployments page      | Requests |
| --------------------- | -------: |
| cold                  |       48 |
| warm, same grain      |    **6** |
| warm, different grain |       48 |

This is honest about what it is: a whole-answer cache keyed on the question. Switching
grain, or a TTL expiring, pays the full 48 again. It is one line per capability for an
eight-fold reduction on the common path, and it should ship before the larger work rather
than waiting behind it.

### Increment 2 — accumulate, so the grains share rows

The remaining 48s come from keying on the question. Accumulation removes that: daily,
weekly and monthly are three renderings of one underlying fact — how many runs happened,
and how long they took — and should read the same stored rows.

**Bucket geometry becomes per-capability.** `BUCKET_SECONDS`, `SETTLING_SECONDS` and
`MAX_STORED_SECONDS` are module constants today, correct for `apm.metricSeries` and wrong
here. They become a per-capability record with today's values as the default:

| Capability               | Bucket | Settling |  Horizon |
| ------------------------ | -----: | -------: | -------: |
| `apm.metricSeries`       |    60s |     300s |      24h |
| `deployment.trends`      |  1 day |    1 day | 365 days |
| `deployment.statusTrend` |  1 day |    1 day |  90 days |

A daily bucket makes the volume trivial — 365 rows per metric per connection, against the
20,160 a 60-second grid would need — and it is the right resolution on its own terms: the
finest grain any of the three charts draws is a day.

A day bucket settles once the day has ended, so yesterday is settled today. This is the
existing age-based rule with a different constant, not a new mechanism.

**The window comes from the capability, not the scope.** `fanOutSeries` gains an explicit
window parameter. The deployment router passes `TREND_DAYS[grain]`; the service router
passes what it derives from the scope today, so `apm.metricSeries` is unchanged.

**Non-additive metrics are stored decomposed.** `readTrends` returns
`{ frequency, meanDuration }`. Frequency is a count and sums. `meanDuration` is a mean, and
a mean cannot be re-aggregated from means — averaging a day of 2 runs with a day of 200
gives the wrong fortnightly figure. So store two metrics and reconstruct on read:

```
run_count       → sum
duration_total  → sum
meanDuration    = sum(duration_total) / sum(run_count)
```

That is exact, not an approximation. It is also a genuine difference from the APM shape,
which averages `p95` across buckets because a quantile cannot be re-aggregated at all
without histograms — an approximation accepted there and unnecessary here.

`readStatusTrend` returns one series per status; all three are counts and all three sum.

**`downsample` needs a summing variant.** It currently returns `total / count`. Adding an
aggregation mode — `mean` (today's behaviour, the default) or `sum` — keeps the existing
caller identical.

**Octopus must honour `ctx.window`.** The Coralogix provider already does; the Octopus
provider never reads it. `loadWindow` already takes a `notBefore` bound and already stops
early, because Octopus returns newest-first and has no date filter on the endpoint — so a
five-minute gap stops after the first page. This is the piece that turns a gap fetch into
three requests rather than 45.

**A new `deployment-series-shape.ts`**, mirroring `metric-series-shape.ts`: `flatten` an
answer into named series, `rebuild` stored samples into the answer, with the metric names
above declared rather than inferred.

### Increment 3 — make the silent case impossible

A test asserting that every capability declared `series` is actually read through
`fanOutSeries`, and every capability declared `reference` through a cached path. This is the
defect that produced the whole spec, and it is the kind that a person only finds by
measuring.

The mechanism can be as simple as a registry of which router method serves which
capability, asserted against the tier table — the same shape as `capability-gaps.test.ts`,
which drops one capability at a time and runs every screen.

## Expected result

| Deployments page      | Today | After 1 | After 2 |
| --------------------- | ----: | ------: | ------: |
| cold                  |    45 |      48 |      48 |
| warm, same grain      |    45 |       6 |       6 |
| warm, different grain |    45 |      48 |      ~6 |
| warm, after TTL       |    45 |      48 |      ~9 |

The last row is the sustained-load case and the real argument for increment 2: a document
TTL expiring costs a full window, where a gap fetch costs one page.

## Out of scope

- **Storing the deployment log as rows.** An earlier draft proposed a `source_events` table
  and pushing `queryDeployments`' filtering into SQL. The measurement above removed the
  reason: the log costs six requests, and reimplementing a tested in-memory query surface in
  SQL carries correctness risk for no measured gain.
- **The rolled-up table** for windows beyond a capability's horizon. Still deferred; the
  per-capability horizons above are chosen so nothing needs it yet.
- **`apm.latencyHeatmap`**, the third unaccumulated series capability. It has the same
  fall-through defect and should be reclassified in increment 1 alongside the other two,
  but its bucket geometry is its own question and is not designed here.

## Verification

Every number in this document was measured against the Octopus mock with a throwaway
Postgres, not estimated. The existing tests already carry the guards:

- `warm-budget.test.ts` asserts `readTrends` still costs more than 30 warm. It turns red as
  an **unexpected pass** the moment increment 1 lands, which is the signal the change
  worked; it is then rewritten to pin the new figure.
- A new test must assert that two different grains read the same stored rows, since that is
  the property increment 2 exists to create and the one thing a whole-answer cache cannot
  fake.
