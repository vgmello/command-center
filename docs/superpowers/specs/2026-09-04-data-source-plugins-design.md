# Data sources as first-class plugins

**Status:** approved, not yet implemented
**Date:** 2026-09-04

## The problem

The app reads through five ports — `PlatformSource`, `ServiceSource`,
`DeploymentSource`, `InfrastructureSource`, `WorkspaceSource` — and each resolves to
exactly one implementation, chosen by an environment variable. Adding a backend means
writing a class and adding a registry entry.

That is enough to swap fixtures for something real. It is not enough for what this
platform needs, which is several integrations of different kinds running at once:

- a **cloud** source (Azure first) for infrastructure — regions, nodes, instance types,
  replicas, CPU and memory, database utilisation, storage, spend;
- an **APM** source (Coralogix first) for application health — live metrics, SLOs,
  latency, error rates;
- a **deployment** source (Octopus first) for releases.

A data source is also not only an internal detail. It is something a reader sees: a
panel fed by Azure offers a link into the Azure portal, and a panel nobody feeds must
say so rather than render zeros.

## Decisions

Seven decisions frame everything below. Each was chosen deliberately; the rejected
alternative is recorded because the reasoning matters more than the choice.

**1. Several sources per kind, each resource owned by exactly one.**
Two Azure subscriptions may both be connected. Every domain, service and resource is
bound to at most one source per kind, so a read either routes to an owner or fans out
and concatenates. Nothing merges two answers to the same question, which means there is
no reconciliation logic and no "which one is right".

**2. The catalog declares its bindings.**
A service record carries `{ kind, connectionId, externalId }`. Explicit and reviewable.
Rejected: rules on the source that claim resources by tag or naming convention — a
mis-scoped rule silently claims or drops resources, and the failure is invisible.

**3. Ports stay; sources sit beneath them.**
The five ports remain the app-facing contract. A routing layer implements each by
dispatching to connected sources. Every screen, remote function, assembler and API
endpoint keeps working. Rejected: replacing the ports with kind-shaped contracts — a
large migration with no user-visible gain.

**4. Providers live in this repo; connections are configuration.**
`azure`, `coralogix` and `octopus` are modules that register with a registry. A
_connection_ — tenant, credentials, label — comes from a config file. Adding a provider
is a pull request; adding a connection is configuration. No runtime loading, no
sandboxing problem, no published-contract obligation.

**5. Capabilities are first class, and a gap is stated.**
A provider declares what it can answer. A panel with no provider renders an explicit
empty state naming the missing capability; the API returns 501. Rejected: empty data
(reproduces the failure the codebase already guards against — a page showing zeros with
nothing admitting why) and falling back to fixtures (production serving invented
numbers, which is what the resolver's throw-on-unknown-name exists to prevent).

**6. Deep links are contextual to the panel.**
Infrastructure panels link to Azure, metrics panels to Coralogix, the deployment table
to Octopus. There is no single "open this service elsewhere" button. Consequence:
provenance travels with the data — a panel knows which connection fed it.

**7. First delivery is the framework plus a working Azure provider.**
Fixture providers stand in for APM and deployment so the framework is provable without
those tenants, and Azure proves the contract against a real API.

## Architecture

```
screens · remote functions · /api/v1
            │
        assemblers                      ← wrap source-backed reads in Panel<T>
            │
  PlatformSource · ServiceSource · DeploymentSource
  InfrastructureSource · WorkspaceSource        ← unchanged contracts
            │
      routing implementations           ← serve app-owned locally, dispatch the rest
            │
        source cache                    ← TTL + single-flight + deadline
            │
      connection registry               ← kind-indexed, many instances
            │
  AzureCloudProvider · fixture cloud/apm/deployment providers
```

New code lives in `src/lib/server/sources/`, a sibling of `platform/`. The split reads
as: `platform/` is what the app asks for, `sources/` is where it comes from.

## Contracts

### Kinds and capabilities

```ts
export type SourceKind = 'cloud' | 'apm' | 'deployment';

export type Capability =
	| 'cloud.regions'
	| 'cloud.nodes'
	| 'cloud.clusters'
	| 'cloud.utilization'
	| 'cloud.storage'
	| 'cloud.databases'
	| 'cloud.queues'
	| 'cloud.alerts'
	| 'cloud.cost'
	| 'apm.serviceStats'
	| 'apm.healthChecks'
	| 'apm.endpoints'
	| 'apm.metricSeries'
	| 'apm.requestRate'
	| 'apm.slo'
	| 'apm.latencyHeatmap'
	| 'apm.insights'
	| 'apm.domainVitals'
	| 'apm.rates'
	| 'apm.incidents'
	| 'apm.activity'
	| 'apm.dependencies'
	| 'deployment.log'
	| 'deployment.summary'
	| 'deployment.trends'
	| 'deployment.statusTrend'
	| 'deployment.breakdown'
	| 'deployment.insights'
	| 'deployment.domains';
```

One capability per dispatched read, with a single exception: `queryDeployments` and
`listDeployments` are two shapes of the same question and share `deployment.log`. The
agreement test enforces the rule and records the exception, so a provider cannot
implement half of a capability.

Capabilities are namespaced by kind so the string alone says which contract it belongs
to, and so a router can assert that every capability it dispatches belongs to the kind
it dispatches to.

### Provider definition

```ts
export interface ProviderDefinition<Client> {
	readonly id: string; // 'azure'
	readonly kind: SourceKind;
	readonly name: string; // 'Microsoft Azure'
	readonly icon: string; // an icon key, never a component
	readonly capabilities: ReadonlySet<Capability>;
	/** What a connection must supply. Validated at boot, not on first read. */
	readonly settings: v.GenericSchema;
	/** Per-capability TTL overrides, where the provider knows better than the default. */
	readonly ttl?: Partial<Record<Capability, number>>;
	connect(settings: unknown): Client;
}
```

### Kind contracts

Capability-backed methods are **optional**; `capabilities` is the declared truth. A test
asserts the two agree, so a provider that declares `cloud.cost` and forgets to implement
`readCost` is a red test rather than a runtime hole.

```ts
export interface CloudProvider {
	listRegions?(ctx: SourceContext): Promise<InfraRegion[]>;
	readNodeCounts?(ctx: SourceContext): Promise<NodeCounts>;
	listClusters?(ctx: SourceContext, limit: number): Promise<ClusterLoad[]>;
	readUtilization?(ctx: SourceContext): Promise<ResourceUsage[]>;
	readStorage?(ctx: SourceContext): Promise<{ totalBytes: number; classes: StorageClass[] }>;
	listDatabases?(ctx: SourceContext, limit: number): Promise<DatabaseInstance[]>;
	listQueues?(ctx: SourceContext, limit: number): Promise<MessageQueue[]>;
	listAlerts?(ctx: SourceContext, limit: number): Promise<InfraAlert[]>;
	readCost?(ctx: SourceContext): Promise<CostBreakdown>;
	/** The console URL for a bound resource in a given view, or null. */
	resourceLink(binding: SourceBinding, view: LinkView): ExternalLink | null;
}
```

`ApmProvider` and `DeploymentProvider` follow the same shape over their own capabilities.
`SourceContext` carries the scope, the connection and — for resource-scoped reads — the
binding whose `externalId` identifies the thing being asked about.

### Connections

```ts
export interface SourceConnection {
	id: string; // 'azure-prod'
	providerId: string; // 'azure'
	kind: SourceKind;
	label: string; // 'Azure — Production'
	settings: unknown; // validated against the provider's schema
}
```

### Bindings

```ts
export interface SourceBinding {
	kind: SourceKind;
	connectionId: string;
	externalId: string; // '/subscriptions/…/sites/payment-api'
}
```

`Domain` and `Service` each gain `bindings: SourceBinding[]`. At most one binding per
kind per resource, enforced by a Valibot refinement rather than by convention.

## Routing

Each port method is classified once, in a table beside its router.

| Port                   | App-owned (served locally)                                                                                          | Source-backed (dispatched)                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlatformSource`       | `queryDomains`, `findDomain`, `readDomainStatusCounts`, `listOwners`, `listRecentChanges`, `readDomainDependencies` | `readDomainVitals`, `readRates`, `listIncidents`, `readActivitySummary` → **apm**                                                                                                  |
| `ServiceSource`        | `listServices`, `findService`                                                                                       | `readStats`, `listHealthChecks`, `readDependencies`, `readRequestRate`, `listEndpoints`, `readMetricSeries`, `readSloBudget`, `readLatencyHeatmap`, `listMetricInsights` → **apm** |
| `DeploymentSource`     | —                                                                                                                   | all → **deployment**                                                                                                                                                               |
| `InfrastructureSource` | —                                                                                                                   | all → **cloud**                                                                                                                                                                    |
| `WorkspaceSource`      | all                                                                                                                 | —                                                                                                                                                                                  |

The three `all` rows cover nineteen methods between them; they are not enumerated
because the rule has no exceptions there. `InfrastructureSource.listGroups` is the one
that is neither app-owned nor a capability of its own: the four-count summary is composed
from `cloud.nodes`, `cloud.clusters`, `cloud.databases` and `cloud.queues`, so it is
available exactly when those are.

`ServiceSource.listServiceVitals` is the one method that joins both: identity from the
catalog, readings from APM. It is where the seam is most visible and deserves its own
test.

Two dispatch rules, and deliberately no third:

- **Resource-scoped.** Look up the resource's binding for the kind, resolve the
  connection, call the method with the binding. No binding, or a connection lacking the
  capability → unavailable.
- **Aggregate.** Fan out to every connection of that kind declaring the capability,
  concatenate, tag each row with the connection that produced it. No connections →
  unavailable.

The routing itself is one shared helper the routers call. What differs per router is
only the classification table.

## Panels: provenance, gaps and failure

Ports keep their exact signatures. When a read cannot be served the router throws
`CapabilityUnavailableError(capability, kind, reason)`.

Assemblers absorb it. There are six, and they already exist:

```ts
const cost = await panel('cloud.cost', () => estate.readCost(scope));
```

```ts
export type Panel<T> =
	| { status: 'ok'; data: T; source: SourceRef; stale?: true }
	| { status: 'unavailable'; capability: Capability; kind: SourceKind; reason: GapReason }
	| { status: 'failed'; capability: Capability; kind: SourceKind; source: SourceRef };

export interface SourceRef {
	connectionId: string;
	providerId: string;
	kind: SourceKind;
	name: string;
	icon: string;
	/** Where this panel's data lives in the provider's own console, if anywhere. */
	link: ExternalLink | null;
}
```

`unavailable` and `failed` are separate states because they are different sentences with
different user actions — connect something, versus check the connection. Collapsing them
would tell an on-call engineer to configure a source that is already configured.

Snapshot types change accordingly: `InfrastructureSnapshot.cost` becomes
`Panel<CostBreakdown>`, and each panel component gains an empty state. This is the one
place decision 3 bends, and it is bounded — assemblers and panel components, not remote
functions, not the API's plumbing.

The link is generated by the provider from the binding. The catalog stores a resource
id, never a URL, so a link is correct for anything the provider owns without anyone
maintaining it. The panel renders `source.link`; it does not know Azure exists.

**The API states gaps too.** A resource whose capability has no provider returns **501**
with `{ error: 'capability_unavailable', capability, kind }`. Not 503: this is a
configuration fact rather than a transient outage, and the same request keeps failing
until someone connects a source. `NotFoundError` already established the sentinel
pattern in `respond.ts`; this is a second one beside it.

## Caching, deadlines and rate limits

A cache sits between the routers and the providers, keyed by
`(connectionId, capability, argsHash)`.

- **Single-flight.** Concurrent identical calls share one in-flight promise. A page
  whose panels all need `cloud.nodes` issues one API call, not seven. This is the
  largest protection against rate limits and it costs about fifteen lines.
- **TTL per capability, overridable per provider.** `cloud.regions` changes monthly,
  `cloud.utilization` by the minute, `cloud.cost` daily whatever anyone does. One TTL for
  everything is either stale or wasteful. The capability declares a default; a provider
  overrides where it knows better.
- **A deadline on every provider call.** A hung call fails one panel rather than the
  page.
- **Stale on failure.** When a call fails and the cache holds a previous value, the panel
  serves it marked `stale` rather than pretending it is fresh.

Auto-refresh then costs nothing for slow-moving capabilities, which is the behaviour the
feature wants anyway.

## The Azure provider

**Authentication** uses `@azure/identity`. This is a tier-4 dependency and it is the
right call: CLAUDE.md says a dependency is usually right for anything security-sensitive
and not to hand-roll auth.

**Everything else is `fetch`** against the REST APIs, rather than four `@azure/arm-*`
SDK packages:

| Capability                                                                          | API                                                |
| ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `cloud.regions`, `cloud.nodes`, `cloud.clusters`, `cloud.databases`, `cloud.queues` | Resource Graph — one KQL query answers all of them |
| `cloud.utilization`, `cloud.alerts`                                                 | Azure Monitor                                      |
| `cloud.storage`                                                                     | Resource Graph plus Storage metrics                |
| `cloud.cost`                                                                        | Cost Management                                    |

One dependency and three endpoints, which is what the API selection order asks for.

**Deep links** are built from the binding:
`https://portal.azure.com/#@{tenantId}/resource{externalId}/{view}`, where the view
varies by panel — metrics panels link to `/metrics`, the rest to `/overview`.

## Configuration

Connections live in one JSON file whose path comes from `SOURCES_CONFIG`. Credentials
are referenced, never inlined:

```json
{
	"connections": [
		{
			"id": "azure-prod",
			"provider": "azure",
			"label": "Azure — Production",
			"settings": {
				"tenantId": "…",
				"subscriptionId": "…",
				"clientId": "…",
				"clientSecret": { "$env": "AZURE_PROD_CLIENT_SECRET" }
			}
		}
	]
}
```

The file is reviewable and committable; the secret stays in the environment. Each
connection is validated against its provider's schema at boot — a missing
`subscriptionId` fails at startup rather than on the first page load, which is the same
reasoning as the existing resolver throwing on an unknown source name.

With `SOURCES_CONFIG` unset the app runs on fixtures exactly as it does today.

## Testing

- **A shared contract suite per kind.** Every `CloudProvider` must pass it. Run against
  the fixture cloud provider in CI, and optionally against a live tenant behind a flag.
- **Capability agreement.** A test asserts each provider's declared capabilities match
  the methods it actually implements, in both directions.
- **Router tests.** Resource dispatch, aggregate fan-out, unavailable, failed, and the
  catalog/APM join in `listServiceVitals`.
- **Cache tests.** TTL expiry, single-flight collapsing concurrent calls, deadline
  firing, stale-on-failure.
- **Azure adapter.** KQL and URL construction, and response mapping, tested against
  recorded payloads. No live calls in CI.

## Increments

Each is shippable on its own.

1. **Contracts and registry.** Kinds, capabilities, provider definitions, connection
   config and validation, fixture providers for all three kinds. Ports still resolve as
   they do today; no behaviour change.
2. **Routers and panels.** The three routers, `Panel<T>`, assemblers updated, panel
   empty states. Panels can now say a capability has no source.
3. **Cache and resilience.** TTL, single-flight, deadlines, the `failed` state, stale
   serving.
4. **The Azure provider.** Identity, Resource Graph inventory, Monitor metrics, Cost
   Management, and the portal deep links.
5. **Bindings and exposure.** `bindings` on domain and service records, and
   `/api/v1/sources` listing connections with their kinds and capabilities.

## Out of scope

- A settings screen for creating and editing connections. Connections are configuration
  for now; a UI over them is a natural follow-on and is not needed to make Azure work.
- The Coralogix and Octopus providers. Their kind contracts and fixture providers land
  in increment 1; the real adapters are separate work against a contract that already
  runs.
- Merging two sources' answers to the same question. Decision 1 rules it out by design.
- Writing to a source. Every capability here is a read.
