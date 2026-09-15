# Domain detail tabs: Services, Deployments, SLOs

**Date:** 2026-09-15
**Status:** approved for planning

## Goal

Replace three of the six "not built yet" placeholders on the domain detail screen with
purpose-built pages: **Services**, **Deployments** and **SLOs**.

Each answers a question a reader standing on a domain page actually has, rather than
rendering a fleet-wide screen with a filter pre-applied. The domain strip goes from two
built tabs of eight to five.

## Not in this spec

Three tabs remain placeholders, each for its own reason, and each earns a separate design:

- **Alerts.** The reference mock carries MTTA, MTTR, alert noise, per-rule aggregation and
  an on-call panel. None of that is measured today, and on-call is a _fifth source kind_ —
  a paging product, not APM data narrowed. Roughly the size of this whole spec.
- **Infrastructure.** `cloud.*` capabilities are estate-wide. Nothing says which machines
  belong to a domain, and inventing the association would assert ownership nobody checked.
  `CatalogDomain.bindings` is the seam; what a `cloud` binding points at (a tag, a resource
  group, a subscription slice) is the open question.
- **Logs.** No log capability exists anywhere — no contract method, no Coralogix endpoint,
  no mock. It should be designed alongside the top-level Logs screen, which is also unbuilt.

See `docs/todo/` for the standing record of all three.

## Architecture

### One shared header query, one query per tab

The built precedent has a flaw this spec fixes while passing through.
`domains/[slug]/dependencies/+page.svelte` calls `getDomainView` — the Overview's
composite — to draw one graph, fetching the service table, the deployment log and the
incident list to render none of them. Three more tabs copying that would be four pages
each over-fetching four datasets, and it contradicts the repo's own rule: _split queries by
how often they change; do not merge two queries just because one page renders both._

```
getDomainHeader(slug)         → domain record + status        ← every tab
  ├── getDomainView(slug)     → the Overview composite          (exists, unchanged)
  ├── getDomainServices(…)    → service vitals                  (new)
  ├── getDomainDeployments(…) → log + domain-scoped aggregates  (new)
  └── getDomainSlos(slug)     → pinned headline + per service   (new)
```

`getDomainHeader` is catalog-only and identical on every tab, so it caches and costs
almost nothing. `dependencies` moves onto it too, dropping from four datasets to one.

### Real routes, one canonical URL each

Each tab gets its own directory — `domains/[slug]/{services,deployments,slos}/` — and
`[tab]/+page.ts` rejects that segment as it lands, the way it already rejects `overview`
and `dependencies`. A section with two URLs is a section a link can disagree about.

### Per-service deployment accumulation

This is the substantive change and the one worth reading carefully.

**The problem.** A domain's deployment frequency, change failure rate and mean duration are
not answerable today. `readSummary`, `readTrends` and `readStatusTrend` are estate-wide and
take no domain; `readDomainBreakdown` gives per-domain counts and nothing else.

**The rejected fix.** Adding a domain argument to those three methods widens the contract
every provider implements, pushes domain semantics into every adapter, and asks Octopus a
question per domain at read time.

**The design.** Aggregate per _service_, and let a domain be the sum of its services.

`source_series` already carries `entity` in its primary key and `SeriesKey` already exposes
it — today `deployment.trends` writes `entity: ''`. A new capability writes one key per
service instead, and every rollup is a sum over rows we already hold:

```
entity = 'payment-api'      ← accumulated
entity = 'payment-gateway'  ← accumulated
        ↓ sum
  Payment Domain            ← the domain tab
        ↓ sum over all entities
  the estate                ← the deployments screen
```

Three properties make this the right shape rather than merely a workable one:

1. **No existing signature changes.** `readServiceTrends` is a new _optional_ method on
   `DeploymentProvider`, declared only where implemented — the same rule every capability
   follows. A provider that cannot answer it leaves the domain aggregate panels as stated
   gaps, and the log below them still renders.
2. **The means stay correct.** The store already decomposes `run_count` and
   `duration_total` so a mean is rebuilt by dividing sums. Built for re-grained buckets; it
   works identically for rolling services into a domain. Two runs at 10s and two hundred at
   1,000s is a domain mean of 990, not the 505 that averaging two service means gives.
3. **It costs the upstream nothing.** Octopus already builds `readTrends` from `Deployment`
   rows fetched into its shared window, and those rows carry `service` and `domainId`. The
   per-service variant groups the same rows differently — **no additional Octopus request**
   — and domain reads then come off Postgres.

It also unblocks more than this spec: the service Deployments tab gets its aggregates free,
and the per-service breakdown becomes possible, which is the panel that earns the tab.

#### Specifics

|            |                                                                                |
| ---------- | ------------------------------------------------------------------------------ |
| Capability | `deployment.serviceTrends`                                                     |
| Contract   | `readServiceTrends?(ctx, grain): Promise<ServiceTrend[]>`                      |
| Tier       | `series` — `tiers.test.ts` and `dispatch-tiers.test.ts` both assert this holds |
| Geometry   | day bucket, day settling, year horizon — identical to `deployment.trends`      |
| Entity     | the service's catalog slug                                                     |
| Metrics    | `run_count`, `duration_total`, `failure_count`                                 |

`failure_count` is new beside the two the estate trends already store, because change
failure rate is a headline on this tab and a rate cannot be re-aggregated from rates — it
has to be two counts that each sum.

The answer shape, stated so a provider author is not guessing:

```ts
/** One service's runs over the window, decomposed so every figure re-aggregates. */
export interface ServiceTrend {
	/** The service as the catalog names it, or '(unattributed)'. */
	service: string;
	/** Runs started in each bucket. */
	runs: TimeSeries;
	/** Runs that failed or were rolled back, same buckets. */
	failures: TimeSeries;
	/**
	 * Total wall-clock seconds of the runs that finished, same buckets.
	 *
	 * The total rather than the mean, for the reason the estate trends already store it
	 * that way: a mean cannot be rebuilt from means.
	 */
	durationTotal: TimeSeries;
}
```

**Attribution.** A deployment whose service is not in the catalog accumulates under
`entity: '(unattributed)'` rather than being dropped. Silently discarding runs makes a
frequency chart understate reality, and a visible bucket is a prompt to fix the catalog.

**One accumulation per connection, never two.** A connection that declares
`deployment.serviceTrends` accumulates per service and does **not** also accumulate
`deployment.trends`; a connection that declares only `deployment.trends` is unchanged in
every respect. Writing both for the same runs would put two answers to one question in the
store, and nothing could say which was right.

**The estate read sums every entity, `''` included.** That is what makes the switchover
seamless rather than a cutover. Rows already stored under `entity: ''` cannot be attributed
to a service after the fact, so they stay where they are and keep counting toward the
estate figure; per-service rows begin at the migration and fill forward. Because the two
are never written for the same period, summing all entities double-counts nothing — and
the deployments screen needs no knowledge of which era a row came from.

The one consequence to state on screen: a domain tab has no history before the migration,
because history under `''` belongs to no domain. The frequency chart shows the window it
actually has rather than padding with zeros, which would report a quiet fortnight that
never happened.

**Row volume.** ~75 services × daily buckets × 365-day horizon × 3 metrics ≈ 82k rows.
Comfortable for Postgres, and stated so nobody discovers it.

## The tabs

### Services

```
┌─ 2 services ──────────── 2 healthy · 0 degraded · 0 down ─────┐
├────────────────────────────────────────────────────────────────┤
│ Service          Status    RPS     Err    P95    Inst   Trend  │
│ payment-api      Healthy   2.1k   0.02%  120ms   6/6    ╱╲╱    │
│ payment-gateway  Healthy   840    0.01%   89ms   3/3    ╲╱╲    │
└────────────────────────────────────────────────────────────────┘
```

`ServiceVitals` already carries every column, and `listServiceVitals` already returns
exactly `serviceCount` rows whose statuses sum to the header's split — so the table cannot
disagree with the header above it. That invariant has a test today and keeps it.

**No search box.** Domains average two to four services; a filter over four rows is a dead
control, and the fleet-wide `/services` screen is where searching belongs. Columns sort.

Rows link to `/services/[slug]`, which exists.

### Deployments

DORA framing, because those are the questions and this data answers three of them.

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│ Deploys      │ Failure rate │ Mean duration│ Last deploy  │
│ 34 /14d      │ 5.9%         │ 4m 12s       │ 2h ago       │
│ ↑ 21%        │ ↓ 3pp        │ ↑ 18s        │ payment-api  │
└──────────────┴──────────────┴──────────────┴──────────────┘
┌─ Frequency ─────────────────┬─ By service ──────────────────┐
│  ▁▃▂▅▃▇▄▂▅▃▆▄▃▅             │ payment-api      28  3.6% ▁▃▅ │
│                              │ payment-gateway   6 16.7% ▃▂▁ │
└──────────────────────────────┴───────────────────────────────┘
┌─ Deployment log (this domain) ────────────────────────────────┐
│ #17892  payment-api  v2.4.1  prod  Succeeded  4m02s  2h ago   │
└────────────────────────────────────────────────────────────────┘
```

**"By service" is the panel that earns the tab.** "Your domain fails 5.9% of the time" is a
number; "payment-gateway fails 16.7%, and it is six deploys" is something to act on. The
fleet-wide deployments screen cannot show this — it has no domain to break down within.

The log is `queryDeployments` with `domain` set, which works today. The four tiles and both
charts come from `deployment.serviceTrends` summed over the domain's services.

The window is stated on the tab, not implied. "34 deploys" means nothing without "/14d".

### SLOs

```
┌─ Availability (30d rolling) ──────────────────────────────────┐
│  99.95%  target 99.90%          21m of budget remaining       │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░  49% burned · last 7 days   ╲╱╲      │
├────────────────────────────────────────────────────────────────┤
│ Service          Achieved  Target  Remaining  Burn            │
│ payment-api       99.97%   99.90%   28m       ▓▓▓░░  31%      │
│ payment-gateway   99.93%   99.90%   14m       ▓▓▓▓░  62%      │
└────────────────────────────────────────────────────────────────┘
```

**The headline is pinned, never recomputed.** `DomainVitals` already carries
`sloCompliancePct` and `sloWindowLabel`, and the domain header prints them. A tab that
derived its own compliance figure from the services would make a reader switching tabs
watch the number move for no reason — the same failure the metrics tab's pinning rule
exists to prevent. The per-service budgets are the _detail beneath_ the stated figure, not
a second aggregate.

`readSloBudget` is per service, so N services is N reads. It is `reference` tier and the
store caches it; the measured cost lands in the budget tests rather than being assumed.

## Public API

Every new screen owes `/api/v1` its resources. `domains/{slug}/services` exists already.
Two paths are added:

- `GET /api/v1/domains/{slug}/deployments` — the domain's log and its aggregates
- `GET /api/v1/domains/{slug}/slo` — the pinned headline and the per-service budgets

Both follow the existing rules: frozen DTOs with a shape test per resource, `@swagger`
annotation above the handler, regenerated `components.yaml`, measurements rather than
renderings on the wire (minutes not `"21m"`, seconds not `"4m 12s"`, counts not
percentages computed against whatever `limit` returned).

## Gaps

Every source-backed read on all three tabs is wrapped in `panel()`. These are the first new
screens since the sweep was tightened to "no screen falls over, full stop", and
`capability-gaps.test.ts` drops one capability at a time across every screen — so the three
new routes are added to its sweep in the same change, not afterwards.

A provider that does not implement `deployment.serviceTrends` leaves the four tiles and
both charts as stated gaps while the log renders normally. That is the intended
degradation, and it is what the fixture-free configurations exercise.

## Testing

| Layer    | What                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit     | the rollup arithmetic — a domain mean rebuilt from sums, a failure rate from two counts, and the case that broke the estate trends: buckets with wildly different run counts |
| Unit     | attribution — a deployment with no catalog service lands in `(unattributed)` rather than vanishing                                                                           |
| Contract | `tiers.test.ts` and `dispatch-tiers.test.ts` for the new capability                                                                                                          |
| Sweep    | `capability-gaps.test.ts` gains the three routes                                                                                                                             |
| Budget   | `request-budget.test.ts` and `warm-budget.test.ts` gain a row per tab; the SLO tab's N-reads cost is measured, not estimated                                                 |
| e2e      | the three routes join `ROUTES` in `e2e/harness.ts`, so the render sweep covers them under fixtures **and** under real adapters                                               |

The e2e half is not optional here. Every rendering bug this repo has had passed `check`,
`lint` and the full unit suite — `2.1387043477711356 req/s` and `41.12903225806452%` both
shipped green — and three of this session's bugs existed only under real adapters.

## Risks

**The pinned SLO headline can still disagree.** Pinning fixes the tab against the header,
but `DomainVitals.sloCompliancePct` and the per-service budgets come from different reads
and could describe different windows. The tab must print the window it is showing
(`sloWindowLabel`) beside the figure, so two different periods are never rendered as one.

**Per-service accumulation changes the estate path.** Moving the deployments screen onto a
sum-over-entities read is the riskiest edit in the spec, because that screen is measured and
already had one silent regression — both trends fell through the tier _and_ the cache and
nobody noticed for the project's whole life. The budget tests are the guard, and they are
run before and after rather than only after.

**Row volume is stated, not bounded.** 82k rows is fine; a much larger estate is a
different conversation. The horizon is the lever if it ever matters.
