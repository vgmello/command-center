# Persisting what the sources tell us

An increment of [the data-source plugin design](2026-09-04-data-source-plugins-design.md).

Today every read that misses the in-memory cache goes to Azure, Coralogix or Octopus.
Those APIs have low rate limits, the cache dies with the process, and a deploy therefore
sends every instance's every panel at the upstream at once — precisely when the system is
least able to absorb it.

**The fix is not a bigger cache.** It is noticing that the thirty capabilities are three
different kinds of thing, and that one of them is not a cache at all.

## The three kinds

The existing TTL table already ranks capabilities by volatility, but it treats them all as
a blob with an expiry. Sorted by what they actually are:

| Kind          | Capabilities                                                                                                                                                                                                                                                                                                          | Where it lives                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **Live**      | `apm.serviceStats` `apm.rates` `apm.requestRate` `apm.serviceHealth` `apm.healthChecks` `apm.domainVitals` `cloud.utilization` `cloud.alerts` `deployment.log`                                                                                                                                                        | Memory only                   |
| **Reference** | `cloud.regions` `cloud.nodes` `cloud.clusters` `cloud.databases` `cloud.storage` `cloud.cost` `cloud.queues` `apm.dependencies` `apm.endpoints` `deployment.domains` `deployment.summary` `deployment.breakdown` `deployment.insights` `apm.slo` `apm.incidents` `apm.insights` `apm.platformInsights` `apm.activity` | Memory, then documents        |
| **Series**    | `apm.metricSeries` `apm.latencyHeatmap` `deployment.trends` `deployment.statusTrend`                                                                                                                                                                                                                                  | Memory, then accumulated rows |

**Live data is never persisted.** By the time it is read back off disk it is stale, and a
row written every thirty seconds for a number nobody will ever read again is cost without
benefit.

**Reference data is where a low rate limit hurts most**, because these are the expensive
calls — ARM enumerating every resource in a subscription, Octopus paging its whole project
list. They also change on a human timescale, so a persisted copy is almost always right.

### Series are accumulated, not cached

A closed bucket never changes. Yesterday's 14:00–14:05 P95 is fixed forever, so re-reading
it is pure waste — and today a 24-hour chart refreshing every thirty seconds re-fetches
twenty-four hours of immutable history 2,880 times a day.

Worse, the cache key carries the time range, so the 15-minute view and the 24-hour view
share nothing even though one is a subset of the other.

Stored as rows — `(connection, capability, environment, entity, metric, bucket_at)` — both
windows read the same rows, and a refresh fetches only the newest bucket.

## What cache-aside does and does not fix

Filling on a miss is the model here: no scheduler, no job table, and a request that finds
nothing simply fetches and stores it.

It is worth being plain about the limit. **Cache-aside lowers average load; it does not cap
peak load.** Eight instances starting cold after a deploy still miss on everything at once.
Single-flight makes that one call per instance rather than one per panel, and the shared
store makes it one call per _deployment_ once the first instance has written — but the
first wave still lands together.

So the store is paired with two things that bound the peak:

**A token-bucket limiter per connection.** A connection declares its budget; every call
takes a token and waits when the bucket is empty. This is what makes exceeding the limit
_impossible_ rather than merely unlikely — a cache cannot promise that, because a cache
only helps when it happens to be warm.

**A lease on the store.** Before fetching, an instance claims the key for a few seconds. A
second instance seeing a fresh lease waits for the row instead of issuing its own call.
That is single-flight across the deployment, not just within one process.

Together those turn the cold-start wave into one call per key across every instance, paced
by the bucket. A background refresher is the natural next increment and drops in behind the
same store without changing any caller — but it is not needed to make this safe.

## The shape

```
router → SourceCache.read(key, load)
             ├─ memory hit          → return
             ├─ store hit, fresh    → return, marked with its age
             ├─ store hit, stale    → refresh under lease, or serve stale on failure
             └─ miss                → limiter → provider → store → memory
```

`SourceCache.read(key, load)` already has exactly this shape, so **every router and every
provider is unchanged.** The persistent tier goes in behind the memory tier.

### The store is a port

```ts
interface SourceStore {
	readonly id: string;

	readDocument(key: StoreKey): Promise<StoredDocument | null>;
	writeDocument(key: StoreKey, payload: unknown, ttlSeconds: number): Promise<void>;

	readSeries(query: SeriesQuery): Promise<StoredSample[]>;
	appendSeries(samples: StoredSample[]): Promise<void>;

	/** Claim a key for a few seconds, or report who holds it. */
	claim(key: StoreKey, seconds: number): Promise<boolean>;

	/** Drop expired documents and samples past their retention. */
	prune(now: Date): Promise<void>;
}
```

Same doctrine as every other port here: an in-memory implementation for tests, Postgres
for real, and nothing above it knows which.

**Postgres through `Bun.sql`, which is native** — tier 2 of the API selection order, so
persistence costs no dependency at all. That matters: a `pg` driver would have been tier 4
and needed justifying, and the catalog's own database is coming anyway.

## Schema

```sql
create table source_documents (
  connection_id text        not null,
  capability    text        not null,
  args          text        not null,
  payload       jsonb       not null,
  fetched_at    timestamptz not null,
  expires_at    timestamptz not null,
  primary key (connection_id, capability, args)
);

create table source_series (
  connection_id text        not null,
  capability    text        not null,
  environment   text        not null,
  entity        text        not null,  -- service, route, instance; '' for an aggregate
  metric        text        not null,  -- 'p95', 'error_rate', 'request_rate'
  bucket_at     timestamptz not null,
  value         double precision not null,
  settled       boolean     not null default false,
  primary key (connection_id, capability, environment, entity, metric, bucket_at)
);

create index on source_series (connection_id, capability, environment, bucket_at);

create table source_leases (
  key        text        primary key,
  holder     text        not null,
  expires_at timestamptz not null
);
```

`args` stays the string the cache already builds, so the document store keys exactly as the
memory tier does and the two cannot disagree about what a request was.

### One canonical resolution

Series are stored at **one bucket size per capability**, not at whatever step the current
query happened to ask for. Storing at the query's step is the trap: a 15-minute view writes
37-second buckets and a 7-day view writes 25,200-second ones, they share no rows, and the
whole point is lost.

Everything is fetched and stored at 60 seconds and **downsampled on read** for wider
windows. The consequence is a bound worth stating: **windows up to 24 hours are served from
the store** (1,440 rows per series), and anything longer goes straight to the provider and
is cached as a document. A rolled-up hourly table extends that, and is the next increment
rather than this one.

### The settling window

Metrics backends backfill. A bucket written the instant its window closes may be revised
seconds later by a late sample, and persisting it as final bakes a wrong number in
permanently — which is worse than not persisting it at all.

So a bucket is **provisional until it is older than the settling window** (five minutes by
default, per connection). Provisional buckets are re-fetched on every read; settled ones
never are. Only settled buckets are written with `settled = true`, and only settled buckets
are trusted on a later read.

### Fetching only the gap

For a window `[from, to]`:

1. Read stored samples in range.
2. Everything at or before `now − settling` that is present and settled is trusted.
3. The fetch window starts at the earliest missing or unsettled bucket, and ends at `now`.
4. Fetch that window, append, mark the newly settled buckets.
5. Merge and return.

A cold store fetches the whole window, exactly as today. A warm one fetches minutes.

**This needs one contract addition:** `SourceContext` gains an optional
`window: { from: Date; to: Date }`. A provider given one queries that exact range instead
of deriving it from `scope.timeRange`. Without it a provider cannot be asked for a gap, and
the whole mechanism collapses back to re-fetching the full window.

## Saying how old it is

`Panel<T>` already carries `stale`, and the routers currently drop it — a finding parked
during the framework work. A replica read makes that unacceptable: a reader looking at
four-minute-old inventory deserves to be told so.

The store returns `fetched_at` with every document, `fanOut` carries it, and the panel
prints "Azure, 4 minutes ago". Live data, served from memory, says nothing — because it is
current, and a timestamp on it would be noise.

## What is never persisted

- **Live capabilities**, listed above.
- **Anything user-scoped.** `WorkspaceSource` has no source behind it and no cache entry;
  a shared store must never hold one user's pins.
- **Connection settings.** They hold secrets. The store keys on a connection _id_, never on
  the credentials that reached it.
- **A failed response.** A 500 is not an answer worth keeping; the existing
  stale-on-failure path already serves the last good one.

## Out of scope

- **Background refresh.** The store is shaped for it — a refresher writing documents on a
  schedule needs no change above — but the trigger stays a read.
- **The hourly rollup**, and therefore windows beyond 24 hours from the store.
- **Cross-region or multi-tenant partitioning.** One deployment, one store.
- **Writing through to a source.** Everything here reads.
