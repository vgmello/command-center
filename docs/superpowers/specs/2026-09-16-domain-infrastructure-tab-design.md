# Domain detail: the Infrastructure tab

**Date:** 2026-09-16
**Status:** approved by standing rule (autonomous flow); fresh-agent review before planning

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
- `owner` present: look up the domain's `cloud` binding in the catalog.
  - **No binding:** throw `CapabilityUnavailableError` with reason `'no-binding'` (already in
    `GapReason`). `panel()` renders it; `PanelGap` gains the one sentence for it.
  - **Binding:** dispatch through `dispatcher.one()` with
    `binding = { kind: 'cloud', connectionId, externalId: slug }`. This is the first real
    caller of `one()`; the standing `adopt-dispatcher-one` todo closes with it.
- **The cache key carries the owner.** The existing `args` string becomes `owner=<slug>`, so a
  domain-scoped answer is never served to the estate screen or to another domain. The fan-out
  key fix (`fanOutKey`) exists because a literal key once served a departed source's numbers;
  this is the same rule applied to a new axis.

### Providers honour `ctx.binding` inside their existing methods

No new capabilities. `cloud.regions` answers the estate question and the domain question.

**Azure.** Every cloud method reads `ctx.binding`. When present it keeps only resources whose
`tags[ownerTagKey] === binding.externalId`. **One code path, built to scale:**

- the ARM list request always carries `$filter=tagName eq '<key>' and tagValue eq '<value>'`.
  Real ARM applies it server-side, so a two-thousand-machine subscription returns only the
  domain's machines. floci-az stores tags but ignores `$filter` (verified: 49 VMs returned
  regardless), so
- the client-side check runs after every fetch too. On real ARM it is a no-op; on the emulator
  it is what makes the answer correct. There is no untestable branch.
- `loadMachines()`'s memoised window is keyed by owner as well, or bypassed for owner reads —
  whichever the plan measures as cheaper; the estate window must not be filtered in place.
- **Spend:** the Cost Management query gains the real contract's tag filter
  `filter: { tags: { name: ownerTagKey, operator: 'In', values: [slug] } }`. The cost mock
  grows tag-aware filtering the way the Monitor mock was built: answer the real request shape,
  seeded per (domain, service), never a convenient invention.
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
the strip's fourth cell. `findDomain` is a catalog read and stays unwrapped; unknown slug → null.

**Unbound domain:** all six panels are `unavailable` / `'no-binding'`; the page renders one
sentence once ("Not bound to a cloud — no resources are tagged `domain=<slug>`") above the
strip rather than six identical gap cards. Never zeros.

`DomainInfrastructureSnapshot`: `{ generatedAt, domain, summary: Panel<InfraSummary>,
regions: Panel<InfraRegion[]>, clusters: Panel<ClusterLoad[]>, databases: Panel<DatabaseInstance[]>,
utilization: Panel<ResourceReading[]>, cost: Panel<CostBreakdown> }`.

## Public API

`GET /api/v1/domains/{slug}/infrastructure` → the summary and the six resources, measurements
only (bytes, counts, percentages, seconds); 404 unknown slug; 501 on a gap via `requirePanel`.
`@swagger` block, schemas via `openApiComponents()`, regenerated `components.yaml`.

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

- **Two axes on one cache.** Owner in the args string is the whole defence; a router that
  forgets it serves one domain's spend to another. The unit test above exists for that.
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
