# Domain detail: the Infrastructure tab

**Date:** 2026-09-16
**Status:** revised after review rounds 1 and 2 (round 2: 3 not-closed, 2 new Critical, 1 Minor — all addressed); round 3 before planning

## Goal

Replace the domain detail screen's Infrastructure placeholder with a page that answers, for
one domain: _what does it run on, and how is that doing?_ Six panels over the cloud
capabilities the estate screen already has, filtered to the resources the domain owns.

## The one new concept: ownership by tag

Nothing in the platform says which cloud resources belong to a domain. Every `cloud.*`
capability is estate-wide. This spec introduces exactly one concept and nothing else:

**A domain owns a cloud resource when the resource carries the tag
`<ownerTagKey>=<domain slug>`.**

- `ownerTagKey` is an Azure provider setting, default `domain`. Real estates already attribute
  ownership by tag across resource groups cut by region and environment; a resource-group-per-
  domain convention was rejected because the seed (and most real subscriptions) group by
  region, and an explicit resource list was rejected because it goes stale the moment anyone
  provisions a machine and does not fit `CatalogBinding.externalId`'s single string.
- The catalog records the claim: `CatalogDomain.bindings` gains
  `{ kind: 'cloud', connectionId: '', externalId: '<slug>' }` for every domain that owns
  infrastructure. `externalId` is the tag **value**. One binding per kind is already enforced.
- A domain with no `cloud` binding is **unbound**. That is a true statement about the domain,
  not an error, and the tab says so.
- One tag value, one owner. A resource tagged for two domains is out of scope and stated as
  such; the seed never produces one.

## Plumbing: one optional argument, the dispatcher that already exists

### Port

Every `InfrastructureSource` method gains an optional trailing `owner?: string` — the domain
slug, app vocabulary. The port never learns the word "tag".

```ts
listRegions(scope: PlatformScope, owner?: string): Promise<InfraRegion[]>;
readNodeCounts(scope: PlatformScope, owner?: string): Promise<NodeCounts>;
listClusters(scope: PlatformScope, limit: number, owner?: string): Promise<ClusterLoad[]>;
readUtilization(scope: PlatformScope, owner?: string): Promise<ResourceReading[]>;
readStorage(scope: PlatformScope, owner?: string): Promise<{ totalBytes: number; classes: StorageClass[] }>;
listDatabases(scope: PlatformScope, limit: number, owner?: string): Promise<DatabaseInstance[]>;
readCost(scope: PlatformScope, owner?: string): Promise<CostBreakdown>;
```

`listQueues` and `listAlerts` gain the argument for uniformity but no provider declares them;
they remain stated gaps on both screens.

### Router

- No `owner`: unchanged — `fanOut` / `fanOutSingle` as today.
- `owner` present: the router resolves the domain's **declared** `cloud` binding. This is new
  wiring: `createInfrastructureRouter(deps)` has no catalog today ("no catalog side" is its own
  docstring). It gains the **`CatalogSource`** — the `catalog.services` argument `createRouters()`
  already passes to the service router (the platform `Domain` type carries no `bindings`; only
  `CatalogDomain` does, via `CatalogSource.findDomain(slug)`). It reads
  `record.bindings.find(b => b.kind === 'cloud')` **directly — never through `bindingFor`**, whose
  fallback synthesises a slug-derived binding for APM identity and would make every one of the
  25 domains look bound. Unknown slug or no declared cloud binding → throw
  `CapabilityUnavailableError` with reason `'no-binding'` (already in `GapReason`).
- Binding found → dispatch through a **new, cached** helper `routeOne` in `routers/shared.ts`,
  beside `fanOut` / `fanOutSingle` / `fanOutSeries`:
  - **Connection resolution.** `dispatcher.one()` does `registry.connection(binding.connectionId)`,
    so the catalog's `connectionId: ''` ("whichever connection of this kind answers") would throw
    `'no-connection'` on every read — `one()` has never been exercised with an empty id.
    `routeOne` resolves `''` first via `registry.supporting(capability)`: exactly one connection →
    use it; zero → `'no-connection'`; more than one → `'no-connection'`, and the panel copy says a
    binding must name its connection when several clouds are connected. `one()` itself is
    unchanged.
  - **Cache.** `one()` bypasses the cache entirely; `routeOne` wraps it in `deps.cache.read` keyed
    `{ connectionId: <resolved id>, capability, args: scopedArgs(scope, 'owner=<slug>') }` — the
    same `scopedArgs` every fan-out uses, so environment and time range are in the key. Without
    the owner, a domain's answer would be served to the estate; without the scope, production's
    numbers would be served under staging's heading — `scopedArgs`'s own comment names that
    failure. Tier semantics as `fanOutSingle`.
  - Without `routeOne`, every tab view re-issues the full upstream chain on every refresh tick
    (utilisation alone is one Monitor call per machine) — the opposite of scalable.
  - `routeOne` is the first real caller of `dispatcher.one()`; the standing todo closes.
- `dispatch-tiers.test.ts` gains `routeOne` as a recognised dispatch helper.

### Providers honour `ctx.binding` inside their existing methods

No new capabilities. `cloud.regions` answers the estate question and the domain question.

**Azure.** Every cloud method reads `ctx.binding`. When present it keeps only resources whose
`tags[ownerTagKey] === binding.externalId`. **One code path, built to scale:**

- the ARM list request always carries `$filter=tagName eq '<key>' and tagValue eq '<value>'`.
  Real ARM applies it server-side, so a two-thousand-machine subscription returns only the
  domain's machines. floci-az stores tags but ignores `$filter` (verified: 49 VMs returned
  regardless), so
- the client-side check runs after every fetch too. On real ARM it is a no-op; on the emulator
  it is what makes the answer correct. There is no untestable branch. The comparison matches
  ARM's own rule — tag **key** case-insensitive, tag **value** case-sensitive — and says so in
  one helper `ownsResource(tags, key, value)` that both the filter and its test use.
- `loadMachines()`'s 30s memo becomes a small `Map` keyed by owner (`''` = estate). Decided
  here, not at planning: the tab's three machine-backed reads (regions, nodes, utilisation)
  share one owner window, so bypassing the memo would triple the fetch, while keying adds one
  entry per domain actually viewed inside 30s — bounded by readers, not by the estate. The
  estate entry is never filtered in place.
- **Spend:** the Cost Management query gains the real contract's tag filter
  `filter: { tags: { name: ownerTagKey, operator: 'In', values: [slug] } }`. **The cost mock
  needs real work, not a clause**: today `costMockHandler` never reads the request body and
  `buildEstate` has no domain axis. It gains a (domain, service) axis seeded from the same
  ownership table as everything else, parses `filter.tags` and `grouping` from the body, and
  answers the real contract. The estate total is the sum over domains plus an untagged
  remainder — one fixture derived from the other, per the fixture-coherence rule.
- `metricSampleSize` applies to the _domain's_ machines. A twelve-machine domain is measured
  whole; the estate is still sampled.

**Fixture cloud.** Gains an owner dimension: every fixture node, cluster, database and storage
class belongs to a domain, from the same table the seed uses (below). Filters identically, so
the fixture stack exercises the same path and the sweep can drop the binding.

### Seed and fixture coherence — one table

`scripts/seed-azure.ts` tags every resource by a deterministic table, exported from one module
and imported by the fixture catalog (for the bindings) and the fixture cloud (for the owner
dimension), so the three cannot disagree:

| Resource group / resource                                              | Owner                 |
| ---------------------------------------------------------------------- | --------------------- |
| `cc-westeurope` (11+1 VMs, AKS, storage)                               | `payment-domain`      |
| `cc-northeurope`                                                       | `order-domain`        |
| `cc-eastus`                                                            | `user-domain`         |
| `cc-westus2`                                                           | `inventory-domain`    |
| `cc-southeastasia`                                                     | `notification-domain` |
| `cc-payments` / `cc-orders` / `cc-users` / `cc-inventory` (PostgreSQL) | the matching domain   |

Every other fixture domain (20 of 25) is **unbound** — deliberately, so the unbound state is
the common one under fixtures and is exercised on every sweep.

## The tab

Route `domains/[slug]/infrastructure`; `_BUILT_TABS` gains `'infrastructure'`; header via
`getDomainHeader`; one remote query `getDomainInfrastructure` (`scopedServiceSchema`).

```
┌ nodes 12/12 · clusters 1 · databases 1 · storage 5.1 TB ──────────────┐
├─ Regions (this domain) ─────────────────┬─ Spend (this domain, MTD) ──┤
├─ Clusters ──────────────────────────────┼─ Databases ─────────────────┤
├─ Utilisation (this domain's machines) ─────────────────────────────────┤
└─ Queues · Alerts: not declared — stated gaps, as on /infrastructure ──┘
```

Six `panel()`-wrapped reads, each passing `owner = slug`: `cloud.nodes` (strip), `cloud.regions`,
`cloud.clusters`, `cloud.databases`, `cloud.utilization`, `cloud.cost`; `cloud.storage` feeds
the strip's fourth cell. **Strip counts are facts, rendered above the port:** `InfraSummary = { nodes: NodeCounts,
clusters: { count: number; atLimit: boolean }, databases: { count: number; atLimit: boolean },
storageBytes: number }`. `count` is the `length` of the same arrays the tables render (fetched
with `limit = 100`); `atLimit` is `length === limit`. The pure layer's `toInfraSummaryView` prints
`100+` when `atLimit` — the API publishes `count` and `atLimit`, never the string. No separate
`listGroups(owner)`; two reads for one number would be the two-renderings smell. `findDomain` is a catalog read and stays unwrapped; unknown slug → null.

**Unbound domain:** all six panels are `unavailable` / `'no-binding'`; the page renders one
sentence once ("Not bound to a cloud — no resources are tagged `domain=<slug>`") above the
strip rather than six identical gap cards. Never zeros.

`DomainInfrastructureSnapshot`: `{ generatedAt, domain, summary: Panel<InfraSummary>,
regions: Panel<InfraRegion[]>, clusters: Panel<ClusterLoad[]>, databases: Panel<DatabaseInstance[]>,
utilization: Panel<ResourceReading[]>, cost: Panel<CostBreakdown> }`.

## Public API

The composite `DomainInfrastructureSnapshot` stays **private** to the remote function — a
screen composite is never published. The resources it is composed from are, mirroring the
estate's own paths one for one:

```
GET /api/v1/domains/{slug}/infrastructure/regions
GET /api/v1/domains/{slug}/infrastructure/nodes
GET /api/v1/domains/{slug}/infrastructure/clusters
GET /api/v1/domains/{slug}/infrastructure/databases
GET /api/v1/domains/{slug}/infrastructure/utilization
GET /api/v1/domains/{slug}/infrastructure/storage
GET /api/v1/domains/{slug}/infrastructure/cost
```

Each reuses the estate endpoint's DTO mapper (same shape, scoped data — a caller who knows
`/infrastructure/regions` knows `/domains/{slug}/infrastructure/regions`); 404 unknown slug;
501 via `requirePanel` when the read is a gap, including the unbound case. `@swagger` blocks,
schemas already exist in `openApiComponents()`; `components.yaml` regenerated. Seven paths →
43 total.

## Testing

| Layer    | What                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit     | tag filter keeps exactly the tagged resources; `$filter` string is on the wire; owner reaches the cost query as the real filter shape                                           |
| Unit     | router: `owner` with no binding throws `'no-binding'`; with a binding dispatches via `one()` and the cache key differs from the estate's                                        |
| Sweep    | new `SCREENS` entry (`'payment-domain'`, bound) + a second, unbound case asserting six stated gaps and no throw                                                                 |
| Budget   | rows for the bound tab, cold and warm, measured                                                                                                                                 |
| e2e      | `/domains/payment-domain/infrastructure` in `ROUTES` — renders under fixtures, `sources.example.json`, AND `sources.local.json`, where floci-az's stored tags are read for real |
| Provider | Azure against floci-az: a tagged VM appears in the owner's regions and nowhere else                                                                                             |

## Risks

- **Uncached by accident.** `dispatcher.one()` has no cache; `routeOne` is the whole defence
  against a tab that re-fetches the world every tick. The router test asserts a second read
  within TTL issues no upstream call, and that two owners produce two keys.
- **Cost by tag lags reality.** Cost Management attributes tag-filtered spend with a delay and
  untagged spend is invisible to it; the panel says "tagged spend" not "spend".
- **floci-az does not filter.** Correctness under the emulator rests on the client-side check;
  the provider test is what proves it.
- **Tag drift.** A resource nobody tagged belongs to no domain and appears only on the estate
  screen. `(unattributed)` on the deployments side is the precedent; here it is simply absent
  from every domain, and the estate screen is where it shows.

## Not in scope

Queues and alerts (own specs); multi-owner or hierarchical ownership; per-domain infrastructure
history; editing tags from this UI.
