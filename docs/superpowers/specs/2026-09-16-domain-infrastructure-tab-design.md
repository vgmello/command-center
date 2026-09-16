# Domain detail: the Infrastructure tab

**Date:** 2026-09-16
**Status:** revised after review rounds 1–6 (round 6: nothing architectural — 1 Important count fix, 2 Minor); round 7 scoped close before planning

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

`listQueues` and `listAlerts` gain the argument for uniformity only. **This tab does not draw
queue or alert panels** — the purpose-built subset omits them — so nothing here depends on
whether a provider declares them. (Under fixtures the fixture cloud DOES declare and implement
both; only the Azure/floci-az stack leaves them as gaps on the estate screen.)

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
    use it; zero → the same distinction `dispatcher.all()` already makes (`dispatch.ts:116-123`):
    `'no-capability'` when connections of the kind exist but none declares the capability,
    `'no-connection'` only when none of the kind exists — telling a reader whether to add a
    provider or a connection; more than one → a **new** `GapReason` `'ambiguous-connection'`, so the
    panel can say a binding must name its connection when several clouds are connected. `one()` itself is
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

### Gap presentation — the component AND the API must say the true sentence

`PanelGap.svelte` today branches on `status` only (`:34-40`) and prints "No connected <kind>
source provides <noun>" for every `unavailable` reason; `error-response.ts:43-57` hardcodes the
501 message the same way. Both are FALSE for an unbound domain — its cloud is connected and
answering; the domain simply owns nothing tagged — and false for an ambiguous binding. The
`GapReason` docstring (`platform/sources.ts:73-78`) exists precisely so those are different
sentences. This spec therefore changes three things, stated here because the tab depends on them:

1. `GapReason` gains `'ambiguous-connection'` (docstring "four distinct causes" → five). `reason`
   is already published in every 501 body (`error-response.ts:54`) and is undocumented today —
   **no 501 response schema exists in `openApiComponents()`** (`openapi.ts:263-273` defines only
   `BadRequest`/`Unauthorized`/`NotFound`) and `openapi.test.ts:204-206` asserts an exact response
   set that forbids adding one to a single route. That is the standing sitewide item
   `docs/todo/api-501-undocumented.md`. This spec does NOT document 501 — it behaves exactly like
   `activity`, `domains/{slug}/deployments` and `domains/{slug}/slo` — and it does not touch that
   test. Widening `GapReason` is safe precisely because the field is already public-and-
   undocumented; documenting the enum belongs to the todo that documents the status code.
2. One pure function `gapSentence(reason, kind, noun): string` in `src/lib/platform/gaps.ts`
   (three arguments — the existing sentence interpolates `noun`) is the single source of every
   gap sentence. `PanelGap.svelte` calls it with `panel.reason`; `error-response.ts` calls it for
   the 501 `message`. The page and the wire cannot disagree. New sentences: `'no-binding'` →
   "Not bound to a <kind> — no resources carry `domain=<slug>`"; `'ambiguous-connection'` →
   "Several <kind> connections are configured; this domain's binding must name one". The other
   three reasons keep today's wording.
3. One pure function `collapseUnbound(panels): boolean` beside it — true only when every panel is
   `unavailable` with reason `'no-binding'`. The assembler exposes the result on the snapshot as
   `unbound: boolean`; the page reads that flag. Both functions are tested by `bun test`, which
   cannot render `.svelte`.

### Providers honour `ctx.binding` inside their existing methods

No new capabilities. `cloud.regions` answers the estate question and the domain question.

**Azure.** Every cloud method reads `ctx.binding`. When present it keeps only resources whose
`tags[ownerTagKey] === binding.externalId`. **One code path, built to scale:**

- **the mechanism on every stack is the client-side check** `ownsResource(tags, key, value)`
  applied to the lists the provider already fetches (`loadMachines`, the cluster/storage/database
  collects). The comparison matches ARM's own rule — tag **key** case-insensitive, tag **value**
  case-sensitive — in one helper that both the filter and its test use. floci-az stores tags
  (verified on `PUT` and `PATCH`) and ignores `$filter` (verified: 49 VMs returned regardless).
- **Server-side narrowing is a stated ceiling, not a claim.** ARM documents
  `$filter=tagName eq '<key>' and tagValue eq '<value>'` on `/subscriptions/{id}/resources` and
  the resource-group-scoped `/resources` — **not** on type-specific lists such as
  `Microsoft.Compute/virtualMachines`. So a real two-thousand-machine subscription would still be
  listed whole and filtered here. The scalable path is a follow-up recorded in `docs/todo/`: pre-
  select the domain's resource ids via `/resources?$filter=tag…` (or Azure Resource Graph) and
  fetch details for those ids only. Same shape as the Monitor `metrics:getBatch` ceiling already
  on record — a different endpoint, not a parameter on this one. "Built to scale" here means the
  cache, the single dispatch, and the bounded sample; not a server-side filter this design does
  not have.
- `loadMachines()`'s 30s memo becomes a small `Map` keyed by owner (`''` = estate). Decided
  here, not at planning: the tab's three machine-backed reads (regions, nodes, utilisation)
  share one owner window, so bypassing the memo would triple the fetch, while keying adds one
  entry per domain actually viewed inside 30s — bounded by readers, not by the estate. The
  estate entry is never filtered in place.
- **Spend:** the Cost Management query gains the real contract's tag filter
  `filter: { tags: { name: ownerTagKey, operator: 'In', values: [slug] } }`. **The cost mock
  needs real work, not a clause**: today `costMockHandler` never reads the request body and
  `buildEstate` has no domain axis. It gains a (domain, service) axis seeded from the same
  ownership table as everything else, parses `filter.tags` and `grouping` from the body — which
  makes `costMockHandler` `async (request) => Promise<Response>` (it is synchronous today; it has no direct test callers yet — the new mock tests `await` it) — and answers the real contract. The estate total is the sum over domains plus an untagged
  remainder — one fixture derived from the other, per the fixture-coherence rule.
- `metricSampleSize` applies to the _domain's_ machines. A twelve-machine domain is measured
  whole; the estate is still sampled.

**Fixture cloud.** Gains an owner dimension **as a parallel table keyed by resource name** in the
shared ownership module — none of `InfraRegion`, `ClusterLoad`, `DatabaseInstance`, `StorageClass`
or `NodeCounts` carries an owner field, and adding one would leak the tag concept into the domain
model. The fixture cloud filters its rows through that table when `ctx.binding` is present, so the
fixture stack exercises the same path and the sweep can drop the binding.

### Seed and fixture coherence — one table

**Two worlds, one assignment.** The fixture estate and the floci-az seed name different things:
fixture regions are `eu-west-1`, `eu-central-1`, `us-east-1`, `us-west-2`, `ap-southeast-1`,
clusters `prod-eu-west-1-a`…, databases `payment-db`, `order-db`, `user-db`, `analytics-db`,
`inventory-db`, storage classes `block`/`object`/`file`; the seed's are `westeurope`…,
`cc-westeurope-aks`, `cc-payments`…. So the shared module `src/lib/platform/ownership.ts` holds
**one table of domain assignments keyed by role** (`region-1..5`, `db-payments`, `db-orders`,
`db-users`, `db-inventory`, `db-analytics`) and **two name maps** derived from it — fixture names
and seed names — so the domain each row belongs to is stated once and each world attaches its
names. **Clusters inherit their region's owner** in both worlds rather than having roles of their
own — a cluster lives in a region. The worlds therefore differ in count: fixtures hold two
clusters in `eu-west-1` (`prod-eu-west-1-a`, `-b`), so `payment-domain` owns two there, while the
seed provisions one AKS per group, so it owns one; the strip sketch above shows the seed world. The
strip's `count`/`atLimit` shape makes that difference a number, not a contradiction. Under fixtures **six** domains are bound (payment, order, user, inventory, notification,
analytics — `analytics-domain` exists in the 25-domain catalog and owns `analytics-db`); under the
seed **five** (no ClickHouse there). Fixture storage classes are _types_, not resources, so the
fixture holds a per-(domain, class) bytes table whose per-class sums equal the estate figures —
one fixture derived from the other. The sweep's unbound case uses a slug unbound in BOTH worlds
(`tax-domain`).

`scripts/seed-azure.ts` adds a `tags` object to every `PUT` body — **verified: floci-az persists
tags on `PUT`** (201, read back intact on a throwaway VM, then deleted), not only on `PATCH`. It
tags every resource by a deterministic table, exported from one module
and imported by the fixture catalog (for the bindings) and the fixture cloud (for the owner
dimension), so the three cannot disagree:

| What is tagged (every resource individually — tags live on resources, never on the group)                                                       | Owner                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| every resource in `cc-westeurope` (11 running + 1 degraded VM, the AKS cluster, the storage account) — except the four PostgreSQL servers below | `payment-domain`      |
| `cc-northeurope`                                                                                                                                | `order-domain`        |
| `cc-eastus`                                                                                                                                     | `user-domain`         |
| `cc-westus2`                                                                                                                                    | `inventory-domain`    |
| `cc-southeastasia`                                                                                                                              | `notification-domain` |
| `cc-payments` / `cc-orders` / `cc-users` / `cc-inventory` (PostgreSQL)                                                                          | the matching domain   |

Every other fixture domain (20 of 25) is **unbound** — deliberately, so the unbound state is
the common one under fixtures and is exercised on every sweep.

## The tab

Route `domains/[slug]/infrastructure`; `_BUILT_TABS` gains `'infrastructure'`; header via
`getDomainHeader`; one remote query `getDomainInfrastructure` validated with `scopedServiceSchema`.

**Plumbing end to end, so nothing is left to guess:** the existing `service.ts` functions
`readRegions(scope)`, `readNodeCounts(scope)`, `readClusters(scope, limit)`, `readUtilization(scope)`,
`readStorage(scope)`, `readDatabases(scope, limit)`, `readCost(scope)` each gain the optional
trailing `owner` and are **reused** by both the estate routes (unchanged calls) and the seven new
domain routes — one function per fact, no parallel `readDomain*` set. The screen composite is a
new assembler `src/lib/server/platform/domain-infrastructure-view.ts` exporting
`buildDomainInfrastructureSnapshot(platform, infrastructure, scope, slug, now)` (one file per
screen, as the other tabs; `domain-tabs-view.ts` is not extended further), exposed as
`readDomainInfrastructure(scope, slug)` in `service.ts` and called by the remote query.

```
┌ nodes 11/12 · clusters 1 · databases 1 · storage 5.1 TB ──────────────┐
├─ Regions (this domain) ─────────────────┬─ Spend (this domain, MTD) ──┤
├─ Clusters ──────────────────────────────┼─ Databases ─────────────────┤
├─ Utilisation (this domain's machines) ─────────────────────────────────┤
└─ (no queue or alert panels on this tab — by design, not as gaps) ──────┘
```

**Seven** `panel()`-wrapped reads, each passing `owner = slug`: `cloud.nodes`, `cloud.regions`,
`cloud.clusters`, `cloud.databases`, `cloud.utilization`, `cloud.cost`, and `cloud.storage`, which
feeds only the strip's fourth cell. **The strip is composed, not read:** `summary` is
`Panel<InfraSummary>` derived from the nodes / clusters / databases / storage panels — if the
`cloud.nodes` panel is a gap the whole strip is that gap (there is no strip without a node count);
if `cloud.storage` alone is a gap, `InfraSummary.storageBytes` is `null` and the cell prints a
dash, per the `CountTile.value`-nullable precedent. **Strip counts are facts, rendered above the
port:** `InfraSummary = { nodes: NodeCounts, clusters: { count: number; atLimit: boolean },
databases: { count: number; atLimit: boolean }, storageBytes: number | null }`. `count` is the
`length` of the same arrays the tables render (fetched with `limit = 100`); `atLimit` is
`length === limit`. The pure layer's `toInfraSummaryView` prints `100+` when `atLimit` — the API
publishes `count` and `atLimit`, never the string. No separate `listGroups(owner)`; two reads for
one number would be the two-renderings smell. the assembler's `findDomain` is **`PlatformSource.findDomain`** (catalog-backed and gap-tolerant —
`routers/platform.ts:26-38` swallows the APM gap), a catalog read that stays unwrapped; unknown
slug → null. The **binding** lookup is the router's, via `CatalogSource` — the assembler only
passes `owner = slug`.

**Gap rendering rule, stated for the planner:** binding is per domain, so `'no-binding'` is
all-or-nothing across all seven reads — but a capability gap is not (a provider may declare regions and
nodes yet lack `cloud.utilization`, as this codebase's own history records). Therefore: **if all seven reads are `unavailable` with reason `'no-binding'` (`collapseUnbound` checks all
seven), the page renders one sentence once**
above the strip instead of six identical cards; **any other combination falls through to ordinary
per-panel `PanelGap`** — a bound domain missing one capability shows five panels and one stated
gap, exactly like the estate screen. Never zeros.

`DomainInfrastructureSnapshot`: `{ generatedAt, domain, unbound: boolean, summary: Panel<InfraSummary>,
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

Each reuses the estate endpoint's existing DTO mapper — `toRegionDto`, `toNodeCountsDto`,
`toClusterDto`, `toDatabaseDto`, `toResourceUsageDto`, `toStorageDto`, `toCostDto` in
`src/lib/server/api/v1/dto.ts`, all present today — same shape, scoped data (a caller who knows
`/infrastructure/regions` knows `/domains/{slug}/infrastructure/regions`); 404 unknown slug;
501 via `requirePanel` when the read is a gap, including the unbound case. `@swagger` blocks,
schemas already exist in `openApiComponents()`; `components.yaml` regenerated. Seven paths →
43 total.

## Testing

| Layer    | What                                                                                                                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit     | `ownsResource` keeps exactly the tagged resources across all four Azure lists; NO tag `$filter` is sent on ARM list requests (the client-side check is the mechanism — a test asserting the wire carries one would assert behaviour the design does not have); the owner reaches the Cost Management body as `filter.tags` in the real shape |
| Unit     | router: `owner` with no DECLARED cloud binding throws `'no-binding'` (a domain with only the `bindingFor` fallback must NOT count as bound); with a binding dispatches via `routeOne`; a second read inside TTL hits no upstream; two owners → two keys; two environments → two keys                                                         |
| Unit     | `routeOne` connection resolution: `''` with one cloud connection resolves; none of the kind → `'no-connection'`; kind present but none declaring → `'no-capability'`; two → `'ambiguous-connection'`                                                                                                                                         |
| Unit     | `ownsResource`: key case-insensitive, value case-sensitive, missing tag → false                                                                                                                                                                                                                                                              |
| Unit     | `toInfraSummaryView`: `atLimit` → `100+`; the DTO carries `count` + `atLimit` and no string                                                                                                                                                                                                                                                  |
| Unit     | `gapSentence`: `'no-binding'` and `'ambiguous-connection'` have their own sentences, the other three unchanged; `error-response`'s 501 message equals `gapSentence(...)` for the same reason                                                                                                                                                 |
| Unit     | `collapseUnbound`: seven × `'no-binding'` → true; six ok + one `'no-capability'` → false; six `'no-binding'` + one `'no-capability'` → false (mixed reasons never collapse)                                                                                                                                                                  |
| Sweep    | new `SCREENS` entry (`'payment-domain'`, bound) + a second, unbound case asserting six stated gaps and no throw                                                                                                                                                                                                                              |
| Budget   | rows for the bound tab, cold and warm, measured                                                                                                                                                                                                                                                                                              |
| e2e      | `/domains/payment-domain/infrastructure` in `ROUTES` — renders under fixtures, `sources.example.json`, AND `sources.local.json`, where floci-az's stored tags are read for real                                                                                                                                                              |
| Provider | Azure against floci-az: a tagged VM appears in the owner's regions and nowhere else                                                                                                                                                                                                                                                          |

## Risks

- **Uncached by accident.** `dispatcher.one()` has no cache; `routeOne` is the whole defence
  against a tab that re-fetches the world every tick. The router test asserts a second read
  within TTL issues no upstream call, and that two owners produce two keys.
- **Cost semantics are unchanged by the filter.** `costFrom` is generic over whatever rows arrive:
  `changePct` stays `0` ("not derivable from month-to-date") and `forecast` stays a run-rate line,
  per domain exactly as per estate. The panel does not gain a movement figure nobody measured.
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
