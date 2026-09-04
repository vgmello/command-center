# Data Source Plugins — Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data-source framework — typed kinds, declared capabilities, configured connections, routing beneath the existing ports, `Panel<T>` gap reporting, and a cache — proven end to end with fixture providers.

**Architecture:** A new `src/lib/server/sources/` tree sits _beneath_ the five existing ports. Providers declare a kind (`cloud`, `apm`, `deployment`) and a capability set; connections are configured instances of them. Routers implement each existing port by serving app-owned methods locally and dispatching source-backed ones to whichever connection owns the resource. Unservable reads throw `CapabilityUnavailableError`, which assemblers convert into a `Panel<T>` the UI can render as "no source connected".

**Tech Stack:** TypeScript, Svelte 5 runes, SvelteKit 2 remote functions, Valibot, `bun test`. No new runtime dependencies in this plan.

**Spec:** `docs/superpowers/specs/2026-09-04-data-source-plugins-design.md`

## Global Constraints

- **Scope of this plan:** spec increments 1–3 only. Increments 4–6 (floci-az harness, Azure provider, catalog bindings, `/api/v1/sources`) are a separate plan.
- **Nothing above the ports changes** except assemblers, snapshot types and panel components. Remote functions, route files and API endpoint plumbing are untouched.
- **Browser-safe vs server-only:** `SourceKind`, `Capability`, `SourceRef`, `Panel<T>` and `GapReason` cross the wire inside snapshots, so they live in `src/lib/platform/` and must not import from `$lib/server`. Everything else lives in `src/lib/server/sources/`.
- **Valibot, not Zod.** Import namespaced: `import * as v from 'valibot'`.
- **`bun test`**, not Vitest. `import { describe, expect, test } from 'bun:test'`.
- **No new dependencies.** Cache, single-flight and deadlines are hand-written; the spec's only planned dependency (`@azure/identity`) belongs to the Azure increment, not this plan.
- **Icons are string keys.** No component ever reaches a server module.
- **Colour lives in `tone.ts`.** Nothing else maps a status to a class.
- **With `SOURCES_CONFIG` unset the app behaves exactly as it does today** — every existing test must keep passing at every commit.
- **Run before every commit:** `bun run check && bun run lint && bun test`.

## File Structure

| File                                                                             | Responsibility                                                                                        |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/lib/platform/sources.ts`                                                    | Browser-safe vocabulary: `SourceKind`, `Capability`, `kindOf()`, `SourceRef`, `GapReason`, `Panel<T>` |
| `src/lib/server/sources/errors.ts`                                               | `CapabilityUnavailableError`                                                                          |
| `src/lib/server/sources/panel.ts`                                                | The `panel()` helper assemblers wrap reads in                                                         |
| `src/lib/server/sources/provider.ts`                                             | `ProviderDefinition`, `SourceContext`, `LinkView`                                                     |
| `src/lib/server/sources/contracts.ts`                                            | `CloudProvider`, `ApmProvider`, `DeploymentProvider`                                                  |
| `src/lib/server/sources/connection.ts`                                           | Connection schema, `$env` resolution, config loading                                                  |
| `src/lib/server/sources/registry.ts`                                             | Provider registration; connection resolution; capability index                                        |
| `src/lib/server/sources/agreement.ts`                                            | Reusable assertion that declared capabilities match implemented methods                               |
| `src/lib/server/sources/dispatch.ts`                                             | The two dispatch rules: resource-scoped and aggregate                                                 |
| `src/lib/server/sources/cache.ts`                                                | TTL, single-flight, deadline, stale-on-failure                                                        |
| `src/lib/server/sources/fixtures/{cloud,apm,deployment}.ts`                      | Fixture providers wrapping today's fixture data                                                       |
| `src/lib/server/sources/routers/{infrastructure,platform,service,deployment}.ts` | One router per port                                                                                   |
| `src/lib/server/platform/index.ts`                                               | Resolver: routers when `SOURCES_CONFIG` is set, fixtures otherwise                                    |

---

### Task 1: Source vocabulary and the Panel type

**Files:**

- Create: `src/lib/platform/sources.ts`
- Test: `src/lib/platform/sources.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type SourceKind = 'cloud' | 'apm' | 'deployment'`; `type Capability` (27 members); `function kindOf(capability: Capability): SourceKind`; `const CAPABILITIES: readonly Capability[]`; `interface SourceRef`; `type GapReason = 'no-connection' | 'no-binding' | 'not-implemented' | 'no-capability'`; `type Panel<T>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/platform/sources.test.ts
import { describe, expect, test } from 'bun:test';
import { CAPABILITIES, SOURCE_KINDS, kindOf } from './sources';

describe('the capability vocabulary', () => {
	test('every capability is namespaced by the kind that answers it', () => {
		for (const capability of CAPABILITIES) {
			const [prefix] = capability.split('.');
			expect(SOURCE_KINDS, capability).toContain(prefix);
		}
	});

	test('kindOf reads the kind out of the name, so the two cannot disagree', () => {
		expect(kindOf('cloud.cost')).toBe('cloud');
		expect(kindOf('apm.slo')).toBe('apm');
		expect(kindOf('deployment.log')).toBe('deployment');
	});

	test('no capability is declared twice', () => {
		expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
	});

	test('every kind has at least one capability', () => {
		for (const kind of SOURCE_KINDS) {
			expect(
				CAPABILITIES.some((one) => kindOf(one) === kind),
				kind
			).toBe(true);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/platform/sources.test.ts`
Expected: FAIL — `Cannot find module './sources'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/platform/sources.ts

/**
 * The vocabulary of data sources, on the browser-safe side of the line.
 *
 * These names cross the wire inside snapshots — a panel says which connection fed it —
 * so they live beside the other platform types and import nothing from `$lib/server`.
 */

export const SOURCE_KINDS = ['cloud', 'apm', 'deployment'] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * What a provider can be asked for.
 *
 * Namespaced by kind so the string alone says which contract it belongs to, and so a
 * router can assert it only dispatches capabilities of the kind it routes.
 */
export const CAPABILITIES = [
	'cloud.regions',
	'cloud.nodes',
	'cloud.clusters',
	'cloud.utilization',
	'cloud.storage',
	'cloud.databases',
	'cloud.queues',
	'cloud.alerts',
	'cloud.cost',
	'apm.serviceStats',
	'apm.healthChecks',
	'apm.endpoints',
	'apm.metricSeries',
	'apm.requestRate',
	'apm.slo',
	'apm.latencyHeatmap',
	'apm.insights',
	'apm.domainVitals',
	'apm.rates',
	'apm.incidents',
	'apm.activity',
	'apm.dependencies',
	'deployment.log',
	'deployment.summary',
	'deployment.trends',
	'deployment.statusTrend',
	'deployment.breakdown',
	'deployment.insights',
	'deployment.domains'
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** The kind that answers a capability, read out of its own name. */
export function kindOf(capability: Capability): SourceKind {
	return capability.split('.')[0] as SourceKind;
}

/** Which connection produced a panel's data, and where it lives in that console. */
export interface SourceRef {
	connectionId: string;
	providerId: string;
	kind: SourceKind;
	/** Display name of the connection, e.g. "Azure — Production". */
	name: string;
	/** Icon key. Never a component: this crosses the wire. */
	icon: string;
	/** Deep link into the provider's own console for what this panel shows. */
	link: { label: string; href: string } | null;
}

/**
 * Why a panel has no data.
 *
 * Four distinct causes, because the remedies differ: connect a source, bind the
 * resource, pick a provider that implements it, or nothing — it is simply absent.
 */
export type GapReason = 'no-connection' | 'no-binding' | 'no-capability' | 'not-implemented';

/**
 * One panel's worth of data, or an account of why there is none.
 *
 * `unavailable` and `failed` are separate states on purpose. "Nothing is connected" and
 * "Azure did not answer" are different sentences with different actions, and collapsing
 * them would tell an on-call engineer to configure a source that is already configured.
 */
export type Panel<T> =
	| { status: 'ok'; data: T; source: SourceRef; stale?: true }
	| { status: 'unavailable'; capability: Capability; kind: SourceKind; reason: GapReason }
	| { status: 'failed'; capability: Capability; kind: SourceKind; source: SourceRef };
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/platform/sources.test.ts && bun run check`
Expected: 4 tests PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/lib/platform/sources.ts src/lib/platform/sources.test.ts
git commit -m "feat: add the browser-safe data source vocabulary

Kinds, capabilities and the Panel type live beside the other platform types
because they cross the wire inside snapshots — a panel states which connection
fed it. Capabilities are namespaced by kind so the string alone says which
contract answers it, and kindOf reads the kind out of the name rather than
carrying a second mapping that could disagree with it."
```

---

### Task 2: The unavailable error and the panel() helper

**Files:**

- Create: `src/lib/server/sources/errors.ts`, `src/lib/server/sources/panel.ts`
- Test: `src/lib/server/sources/panel.test.ts`

**Interfaces:**

- Consumes: `Capability`, `SourceKind`, `GapReason`, `Panel`, `SourceRef`, `kindOf` from Task 1.
- Produces: `class CapabilityUnavailableError extends Error` with readonly `capability`, `kind`, `reason`; `class SourceFailedError extends Error` with readonly `capability`, `kind`, `source`; `function panel<T>(capability: Capability, read: () => Promise<{ data: T; source: SourceRef; stale?: true }>): Promise<Panel<T>>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/panel.test.ts
import { describe, expect, test } from 'bun:test';
import { CapabilityUnavailableError, SourceFailedError } from './errors';
import { panel } from './panel';
import type { SourceRef } from '$lib/platform/sources';

const ref: SourceRef = {
	connectionId: 'azure-prod',
	providerId: 'azure',
	kind: 'cloud',
	name: 'Azure — Production',
	icon: 'cloud',
	link: null
};

describe('panel', () => {
	test('a successful read carries its data and its provenance', async () => {
		const result = await panel('cloud.cost', async () => ({ data: 42, source: ref }));

		expect(result.status).toBe('ok');
		if (result.status !== 'ok') throw new Error('unreachable');
		expect(result.data).toBe(42);
		expect(result.source.connectionId).toBe('azure-prod');
	});

	test('an unavailable capability becomes a stated gap, not an empty value', async () => {
		const result = await panel('cloud.cost', async () => {
			throw new CapabilityUnavailableError('cloud.cost', 'no-connection');
		});

		expect(result).toEqual({
			status: 'unavailable',
			capability: 'cloud.cost',
			kind: 'cloud',
			reason: 'no-connection'
		});
	});

	test('a failed read is distinct from an unavailable one', async () => {
		const result = await panel('cloud.cost', async () => {
			throw new SourceFailedError('cloud.cost', ref, new Error('timed out'));
		});

		expect(result.status).toBe('failed');
		if (result.status !== 'failed') throw new Error('unreachable');
		// The panel can still say who did not answer.
		expect(result.source.name).toBe('Azure — Production');
	});

	test('an unexpected error is not swallowed', async () => {
		const boom = new TypeError('bug in the mapper');

		expect(
			panel('cloud.cost', async () => {
				throw boom;
			})
		).rejects.toThrow('bug in the mapper');
	});

	test('a stale value is marked, not passed off as fresh', async () => {
		const result = await panel('cloud.cost', async () => ({
			data: 1,
			source: ref,
			stale: true as const
		}));

		expect(result.status === 'ok' && result.stale).toBe(true);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/panel.test.ts`
Expected: FAIL — `Cannot find module './errors'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/sources/errors.ts
import {
	kindOf,
	type Capability,
	type GapReason,
	type SourceKind,
	type SourceRef
} from '$lib/platform/sources';

/**
 * Thrown when a read cannot be served at all.
 *
 * A sentinel rather than an empty return, for the same reason `NotFoundError` is one in
 * `api/respond.ts`: "there is nothing here" and "here is nothing" are different answers,
 * and only a thrown one can be told apart from a legitimately empty list.
 */
export class CapabilityUnavailableError extends Error {
	readonly kind: SourceKind;

	constructor(
		readonly capability: Capability,
		readonly reason: GapReason
	) {
		super(`No source for ${capability} (${reason}).`);
		this.name = 'CapabilityUnavailableError';
		this.kind = kindOf(capability);
	}
}

/** Thrown when a connection exists and implements the capability, but the call failed. */
export class SourceFailedError extends Error {
	readonly kind: SourceKind;

	constructor(
		readonly capability: Capability,
		readonly source: SourceRef,
		readonly cause: unknown
	) {
		super(`${source.name} could not answer ${capability}.`);
		this.name = 'SourceFailedError';
		this.kind = kindOf(capability);
	}
}
```

```ts
// src/lib/server/sources/panel.ts
import { kindOf, type Capability, type Panel, type SourceRef } from '$lib/platform/sources';
import { CapabilityUnavailableError, SourceFailedError } from './errors';

/**
 * Turn one source-backed read into a panel.
 *
 * This is the only place a thrown gap becomes a rendered state. Assemblers wrap each
 * source-backed read in it, so one provider failing degrades one panel rather than the
 * page — every other panel on the same screen was wrapped separately.
 *
 * Anything that is not a gap or a source failure propagates: a mapper bug must not be
 * quietly rendered as "no data".
 */
export async function panel<T>(
	capability: Capability,
	read: () => Promise<{ data: T; source: SourceRef; stale?: true }>
): Promise<Panel<T>> {
	try {
		const { data, source, stale } = await read();
		return stale ? { status: 'ok', data, source, stale } : { status: 'ok', data, source };
	} catch (cause) {
		if (cause instanceof CapabilityUnavailableError) {
			return {
				status: 'unavailable',
				capability: cause.capability,
				kind: cause.kind,
				reason: cause.reason
			};
		}

		if (cause instanceof SourceFailedError) {
			return {
				status: 'failed',
				capability: cause.capability,
				kind: cause.kind,
				source: cause.source
			};
		}

		throw cause;
	}
}

/** Re-exported so an assembler needs one import to build a panel. */
export { kindOf };
export type { Panel, SourceRef, Capability };
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/server/sources/panel.test.ts && bun run check`
Expected: 5 tests PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/lib/server/sources/ && git commit -m "feat: add the capability gap sentinels and the panel helper

A gap is thrown rather than returned empty, for the same reason NotFoundError is
a sentinel in respond.ts: an empty list and 'there is no source' are different
answers and only one of them should reach a reader as data.

Unavailable and failed stay separate states because the remedies differ, and an
unexpected error still propagates — a mapper bug must not render as 'no data'."
```

---

### Task 3: Provider definitions and the three kind contracts

**Files:**

- Create: `src/lib/server/sources/provider.ts`, `src/lib/server/sources/contracts.ts`
- Test: `src/lib/server/sources/provider.test.ts`

**Interfaces:**

- Consumes: `Capability`, `SourceKind` from Task 1.
- Produces: `interface SourceContext { scope: PlatformScope; connection: SourceConnectionRef; binding?: SourceBinding }`; `interface SourceConnectionRef { id: string; providerId: string; kind: SourceKind; label: string; icon: string; settings: unknown }`; `interface SourceBinding { kind: SourceKind; connectionId: string; externalId: string }`; `type LinkView = 'overview' | 'metrics' | 'logs' | 'cost'`; `interface ProviderDefinition<Client>`; `interface CloudProvider`, `ApmProvider`, `DeploymentProvider`; `type AnyProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/provider.test.ts
import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { defineProvider } from './provider';
import type { CloudProvider } from './contracts';

describe('defineProvider', () => {
	test('freezes the capability set so a definition cannot be mutated after registration', () => {
		const definition = defineProvider<CloudProvider>({
			id: 'stub',
			kind: 'cloud',
			name: 'Stub Cloud',
			icon: 'cloud',
			capabilities: ['cloud.regions'],
			settings: v.object({}),
			connect: () => ({ resourceLink: () => null })
		});

		expect(definition.capabilities.has('cloud.regions')).toBe(true);
		expect(() => (definition.capabilities as Set<string>).add('cloud.cost')).toThrow();
	});

	test('rejects a capability that does not belong to the provider kind', () => {
		expect(() =>
			defineProvider<CloudProvider>({
				id: 'stub',
				kind: 'cloud',
				name: 'Stub Cloud',
				icon: 'cloud',
				// `apm.slo` is not a cloud capability; a router would never dispatch it here.
				capabilities: ['apm.slo'] as never,
				settings: v.object({}),
				connect: () => ({ resourceLink: () => null })
			})
		).toThrow(/cloud/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/provider.test.ts`
Expected: FAIL — `Cannot find module './provider'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/sources/provider.ts
import * as v from 'valibot';
import { kindOf, type Capability, type SourceKind } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';

/** A connection as a provider sees it: identity plus its own validated settings. */
export interface SourceConnectionRef {
	id: string;
	providerId: string;
	kind: SourceKind;
	label: string;
	icon: string;
	settings: unknown;
}

/** What ties a resource in this app to a resource in a provider. */
export interface SourceBinding {
	kind: SourceKind;
	connectionId: string;
	externalId: string;
}

/**
 * Everything a provider needs to answer one call.
 *
 * `binding` is present for resource-scoped reads and absent for aggregates, which is
 * the only difference between the two dispatch rules as a provider experiences them.
 */
export interface SourceContext {
	scope: PlatformScope;
	connection: SourceConnectionRef;
	binding?: SourceBinding;
}

/** Which view of a resource a deep link should open. */
export type LinkView = 'overview' | 'metrics' | 'logs' | 'cost';

export interface ProviderDefinition<Client> {
	readonly id: string;
	readonly kind: SourceKind;
	readonly name: string;
	/** Icon key. A provider never hands a component to anything. */
	readonly icon: string;
	readonly capabilities: ReadonlySet<Capability>;
	/** What a connection must supply. Validated at boot, not on first read. */
	readonly settings: v.GenericSchema;
	/** Per-capability TTL in seconds, where the provider knows better than the default. */
	readonly ttl?: Partial<Record<Capability, number>>;
	connect(settings: unknown): Client;
}

interface ProviderInput<Client> extends Omit<ProviderDefinition<Client>, 'capabilities'> {
	readonly capabilities: readonly Capability[];
}

/**
 * Build a provider definition, checking what a type cannot.
 *
 * The capability list is verified against the provider's own kind: a cloud provider
 * declaring `apm.slo` would sit in the cloud index answering a call no router will ever
 * send it, and nothing downstream would notice.
 */
export function defineProvider<Client>(input: ProviderInput<Client>): ProviderDefinition<Client> {
	for (const capability of input.capabilities) {
		if (kindOf(capability) !== input.kind) {
			throw new Error(
				`Provider "${input.id}" is of kind ${input.kind} but declares ${capability}.`
			);
		}
	}

	// Object.freeze does NOT make a Set immutable: its contents live in internal slots
	// rather than own properties, so `.add()` on a frozen Set succeeds silently. The
	// mutators have to be closed off explicitly, or the test below passes nothing.
	const capabilities = new Set(input.capabilities);
	const refuse = () => {
		throw new TypeError(`Provider "${input.id}" capabilities cannot be mutated.`);
	};
	Object.assign(capabilities, { add: refuse, delete: refuse, clear: refuse });

	return { ...input, capabilities: capabilities as ReadonlySet<Capability> };
}
```

```ts
// src/lib/server/sources/contracts.ts
import type {
	ClusterLoad,
	CostBreakdown,
	DatabaseInstance,
	Deployment,
	DeploymentInsight,
	DeploymentPage,
	DeploymentSummary,
	DomainBreakdown,
	DomainVitals,
	ExternalLink,
	FacetOption,
	HealthCheck,
	InfraAlert,
	InfraRegion,
	Incident,
	LatencyHeatmap,
	MessageQueue,
	MetricInsight,
	NodeCounts,
	RateObservation,
	ResourceUsage,
	ActivitySummary,
	ServiceDependencies,
	ServiceEndpoint,
	ServiceStat,
	SloBudget,
	StorageClass,
	TimeSeries,
	TrendGrain
} from '$lib/platform/types';
import type { DeploymentQuery } from '$lib/platform/deployments';
import type { LinkView, SourceBinding, SourceContext } from './provider';

/**
 * The three kind contracts.
 *
 * Capability-backed methods are optional: Azure implements nine cloud methods and none
 * of the APM ones, and a contract that required all of them would force every provider
 * to write stubs it can never answer. `capabilities` on the definition is the declared
 * truth, and `assertCapabilityAgreement` (Task 6) checks the two match — so a provider
 * that declares `cloud.cost` and forgets `readCost` is a red test, not a runtime hole.
 */
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
	/** Where this resource lives in the provider's own console. */
	resourceLink(binding: SourceBinding | undefined, view: LinkView): ExternalLink | null;
}

export interface ApmProvider {
	readServiceStats?(ctx: SourceContext): Promise<ServiceStat[]>;
	listHealthChecks?(ctx: SourceContext): Promise<HealthCheck[]>;
	readServiceDependencies?(ctx: SourceContext): Promise<ServiceDependencies>;
	readRequestRate?(ctx: SourceContext): Promise<TimeSeries>;
	listEndpoints?(ctx: SourceContext, limit: number): Promise<ServiceEndpoint[]>;
	readMetricSeries?(ctx: SourceContext): Promise<{
		requestRate: TimeSeries;
		p95Latency: TimeSeries;
		errorRate: TimeSeries;
		saturation: TimeSeries[];
		byEndpoint: TimeSeries[];
		byInstance: TimeSeries[];
	}>;
	readSloBudget?(ctx: SourceContext): Promise<SloBudget>;
	readLatencyHeatmap?(ctx: SourceContext): Promise<LatencyHeatmap>;
	listMetricInsights?(ctx: SourceContext): Promise<MetricInsight[]>;
	readDomainVitals?(ctx: SourceContext): Promise<DomainVitals | null>;
	readRates?(ctx: SourceContext): Promise<RateObservation[]>;
	listIncidents?(ctx: SourceContext, limit: number): Promise<Incident[]>;
	readActivitySummary?(ctx: SourceContext): Promise<ActivitySummary>;
	resourceLink(binding: SourceBinding | undefined, view: LinkView): ExternalLink | null;
}

export interface DeploymentProvider {
	queryDeployments?(ctx: SourceContext, query: DeploymentQuery): Promise<DeploymentPage>;
	listDeployments?(ctx: SourceContext, limit: number): Promise<Deployment[]>;
	readSummary?(ctx: SourceContext): Promise<DeploymentSummary>;
	readDomainBreakdown?(ctx: SourceContext): Promise<DomainBreakdown>;
	readStatusTrend?(ctx: SourceContext): Promise<TimeSeries[]>;
	readTrends?(
		ctx: SourceContext,
		grain: TrendGrain
	): Promise<{ frequency: TimeSeries; meanDuration: TimeSeries }>;
	listInsights?(ctx: SourceContext): Promise<DeploymentInsight[]>;
	listDeployingDomains?(ctx: SourceContext): Promise<FacetOption[]>;
	resourceLink(binding: SourceBinding | undefined, view: LinkView): ExternalLink | null;
}

export type AnyProvider = CloudProvider | ApmProvider | DeploymentProvider;
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/server/sources/provider.test.ts && bun run check`
Expected: 2 tests PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/lib/server/sources/ && git commit -m "feat: add provider definitions and the three kind contracts

Capability-backed methods are optional on the contracts, because a cloud provider
implements none of the APM ones and requiring all of them would force every
provider to write stubs it can never answer. The declared capability set is the
truth; Task 6 adds the test that the two agree.

defineProvider checks what a type cannot: a cloud provider declaring an apm
capability would sit in the cloud index answering a call no router ever sends it."
```

---

### Task 4: Connection configuration

**Files:**

- Create: `src/lib/server/sources/connection.ts`
- Test: `src/lib/server/sources/connection.test.ts`

**Interfaces:**

- Consumes: `SourceKind` (Task 1), `ProviderDefinition` (Task 3).
- Produces: `const connectionFileSchema`; `function resolveSecrets(settings: unknown, env: Record<string, string | undefined>): unknown`; `function loadConnections(raw: unknown, providers: Map<string, ProviderDefinition<unknown>>, env: Record<string, string | undefined>): SourceConnectionRef[]`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/connection.test.ts
import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { loadConnections, resolveSecrets } from './connection';
import { defineProvider } from './provider';
import type { CloudProvider } from './contracts';

const azure = defineProvider<CloudProvider>({
	id: 'azure',
	kind: 'cloud',
	name: 'Microsoft Azure',
	icon: 'cloud',
	capabilities: ['cloud.regions'],
	settings: v.object({ subscriptionId: v.string(), clientSecret: v.string() }),
	connect: () => ({ resourceLink: () => null })
});

const providers = new Map([['azure', azure as never]]);
const env = { AZURE_SECRET: 'shhh' };

const file = {
	connections: [
		{
			id: 'azure-prod',
			provider: 'azure',
			label: 'Azure — Production',
			settings: { subscriptionId: 'sub-1', clientSecret: { $env: 'AZURE_SECRET' } }
		}
	]
};

describe('resolveSecrets', () => {
	test('reads a referenced value out of the environment', () => {
		expect(resolveSecrets({ a: { $env: 'AZURE_SECRET' } }, env)).toEqual({ a: 'shhh' });
	});

	test('leaves plain values alone', () => {
		expect(resolveSecrets({ a: 'literal', b: 3 }, env)).toEqual({ a: 'literal', b: 3 });
	});

	test('a reference to a variable that is not set fails loudly', () => {
		expect(() => resolveSecrets({ a: { $env: 'MISSING' } }, env)).toThrow(/MISSING/);
	});
});

describe('loadConnections', () => {
	test('validates settings against the provider schema and resolves its secrets', () => {
		const [connection] = loadConnections(file, providers, env);

		expect(connection.id).toBe('azure-prod');
		expect(connection.kind).toBe('cloud');
		expect(connection.icon).toBe('cloud');
		expect(connection.settings).toEqual({ subscriptionId: 'sub-1', clientSecret: 'shhh' });
	});

	test('an unknown provider fails at boot rather than on first read', () => {
		const bad = { connections: [{ id: 'x', provider: 'gcp', label: 'X', settings: {} }] };

		expect(() => loadConnections(bad, providers, env)).toThrow(/gcp/);
	});

	test('a connection missing a required setting fails at boot', () => {
		const bad = {
			connections: [
				{ id: 'x', provider: 'azure', label: 'X', settings: { subscriptionId: 'sub-1' } }
			]
		};

		expect(() => loadConnections(bad, providers, env)).toThrow();
	});

	test('two connections may not share an id', () => {
		const bad = { connections: [file.connections[0], file.connections[0]] };

		expect(() => loadConnections(bad, providers, env)).toThrow(/azure-prod/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/connection.test.ts`
Expected: FAIL — `Cannot find module './connection'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/sources/connection.ts
import * as v from 'valibot';
import type { ProviderDefinition, SourceConnectionRef } from './provider';

/**
 * The shape of the connections file.
 *
 * Settings are `unknown` here and validated a second time against the provider's own
 * schema, because only the provider knows what it needs. Validating both at boot means a
 * missing subscription id stops startup rather than surfacing as an empty panel later.
 */
export const connectionFileSchema = v.object({
	connections: v.array(
		v.object({
			id: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
			provider: v.pipe(v.string(), v.minLength(1)),
			label: v.pipe(v.string(), v.minLength(1)),
			settings: v.record(v.string(), v.unknown())
		})
	)
});

const envReferenceSchema = v.object({ $env: v.pipe(v.string(), v.minLength(1)) });

/**
 * Replace `{ "$env": "NAME" }` with the environment's value.
 *
 * Credentials are referenced rather than inlined so the connections file stays
 * reviewable and committable while the secret lives in the environment. A reference to
 * a variable nobody set is an error, not an empty string — an empty credential fails
 * later, further from its cause.
 */
export function resolveSecrets(
	settings: unknown,
	env: Record<string, string | undefined>
): unknown {
	if (Array.isArray(settings)) return settings.map((one) => resolveSecrets(one, env));
	if (settings === null || typeof settings !== 'object') return settings;

	const reference = v.safeParse(envReferenceSchema, settings);
	if (reference.success) {
		const value = env[reference.output.$env];
		if (value === undefined || value === '') {
			throw new Error(`Connection setting references ${reference.output.$env}, which is not set.`);
		}
		return value;
	}

	return Object.fromEntries(
		Object.entries(settings as Record<string, unknown>).map(([key, value]) => [
			key,
			resolveSecrets(value, env)
		])
	);
}

/** Parse, resolve and validate every connection, or refuse to start. */
export function loadConnections(
	raw: unknown,
	providers: Map<string, ProviderDefinition<unknown>>,
	env: Record<string, string | undefined>
): SourceConnectionRef[] {
	const file = v.parse(connectionFileSchema, raw);
	const seen = new Set<string>();

	return file.connections.map((entry) => {
		if (seen.has(entry.id)) {
			throw new Error(`Two connections share the id "${entry.id}".`);
		}
		seen.add(entry.id);

		const definition = providers.get(entry.provider);
		if (!definition) {
			throw new Error(
				`Connection "${entry.id}" names provider "${entry.provider}", which is not registered. ` +
					`Available: ${[...providers.keys()].join(', ') || 'none'}`
			);
		}

		return {
			id: entry.id,
			providerId: definition.id,
			kind: definition.kind,
			label: entry.label,
			// The connection inherits the provider's icon: a connection is an instance of
			// a provider, and two Azure subscriptions should not be drawn differently.
			icon: definition.icon,
			settings: v.parse(definition.settings, resolveSecrets(entry.settings, env))
		};
	});
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/server/sources/connection.test.ts && bun run check`
Expected: 7 tests PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/lib/server/sources/ && git commit -m "feat: load and validate source connections

Settings are validated twice: once for the file's shape and once against the
provider's own schema, because only the provider knows what it needs. Both happen
at boot, so a missing subscription id stops startup rather than surfacing later as
an empty panel with no explanation.

Credentials are referenced with \$env rather than inlined, which keeps the file
reviewable and committable. A reference to a variable nobody set is an error and
not an empty string, because an empty credential fails further from its cause."
```

---

### Task 5: The provider registry

**Files:**

- Create: `src/lib/server/sources/registry.ts`
- Test: `src/lib/server/sources/registry.test.ts`

**Interfaces:**

- Consumes: `ProviderDefinition`, `SourceConnectionRef` (Task 3); `loadConnections` (Task 4).
- Produces: `class SourceRegistry` with `register(definition)`, `providers(): Map<string, ProviderDefinition<unknown>>`, `load(raw, env)`, `connections(kind?): ConnectedSource[]`, `connection(id): ConnectedSource | null`, `supporting(capability): ConnectedSource[]`; `interface ConnectedSource { ref: SourceConnectionRef; definition: ProviderDefinition<unknown>; client: unknown; capabilities: ReadonlySet<Capability>; sourceRef(link): SourceRef }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/registry.test.ts
import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { SourceRegistry } from './registry';
import { defineProvider } from './provider';
import type { ApmProvider, CloudProvider } from './contracts';

const cloud = defineProvider<CloudProvider>({
	id: 'stub-cloud',
	kind: 'cloud',
	name: 'Stub Cloud',
	icon: 'cloud',
	capabilities: ['cloud.regions', 'cloud.nodes'],
	settings: v.object({ region: v.string() }),
	connect: () => ({ resourceLink: () => null })
});

const apm = defineProvider<ApmProvider>({
	id: 'stub-apm',
	kind: 'apm',
	name: 'Stub APM',
	icon: 'chart-column',
	capabilities: ['apm.slo'],
	settings: v.object({}),
	connect: () => ({ resourceLink: () => null })
});

const file = {
	connections: [
		{ id: 'cloud-a', provider: 'stub-cloud', label: 'Cloud A', settings: { region: 'eu' } },
		{ id: 'cloud-b', provider: 'stub-cloud', label: 'Cloud B', settings: { region: 'us' } },
		{ id: 'apm-a', provider: 'stub-apm', label: 'APM A', settings: {} }
	]
};

function loaded() {
	const registry = new SourceRegistry();
	registry.register(cloud as never);
	registry.register(apm as never);
	registry.load(file, {});
	return registry;
}

describe('SourceRegistry', () => {
	test('indexes connections by kind', () => {
		expect(
			loaded()
				.connections('cloud')
				.map((one) => one.ref.id)
		).toEqual(['cloud-a', 'cloud-b']);
		expect(
			loaded()
				.connections('apm')
				.map((one) => one.ref.id)
		).toEqual(['apm-a']);
	});

	test('several connections of one kind coexist, which is the point', () => {
		expect(loaded().connections('cloud')).toHaveLength(2);
	});

	test('indexes by capability, so a router asks for who can answer rather than who exists', () => {
		expect(
			loaded()
				.supporting('cloud.regions')
				.map((one) => one.ref.id)
		).toEqual(['cloud-a', 'cloud-b']);
		expect(loaded().supporting('cloud.cost')).toEqual([]);
	});

	test('a client is built once per connection and reused', () => {
		const registry = loaded();

		expect(registry.connection('cloud-a')?.client).toBe(registry.connection('cloud-a')?.client);
	});

	test('two connections of one provider get their own clients', () => {
		const registry = loaded();

		expect(registry.connection('cloud-a')?.client).not.toBe(registry.connection('cloud-b')?.client);
	});

	test('registering the same provider id twice is a mistake, not a silent overwrite', () => {
		const registry = new SourceRegistry();
		registry.register(cloud as never);

		expect(() => registry.register(cloud as never)).toThrow(/stub-cloud/);
	});

	test('an unknown connection id is null, not a throw', () => {
		expect(loaded().connection('nope')).toBeNull();
	});

	test('a source ref carries the connection identity a panel prints', () => {
		const ref = loaded().connection('cloud-a')!.sourceRef(null);

		expect(ref).toEqual({
			connectionId: 'cloud-a',
			providerId: 'stub-cloud',
			kind: 'cloud',
			name: 'Cloud A',
			icon: 'cloud',
			link: null
		});
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/registry.test.ts`
Expected: FAIL — `Cannot find module './registry'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/sources/registry.ts
import type { Capability, SourceKind, SourceRef } from '$lib/platform/sources';
import type { ProviderDefinition, SourceConnectionRef } from './provider';
import { loadConnections } from './connection';

/** One configured, connected instance of a provider. */
export interface ConnectedSource {
	readonly ref: SourceConnectionRef;
	readonly definition: ProviderDefinition<unknown>;
	/** Built once per connection; a real client holds a pool or an HTTP agent. */
	readonly client: unknown;
	readonly capabilities: ReadonlySet<Capability>;
	/** The provenance a panel prints, with whatever link suits the panel. */
	sourceRef(link: SourceRef['link']): SourceRef;
}

/**
 * Which providers exist, which connections are configured, and who can answer what.
 *
 * One instance, built at boot. Clients are created once per connection and reused: a
 * real adapter holds a connection pool or an HTTP agent, and building one per request is
 * how you exhaust both — the same reasoning the existing source resolver already applies.
 */
export class SourceRegistry {
	readonly #providers = new Map<string, ProviderDefinition<unknown>>();
	readonly #connections = new Map<string, ConnectedSource>();

	register(definition: ProviderDefinition<unknown>): void {
		if (this.#providers.has(definition.id)) {
			throw new Error(`Provider "${definition.id}" is already registered.`);
		}
		this.#providers.set(definition.id, definition);
	}

	providers(): Map<string, ProviderDefinition<unknown>> {
		return this.#providers;
	}

	/** Validate the config and connect everything in it, or throw. */
	load(raw: unknown, env: Record<string, string | undefined>): void {
		this.#connections.clear();

		for (const ref of loadConnections(raw, this.#providers, env)) {
			const definition = this.#providers.get(ref.providerId)!;

			this.#connections.set(ref.id, {
				ref,
				definition,
				client: definition.connect(ref.settings),
				capabilities: definition.capabilities,
				sourceRef: (link) => ({
					connectionId: ref.id,
					providerId: ref.providerId,
					kind: ref.kind,
					name: ref.label,
					icon: ref.icon,
					link
				})
			});
		}
	}

	/** Every connection, or only those of one kind, in configuration order. */
	connections(kind?: SourceKind): ConnectedSource[] {
		const all = [...this.#connections.values()];
		return kind ? all.filter((one) => one.ref.kind === kind) : all;
	}

	connection(id: string): ConnectedSource | null {
		return this.#connections.get(id) ?? null;
	}

	/**
	 * Connections that declare a capability.
	 *
	 * The index a router actually wants: "who can answer this", not "who exists". A
	 * connection of the right kind that does not implement the capability is no use to
	 * the caller and would otherwise have to be filtered at every call site.
	 */
	supporting(capability: Capability): ConnectedSource[] {
		return this.connections().filter((one) => one.capabilities.has(capability));
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/server/sources/registry.test.ts && bun run check`
Expected: 8 tests PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/lib/server/sources/ && git commit -m "feat: add the source registry

Indexes connections by kind and by capability. The capability index is the one a
router wants — who can answer this, rather than who exists — because a connection
of the right kind that does not implement the capability would otherwise be
filtered at every call site.

Clients are built once per connection and reused, for the reason the existing
resolver already caches its sources: a real adapter holds a pool or an HTTP agent
and building one per request exhausts both. Registering a provider id twice throws
rather than silently replacing the first."
```

---

### Task 6: Capability agreement

**Files:**

- Create: `src/lib/server/sources/agreement.ts`
- Test: `src/lib/server/sources/agreement.test.ts`

**Interfaces:**

- Consumes: `ProviderDefinition` (Task 3), `Capability` (Task 1).
- Produces: `const CAPABILITY_METHODS: Record<Capability, string>`; `function capabilityDrift(definition, client): { declaredNotImplemented: Capability[]; implementedNotDeclared: Capability[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/agreement.test.ts
import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { CAPABILITY_METHODS, capabilityDrift } from './agreement';
import { CAPABILITIES } from '$lib/platform/sources';
import { defineProvider } from './provider';
import type { CloudProvider } from './contracts';

describe('CAPABILITY_METHODS', () => {
	test('every capability names the method that answers it', () => {
		for (const capability of CAPABILITIES) {
			expect(CAPABILITY_METHODS[capability], capability).toBeTruthy();
		}
	});
});

describe('capabilityDrift', () => {
	const build = (capabilities: readonly string[], client: Partial<CloudProvider>) =>
		capabilityDrift(
			defineProvider<CloudProvider>({
				id: 'stub',
				kind: 'cloud',
				name: 'Stub',
				icon: 'cloud',
				capabilities: capabilities as never,
				settings: v.object({}),
				connect: () => ({ resourceLink: () => null, ...client })
			}) as never,
			{ resourceLink: () => null, ...client }
		);

	test('an agreeing provider drifts in neither direction', () => {
		const drift = build(['cloud.regions'], { listRegions: async () => [] });

		expect(drift).toEqual({ declaredNotImplemented: [], implementedNotDeclared: [] });
	});

	test('declaring a capability without implementing it is caught', () => {
		expect(build(['cloud.cost'], {}).declaredNotImplemented).toEqual(['cloud.cost']);
	});

	test('implementing a capability without declaring it is caught too', () => {
		// Undeclared means unrouted: the method exists and nothing will ever call it.
		expect(build([], { listRegions: async () => [] }).implementedNotDeclared).toEqual([
			'cloud.regions'
		]);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/agreement.test.ts`
Expected: FAIL — `Cannot find module './agreement'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/sources/agreement.ts
import { CAPABILITIES, kindOf, type Capability } from '$lib/platform/sources';
import type { ProviderDefinition } from './provider';

/**
 * The method that answers each capability.
 *
 * One table rather than a naming convention, because two of them are irregular:
 * `deployment.log` is answered by two methods of different shapes, and the mapping has
 * to be readable by a person reviewing a new provider.
 */
export const CAPABILITY_METHODS: Record<Capability, string> = {
	'cloud.regions': 'listRegions',
	'cloud.nodes': 'readNodeCounts',
	'cloud.clusters': 'listClusters',
	'cloud.utilization': 'readUtilization',
	'cloud.storage': 'readStorage',
	'cloud.databases': 'listDatabases',
	'cloud.queues': 'listQueues',
	'cloud.alerts': 'listAlerts',
	'cloud.cost': 'readCost',
	'apm.serviceStats': 'readServiceStats',
	'apm.healthChecks': 'listHealthChecks',
	'apm.endpoints': 'listEndpoints',
	'apm.metricSeries': 'readMetricSeries',
	'apm.requestRate': 'readRequestRate',
	'apm.slo': 'readSloBudget',
	'apm.latencyHeatmap': 'readLatencyHeatmap',
	'apm.insights': 'listMetricInsights',
	'apm.domainVitals': 'readDomainVitals',
	'apm.rates': 'readRates',
	'apm.incidents': 'listIncidents',
	'apm.activity': 'readActivitySummary',
	'apm.dependencies': 'readServiceDependencies',
	'deployment.log': 'queryDeployments',
	'deployment.summary': 'readSummary',
	'deployment.trends': 'readTrends',
	'deployment.statusTrend': 'readStatusTrend',
	'deployment.breakdown': 'readDomainBreakdown',
	'deployment.insights': 'listInsights',
	'deployment.domains': 'listDeployingDomains'
};

/**
 * `deployment.log` answers two questions of different shapes — a page and a recent
 * list — so both methods belong to it. This is the only such case, and it is recorded
 * here rather than hidden in the check.
 */
const EXTRA_METHODS: Partial<Record<Capability, string[]>> = {
	'deployment.log': ['listDeployments']
};

/**
 * Where a provider's declared capabilities and its actual methods disagree.
 *
 * Both directions matter. Declaring without implementing is a runtime hole a router
 * would fall into; implementing without declaring is dead code, because the registry's
 * capability index is what decides who gets called.
 */
export function capabilityDrift(
	definition: ProviderDefinition<unknown>,
	client: object
): { declaredNotImplemented: Capability[]; implementedNotDeclared: Capability[] } {
	const implemented = (capability: Capability) => {
		const names = [CAPABILITY_METHODS[capability], ...(EXTRA_METHODS[capability] ?? [])];
		return names.some((name) => typeof (client as Record<string, unknown>)[name] === 'function');
	};

	const ofThisKind = CAPABILITIES.filter((one) => kindOf(one) === definition.kind);

	return {
		declaredNotImplemented: [...definition.capabilities].filter((one) => !implemented(one)),
		implementedNotDeclared: ofThisKind.filter(
			(one) => implemented(one) && !definition.capabilities.has(one)
		)
	};
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/server/sources/agreement.test.ts && bun run check`
Expected: 4 tests PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/lib/server/sources/ && git commit -m "feat: check that declared capabilities match implemented methods

Both directions are checked. Declaring without implementing is a runtime hole a
router falls into; implementing without declaring is dead code, because the
registry's capability index decides who gets called and an undeclared method is
never reached.

The capability-to-method mapping is a table rather than a naming convention,
because deployment.log is answered by two methods of different shapes and a
reviewer of a new provider has to be able to read the mapping."
```

---

### Task 7: Fixture providers for all three kinds

**Files:**

- Create: `src/lib/server/sources/fixtures/cloud.ts`, `fixtures/apm.ts`, `fixtures/deployment.ts`, `fixtures/index.ts`
- Test: `src/lib/server/sources/fixtures/fixtures.test.ts`

**Interfaces:**

- Consumes: `defineProvider` (Task 3), the kind contracts (Task 3), `capabilityDrift` (Task 6), and the existing fixture modules `infrastructure-fixtures.ts`, `service-fixtures.ts`, `fixtures.ts`.
- Produces: `const fixtureCloudProvider`, `fixtureApmProvider`, `fixtureDeploymentProvider`; `const FIXTURE_PROVIDERS: ProviderDefinition<unknown>[]`; `const FIXTURE_CONNECTIONS` — a ready-made config object naming one connection per kind.

**Note:** these wrap the _existing_ fixture functions. No fixture data is rewritten; the point is to prove the contracts against data that already exists and is already tested.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/fixtures/fixtures.test.ts
import { describe, expect, test } from 'bun:test';
import { FIXTURE_PROVIDERS } from './index';
import { capabilityDrift } from '../agreement';
import { kindOf } from '$lib/platform/sources';

describe('the fixture providers', () => {
	test('there is one per kind', () => {
		expect(FIXTURE_PROVIDERS.map((one) => one.kind).sort()).toEqual(['apm', 'cloud', 'deployment']);
	});

	test('each declares only capabilities of its own kind', () => {
		for (const definition of FIXTURE_PROVIDERS) {
			for (const capability of definition.capabilities) {
				expect(kindOf(capability), `${definition.id}/${capability}`).toBe(definition.kind);
			}
		}
	});

	test('each implements exactly what it declares', () => {
		for (const definition of FIXTURE_PROVIDERS) {
			const drift = capabilityDrift(definition, definition.connect({}) as object);

			expect(drift.declaredNotImplemented, definition.id).toEqual([]);
			expect(drift.implementedNotDeclared, definition.id).toEqual([]);
		}
	});

	test('the cloud fixture answers every cloud capability, so no panel is dark by default', () => {
		const cloud = FIXTURE_PROVIDERS.find((one) => one.kind === 'cloud')!;

		expect(cloud.capabilities.has('cloud.cost')).toBe(true);
		expect(cloud.capabilities.has('cloud.regions')).toBe(true);
	});

	test('a cloud read returns the same data the existing fixture serves', async () => {
		const cloud = FIXTURE_PROVIDERS.find((one) => one.kind === 'cloud')!;
		const client = cloud.connect({}) as { listRegions: (ctx: unknown) => Promise<unknown[]> };
		const regions = await client.listRegions({
			scope: { environment: 'production', timeRange: '15m' },
			connection: {
				id: 'x',
				providerId: 'fixture-cloud',
				kind: 'cloud',
				label: 'X',
				icon: 'box',
				settings: {}
			}
		});

		expect(regions.length).toBeGreaterThan(0);
	});

	test('a deep link is offered for a bound resource and withheld without a binding', () => {
		const cloud = FIXTURE_PROVIDERS.find((one) => one.kind === 'cloud')!;
		const client = cloud.connect({}) as {
			resourceLink: (b: unknown, v: string) => unknown;
		};

		expect(client.resourceLink(undefined, 'overview')).toBeNull();
		expect(
			client.resourceLink({ kind: 'cloud', connectionId: 'x', externalId: 'vm-1' }, 'overview')
		).not.toBeNull();
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/fixtures/fixtures.test.ts`
Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/sources/fixtures/cloud.ts
import * as v from 'valibot';
import * as estate from '../../platform/infrastructure-fixtures';
import { defineProvider } from '../provider';
import type { CloudProvider } from '../contracts';
import type { LinkView, SourceBinding } from '../provider';

/**
 * The seeded estate, behind the cloud contract.
 *
 * It wraps the existing fixture functions rather than restating them: those numbers are
 * already asserted by `infrastructure-view.test.ts`, and a second copy would be a second
 * thing to keep in step.
 */
export const fixtureCloudProvider = defineProvider<CloudProvider>({
	id: 'fixture-cloud',
	kind: 'cloud',
	name: 'Fixture Cloud',
	icon: 'cloud',
	capabilities: [
		'cloud.regions',
		'cloud.nodes',
		'cloud.clusters',
		'cloud.utilization',
		'cloud.storage',
		'cloud.databases',
		'cloud.queues',
		'cloud.alerts',
		'cloud.cost'
	],
	settings: v.object({}),
	connect: () => ({
		async listRegions() {
			return estate.listRegions();
		},
		async readNodeCounts() {
			return estate.readNodeCounts();
		},
		async listClusters(_ctx, limit) {
			return estate.listClusters(limit);
		},
		async readUtilization() {
			return estate.readUtilization(new Date());
		},
		async readStorage() {
			return estate.readStorage();
		},
		async listDatabases(_ctx, limit) {
			return estate.listDatabases(limit);
		},
		async listQueues(_ctx, limit) {
			return estate.listQueues(limit);
		},
		async listAlerts(_ctx, limit) {
			return estate.listAlerts(new Date(), limit);
		},
		async readCost() {
			return estate.readCost(new Date());
		},
		resourceLink(binding: SourceBinding | undefined, view: LinkView) {
			// A link needs a resource to point at. Without a binding there is nothing to
			// open, and offering a link to the console's front page would be a dead end.
			if (!binding) return null;
			return {
				label: 'Show in Fixture Cloud',
				href: `https://fixture.invalid/${binding.externalId}/${view}`
			};
		}
	})
});
```

```ts
// src/lib/server/sources/fixtures/apm.ts
import * as v from 'valibot';
import * as catalog from '../../platform/service-fixtures';
import * as platform from '../../platform/fixtures';
import { defineProvider } from '../provider';
import type { ApmProvider } from '../contracts';
import type { LinkView, SourceBinding, SourceContext } from '../provider';

/** The slug a resource-scoped APM read is about, from its binding. */
function subject(ctx: SourceContext): string {
	return ctx.binding?.externalId ?? '';
}

export const fixtureApmProvider = defineProvider<ApmProvider>({
	id: 'fixture-apm',
	kind: 'apm',
	name: 'Fixture APM',
	icon: 'chart-column',
	capabilities: [
		'apm.serviceStats',
		'apm.healthChecks',
		'apm.endpoints',
		'apm.metricSeries',
		'apm.requestRate',
		'apm.slo',
		'apm.latencyHeatmap',
		'apm.insights',
		'apm.domainVitals',
		'apm.rates',
		'apm.incidents',
		'apm.activity',
		'apm.dependencies'
	],
	settings: v.object({}),
	connect: () => ({
		async readServiceStats(ctx) {
			return catalog.readServiceStats(subject(ctx));
		},
		async listHealthChecks(ctx) {
			return catalog.listHealthChecks(subject(ctx));
		},
		async readServiceDependencies(ctx) {
			return catalog.readDependencies(subject(ctx));
		},
		async readRequestRate(ctx) {
			return catalog.readRequestRate(subject(ctx), new Date());
		},
		async listEndpoints(ctx, limit) {
			return catalog.listEndpoints(subject(ctx), limit);
		},
		async readMetricSeries(ctx) {
			return catalog.readMetricSeries(subject(ctx), new Date());
		},
		async readSloBudget(ctx) {
			return catalog.readSloBudget(subject(ctx), new Date());
		},
		async readLatencyHeatmap(ctx) {
			return catalog.readLatencyHeatmap(subject(ctx), new Date());
		},
		async listMetricInsights(ctx) {
			return catalog.listMetricInsights(subject(ctx), new Date());
		},
		async readDomainVitals(ctx) {
			return platform.readDomainVitals(subject(ctx), new Date());
		},
		async readRates(ctx) {
			// The existing fixture keys its rates off the time range, which the scope carries.
			return platform.readPlatformRates(ctx.scope.timeRange);
		},
		async listIncidents(_ctx, limit) {
			return platform.listIncidents(new Date()).slice(0, limit);
		},
		async readActivitySummary() {
			return platform.listActivitySummary(new Date());
		},
		resourceLink(binding: SourceBinding | undefined, view: LinkView) {
			if (!binding) return null;
			return {
				label: 'Show in Fixture APM',
				href: `https://fixture.invalid/apm/${binding.externalId}/${view}`
			};
		}
	})
});
```

**Before writing `apm.ts`, extract the rates fixture.** `readRates` currently lives inline in `FixturePlatformSource.readRates` in `fixture-source.ts`. Move that array into a new exported `readPlatformRates(timeRange: TimeRangeId): RateObservation[]` in `src/lib/server/platform/fixtures.ts`, and have `FixturePlatformSource.readRates` call it. Run `bun test` after the move: it is a pure relocation and every existing test must still pass.

```ts
// src/lib/server/sources/fixtures/deployment.ts
import * as v from 'valibot';
import * as log from '../../platform/fixtures';
import { queryDeploymentsInMemory } from '../../platform/in-memory-query';
import { defineProvider } from '../provider';
import type { DeploymentProvider } from '../contracts';
import type { LinkView, SourceBinding } from '../provider';

export const fixtureDeploymentProvider = defineProvider<DeploymentProvider>({
	id: 'fixture-deployment',
	kind: 'deployment',
	name: 'Fixture Deployments',
	icon: 'rocket',
	capabilities: [
		'deployment.log',
		'deployment.summary',
		'deployment.trends',
		'deployment.statusTrend',
		'deployment.breakdown',
		'deployment.insights',
		'deployment.domains'
	],
	settings: v.object({}),
	connect: () => ({
		async queryDeployments(_ctx, query) {
			return queryDeploymentsInMemory(log.listDeployments(new Date()), query, new Date());
		},
		async listDeployments(_ctx, limit) {
			return log.listDeployments(new Date()).slice(0, limit);
		},
		async readSummary() {
			return log.readDeploymentSummary(new Date());
		},
		async readDomainBreakdown() {
			return log.readDeploymentBreakdown(new Date());
		},
		async readStatusTrend() {
			return log.buildStatusTrend(new Date());
		},
		async readTrends(_ctx, grain) {
			return log.buildDeploymentTrends(new Date(), grain);
		},
		async listInsights() {
			return log.listDeploymentInsights(new Date());
		},
		async listDeployingDomains() {
			return log.listDeployingDomains(new Date());
		},
		resourceLink(binding: SourceBinding | undefined, view: LinkView) {
			if (!binding) return null;
			return {
				label: 'Show in Fixture Deployments',
				href: `https://fixture.invalid/deploy/${binding.externalId}/${view}`
			};
		}
	})
});
```

```ts
// src/lib/server/sources/fixtures/index.ts
import { fixtureApmProvider } from './apm';
import { fixtureCloudProvider } from './cloud';
import { fixtureDeploymentProvider } from './deployment';
import type { ProviderDefinition } from '../provider';

export { fixtureApmProvider, fixtureCloudProvider, fixtureDeploymentProvider };

export const FIXTURE_PROVIDERS: ProviderDefinition<unknown>[] = [
	fixtureCloudProvider as ProviderDefinition<unknown>,
	fixtureApmProvider as ProviderDefinition<unknown>,
	fixtureDeploymentProvider as ProviderDefinition<unknown>
];

/**
 * A ready-made configuration connecting one of each.
 *
 * Used by the router tests and by the resolver when `SOURCES_CONFIG` is unset, so the
 * routed path can be exercised without anyone writing a config file.
 */
export const FIXTURE_CONNECTIONS = {
	connections: [
		{ id: 'fixture-cloud', provider: 'fixture-cloud', label: 'Fixture Cloud', settings: {} },
		{ id: 'fixture-apm', provider: 'fixture-apm', label: 'Fixture APM', settings: {} },
		{
			id: 'fixture-deployment',
			provider: 'fixture-deployment',
			label: 'Fixture Deployments',
			settings: {}
		}
	]
};
```

- [ ] **Step 4: Run the tests**

Run: `bun test && bun run check`
Expected: the 6 new tests PASS and every pre-existing test still passes (the rates extraction is a pure move).

- [ ] **Step 5: Commit**

```bash
bun run format
git add -A && git commit -m "feat: expose the seeded data through the three kind contracts

The fixture providers wrap the existing fixture functions rather than restating
them: those numbers are already asserted by the view tests, and a second copy
would be a second thing to keep in step.

readRates moves out of FixturePlatformSource into fixtures.ts so both the class
and the APM provider read one definition. A pure relocation; every existing test
still passes.

Each provider is checked against capabilityDrift in both directions, so the set
they declare is the set they can answer."
```

---

### Task 8: Dispatch — the two routing rules

**Files:**

- Create: `src/lib/server/sources/dispatch.ts`
- Test: `src/lib/server/sources/dispatch.test.ts`

**Interfaces:**

- Consumes: `SourceRegistry`, `ConnectedSource` (Task 5); `CapabilityUnavailableError`, `SourceFailedError` (Task 2); `SourceBinding`, `SourceContext`, `LinkView` (Task 3).
- Produces: `interface Dispatcher` with `one<T>(opts): Promise<{ data: T; source: SourceRef }>` and `all<T>(opts): Promise<{ data: T[]; source: SourceRef }>`; `function createDispatcher(registry: SourceRegistry): Dispatcher`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/dispatch.test.ts
import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { createDispatcher } from './dispatch';
import { SourceRegistry } from './registry';
import { defineProvider } from './provider';
import { CapabilityUnavailableError, SourceFailedError } from './errors';
import type { CloudProvider } from './contracts';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

function registryWith(regions: (id: string) => Promise<unknown[]>, ids = ['a', 'b']) {
	const registry = new SourceRegistry();
	registry.register(
		defineProvider<CloudProvider>({
			id: 'p',
			kind: 'cloud',
			name: 'P',
			icon: 'cloud',
			capabilities: ['cloud.regions'],
			settings: v.object({ id: v.string() }),
			connect: (settings) => ({
				listRegions: async () => regions((settings as { id: string }).id) as never,
				resourceLink: () => ({
					label: 'open',
					href: `https://x.invalid/${(settings as { id: string }).id}`
				})
			})
		}) as never
	);
	registry.load(
		{ connections: ids.map((id) => ({ id, provider: 'p', label: id, settings: { id } })) },
		{}
	);
	return registry;
}

describe('dispatch.all — the aggregate rule', () => {
	test('fans out across every connection of the kind and concatenates', async () => {
		const dispatcher = createDispatcher(registryWith(async (id) => [`${id}-1`, `${id}-2`]));
		const { data } = await dispatcher.all<string>({
			capability: 'cloud.regions',
			scope,
			call: (client) => (client as CloudProvider).listRegions!({} as never) as never
		});

		expect(data).toEqual(['a-1', 'a-2', 'b-1', 'b-2']);
	});

	test('with no connection of that kind it is unavailable, not empty', async () => {
		const dispatcher = createDispatcher(new SourceRegistry());

		expect(
			dispatcher.all({ capability: 'cloud.regions', scope, call: async () => [] })
		).rejects.toThrow(CapabilityUnavailableError);
	});
});

describe('dispatch.one — the resource rule', () => {
	test('routes to the connection the binding names', async () => {
		const dispatcher = createDispatcher(registryWith(async (id) => [id]));
		const { data, source } = await dispatcher.one<string[]>({
			capability: 'cloud.regions',
			scope,
			binding: { kind: 'cloud', connectionId: 'b', externalId: 'r-9' },
			call: (client) => (client as CloudProvider).listRegions!({} as never) as never
		});

		expect(data).toEqual(['b']);
		expect(source.connectionId).toBe('b');
	});

	test('an unbound resource is unavailable with the reason that says so', async () => {
		const dispatcher = createDispatcher(registryWith(async () => []));

		expect(
			dispatcher.one({
				capability: 'cloud.regions',
				scope,
				binding: undefined,
				call: async () => []
			})
		).rejects.toMatchObject({ reason: 'no-binding' });
	});

	test('a binding naming a connection that is gone is unavailable, not a crash', async () => {
		const dispatcher = createDispatcher(registryWith(async () => []));

		expect(
			dispatcher.one({
				capability: 'cloud.regions',
				scope,
				binding: { kind: 'cloud', connectionId: 'removed', externalId: 'r-9' },
				call: async () => []
			})
		).rejects.toMatchObject({ reason: 'no-connection' });
	});

	test('a connection that does not implement the capability is unavailable', async () => {
		const registry = new SourceRegistry();
		registry.register(
			defineProvider<CloudProvider>({
				id: 'p',
				kind: 'cloud',
				name: 'P',
				icon: 'cloud',
				capabilities: [],
				settings: v.object({}),
				connect: () => ({ resourceLink: () => null })
			}) as never
		);
		registry.load({ connections: [{ id: 'a', provider: 'p', label: 'A', settings: {} }] }, {});

		expect(
			createDispatcher(registry).one({
				capability: 'cloud.regions',
				scope,
				binding: { kind: 'cloud', connectionId: 'a', externalId: 'r' },
				call: async () => []
			})
		).rejects.toMatchObject({ reason: 'no-capability' });
	});

	test('a provider that throws becomes a source failure carrying who failed', async () => {
		const dispatcher = createDispatcher(
			registryWith(async () => {
				throw new Error('upstream 503');
			})
		);

		const failure = dispatcher.one({
			capability: 'cloud.regions',
			scope,
			binding: { kind: 'cloud', connectionId: 'a', externalId: 'r' },
			call: (client) => (client as CloudProvider).listRegions!({} as never) as never
		});

		expect(failure).rejects.toThrow(SourceFailedError);
		expect(failure).rejects.toMatchObject({ source: { connectionId: 'a' } });
	});

	test('one failing connection does not lose the others in a fan-out', async () => {
		const dispatcher = createDispatcher(
			registryWith(async (id) => {
				if (id === 'a') throw new Error('down');
				return [id];
			})
		);
		const { data } = await dispatcher.all<string>({
			capability: 'cloud.regions',
			scope,
			call: (client) => (client as CloudProvider).listRegions!({} as never) as never
		});

		// A partial estate is more useful than none; the failure is not silent because the
		// panel's source ref names the connections that did answer.
		expect(data).toEqual(['b']);
	});

	test('a fan-out where every connection fails is a failure, not an empty list', async () => {
		const dispatcher = createDispatcher(
			registryWith(async () => {
				throw new Error('down');
			})
		);

		expect(
			dispatcher.all({
				capability: 'cloud.regions',
				scope,
				call: (client) => (client as CloudProvider).listRegions!({} as never) as never
			})
		).rejects.toThrow(SourceFailedError);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/dispatch.test.ts`
Expected: FAIL — `Cannot find module './dispatch'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/sources/dispatch.ts
import { kindOf, type Capability, type SourceRef } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';
import { CapabilityUnavailableError, SourceFailedError } from './errors';
import type { ConnectedSource, SourceRegistry } from './registry';
import type { LinkView, SourceBinding, SourceContext } from './provider';

interface Call<T> {
	capability: Capability;
	scope: PlatformScope;
	/** Which view a link from this panel should open. Defaults to the overview. */
	view?: LinkView;
	call: (client: unknown, ctx: SourceContext) => Promise<T>;
}

interface OneCall<T> extends Call<T> {
	binding: SourceBinding | undefined;
}

export interface Dispatcher {
	/**
	 * Resource-scoped: route to the connection the binding names.
	 *
	 * Implemented and tested here, and adopted when bindings land on the catalog
	 * records (spec increment 6). Until then the routers fan out, because dispatching
	 * on a placeholder binding would be routing on a guess.
	 */
	one<T>(options: OneCall<T>): Promise<{ data: T; source: SourceRef }>;
	/** Aggregate: fan out across every capable connection and concatenate. */
	all<T>(options: Call<T>): Promise<{ data: T[]; source: SourceRef }>;
}

/**
 * The two dispatch rules, and deliberately no third.
 *
 * Nothing merges two connections' answers to the same question. That is what "each
 * resource belongs to one source" bought: no reconciliation, and no arbitrating which
 * of two answers is right.
 */
export function createDispatcher(registry: SourceRegistry): Dispatcher {
	const refOf = (connection: ConnectedSource, binding: SourceBinding | undefined, view: LinkView) =>
		connection.sourceRef(
			(
				connection.client as {
					resourceLink?: (b: SourceBinding | undefined, v: LinkView) => SourceRef['link'];
				}
			).resourceLink?.(binding, view) ?? null
		);

	async function invoke<T>(
		connection: ConnectedSource,
		options: Call<T>,
		binding: SourceBinding | undefined
	): Promise<T> {
		const ctx: SourceContext = { scope: options.scope, connection: connection.ref, binding };

		try {
			return await options.call(connection.client, ctx);
		} catch (cause) {
			throw new SourceFailedError(
				options.capability,
				refOf(connection, binding, options.view ?? 'overview'),
				cause
			);
		}
	}

	return {
		async one<T>(options: OneCall<T>) {
			const { capability, binding } = options;

			if (!binding) {
				throw new CapabilityUnavailableError(capability, 'no-binding');
			}

			const connection = registry.connection(binding.connectionId);
			if (!connection || connection.ref.kind !== kindOf(capability)) {
				throw new CapabilityUnavailableError(capability, 'no-connection');
			}

			if (!connection.capabilities.has(capability)) {
				throw new CapabilityUnavailableError(capability, 'no-capability');
			}

			return {
				data: await invoke(connection, options, binding),
				source: refOf(connection, binding, options.view ?? 'overview')
			};
		},

		async all<T>(options: Call<T>) {
			const connections = registry.supporting(options.capability);

			if (connections.length === 0) {
				// Distinguishing "nobody is connected" from "nobody implements it" tells a
				// reader whether to add a connection or a different provider.
				const anyOfKind = registry.connections(kindOf(options.capability)).length > 0;
				throw new CapabilityUnavailableError(
					options.capability,
					anyOfKind ? 'no-capability' : 'no-connection'
				);
			}

			const settled = await Promise.allSettled(
				connections.map((connection) => invoke(connection, options, undefined))
			);

			const answered = settled.flatMap((result, index) =>
				result.status === 'fulfilled'
					? [{ value: result.value, connection: connections[index] }]
					: []
			);

			if (answered.length === 0) {
				// Everyone failed. Report the first failure rather than an empty estate,
				// which would read as "you have no regions".
				throw (settled[0] as PromiseRejectedResult).reason;
			}

			return {
				// flatMap, not map: a connection answers with its own list, and the caller
				// asked one question, so the lists concatenate. `map` would hand back one
				// array per connection and fail the aggregate test above.
				data: answered.flatMap((one) => one.value),
				// The first connection that answered stands for the panel. With several
				// sources a panel names one console to open; picking the first that
				// answered is arbitrary but stable, and never names one that failed.
				source: refOf(answered[0].connection, undefined, options.view ?? 'overview')
			};
		}
	};
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/server/sources/dispatch.test.ts && bun run check`
Expected: 9 tests PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/lib/server/sources/ && git commit -m "feat: add the two dispatch rules

Resource-scoped reads route to the connection their binding names; aggregates fan
out across every capable connection and concatenate. There is deliberately no
third rule — nothing merges two answers to one question, which is what 'each
resource belongs to one source' bought us.

A fan-out where some connections fail still returns what the rest answered,
because a partial estate is more useful than none. A fan-out where all of them
fail throws rather than returning an empty list, which would read as 'you have no
regions'."
```

---

### Task 9: The cache — TTL, single-flight, deadlines, stale

**Files:**

- Create: `src/lib/server/sources/cache.ts`
- Test: `src/lib/server/sources/cache.test.ts`

**Interfaces:**

- Consumes: `Capability` (Task 1).
- Produces: `const DEFAULT_TTL_SECONDS: Record<Capability, number>`; `class SourceCache` with `constructor(options?: { now?: () => number; deadlineMs?: number })`, `read<T>(key: CacheKey, load: () => Promise<T>): Promise<{ data: T; stale?: true }>`, `clear()`; `interface CacheKey { connectionId: string; capability: Capability; args: string; ttlSeconds: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/cache.test.ts
import { describe, expect, test } from 'bun:test';
import { DEFAULT_TTL_SECONDS, SourceCache } from './cache';
import { CAPABILITIES } from '$lib/platform/sources';

const key = (args = '', ttlSeconds = 60) => ({
	connectionId: 'a',
	capability: 'cloud.nodes' as const,
	args,
	ttlSeconds
});

describe('DEFAULT_TTL_SECONDS', () => {
	test('every capability has a TTL, so none inherits an accidental default', () => {
		for (const capability of CAPABILITIES) {
			expect(DEFAULT_TTL_SECONDS[capability], capability).toBeGreaterThan(0);
		}
	});

	test('slow-moving data is cached longer than fast-moving data', () => {
		expect(DEFAULT_TTL_SECONDS['cloud.regions']).toBeGreaterThan(
			DEFAULT_TTL_SECONDS['cloud.utilization']
		);
		expect(DEFAULT_TTL_SECONDS['cloud.cost']).toBeGreaterThan(
			DEFAULT_TTL_SECONDS['cloud.utilization']
		);
	});
});

describe('SourceCache', () => {
	test('serves a cached value within its TTL', async () => {
		let calls = 0;
		const cache = new SourceCache();
		const load = async () => ++calls;

		expect((await cache.read(key(), load)).data).toBe(1);
		expect((await cache.read(key(), load)).data).toBe(1);
		expect(calls).toBe(1);
	});

	test('reloads once the TTL has passed', async () => {
		let now = 0;
		let calls = 0;
		const cache = new SourceCache({ now: () => now });
		const load = async () => ++calls;

		await cache.read(key('', 60), load);
		now = 61_000;
		expect((await cache.read(key('', 60), load)).data).toBe(2);
	});

	test('different arguments are different entries', async () => {
		let calls = 0;
		const cache = new SourceCache();
		const load = async () => ++calls;

		await cache.read(key('limit=5'), load);
		await cache.read(key('limit=9'), load);
		expect(calls).toBe(2);
	});

	test('concurrent identical reads share one call', async () => {
		let calls = 0;
		const cache = new SourceCache();
		const load = async () => {
			calls++;
			await new Promise((resolve) => setTimeout(resolve, 10));
			return calls;
		};

		// Seven panels needing one capability must issue one API call, not seven.
		const results = await Promise.all(Array.from({ length: 7 }, () => cache.read(key(), load)));

		expect(calls).toBe(1);
		expect(results.every((one) => one.data === 1)).toBe(true);
	});

	test('a failed load does not poison the key for later callers', async () => {
		let attempt = 0;
		const cache = new SourceCache();
		const load = async () => {
			if (++attempt === 1) throw new Error('flaky');
			return attempt;
		};

		await expect(cache.read(key(), load)).rejects.toThrow('flaky');
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect((await cache.read(key(), load)).data).toBe(2);
	});

	test('a load that overruns its deadline fails rather than hanging the page', async () => {
		const cache = new SourceCache({ deadlineMs: 20 });

		await expect(
			cache.read(key(), () => new Promise((resolve) => setTimeout(() => resolve(1), 200)))
		).rejects.toThrow(/deadline/i);
	});

	test('a failure after a success serves the stale value, marked stale', async () => {
		let now = 0;
		let attempt = 0;
		const cache = new SourceCache({ now: () => now });
		const load = async () => {
			if (++attempt === 1) return 'fresh';
			throw new Error('down');
		};

		await cache.read(key('', 60), load);
		now = 61_000;

		expect(await cache.read(key('', 60), load)).toEqual({
			data: 'fresh',
			stale: true
		});
	});

	test('a failure with nothing cached still throws', async () => {
		const cache = new SourceCache();

		await expect(
			cache.read(key(), async () => {
				throw new Error('down');
			})
		).rejects.toThrow('down');
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/cache.test.ts`
Expected: FAIL — `Cannot find module './cache'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/server/sources/cache.ts
import type { Capability } from '$lib/platform/sources';

/**
 * How long each capability's answer stays good.
 *
 * One TTL for everything is either stale or wasteful: regions change monthly,
 * utilisation by the minute, and spend once a day whatever anyone does. Every capability
 * is listed rather than defaulted, so adding one is a compile error instead of a silent
 * inheritance of a number that suits it badly.
 */
export const DEFAULT_TTL_SECONDS: Record<Capability, number> = {
	'cloud.regions': 86_400,
	'cloud.nodes': 60,
	'cloud.clusters': 60,
	'cloud.utilization': 30,
	'cloud.storage': 3_600,
	'cloud.databases': 300,
	'cloud.queues': 60,
	'cloud.alerts': 30,
	'cloud.cost': 3_600,
	'apm.serviceStats': 30,
	'apm.healthChecks': 30,
	'apm.endpoints': 60,
	'apm.metricSeries': 30,
	'apm.requestRate': 30,
	'apm.slo': 300,
	'apm.latencyHeatmap': 60,
	'apm.insights': 120,
	'apm.domainVitals': 30,
	'apm.rates': 30,
	'apm.incidents': 30,
	'apm.activity': 60,
	'apm.dependencies': 600,
	'deployment.log': 30,
	'deployment.summary': 60,
	'deployment.trends': 300,
	'deployment.statusTrend': 60,
	'deployment.breakdown': 60,
	'deployment.insights': 300,
	'deployment.domains': 600
};

export interface CacheKey {
	connectionId: string;
	capability: Capability;
	/** A stable string for the call's arguments. Different args, different entry. */
	args: string;
	ttlSeconds: number;
}

interface Entry {
	value: unknown;
	at: number;
}

/**
 * TTL, single-flight, a deadline, and stale-on-failure.
 *
 * Single-flight matters more than the storage does: a page whose seven panels all want
 * `cloud.nodes` must issue one API call rather than seven. That is the largest
 * protection a rate limit will get, and it is most of what this class is.
 */
export class SourceCache {
	readonly entries = new Map<string, Entry>();
	readonly inFlight = new Map<string, Promise<unknown>>();
	readonly now: () => number;
	readonly deadlineMs: number;

	constructor(options: { now?: () => number; deadlineMs?: number } = {}) {
		this.now = options.now ?? Date.now;
		this.deadlineMs = options.deadlineMs ?? 10_000;
	}

	async read<T>(key: CacheKey, load: () => Promise<T>): Promise<{ data: T; stale?: true }> {
		const id = `${key.connectionId} ${key.capability} ${key.args}`;
		const cached = this.entries.get(id);

		if (cached && this.now() - cached.at < key.ttlSeconds * 1000) {
			return { data: cached.value as T };
		}

		const existing = this.inFlight.get(id);
		if (existing) return { data: (await existing) as T };

		const attempt = this.withDeadline(load())
			.then((value) => {
				this.entries.set(id, { value, at: this.now() });
				return value;
			})
			.finally(() => {
				// Cleared whether it resolved or threw, so one failure does not poison the
				// key for every later caller.
				this.inFlight.delete(id);
			});

		this.inFlight.set(id, attempt);

		try {
			return { data: (await attempt) as T };
		} catch (cause) {
			// A stale answer beats no answer, but it is never passed off as fresh.
			if (cached) return { data: cached.value as T, stale: true };
			throw cause;
		}
	}

	clear(): void {
		this.entries.clear();
		this.inFlight.clear();
	}

	/** A hung upstream must fail one panel rather than hold the page open. */
	private withDeadline<T>(work: Promise<T>): Promise<T> {
		let timer: ReturnType<typeof setTimeout>;

		return Promise.race([
			work,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Source call exceeded its ${this.deadlineMs}ms deadline.`)),
					this.deadlineMs
				);
			})
		]).finally(() => clearTimeout(timer)) as Promise<T>;
	}
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/server/sources/cache.test.ts && bun run check`
Expected: 10 tests PASS, 0 type errors.

- [ ] **Step 5: Commit**

```bash
bun run format
git add src/lib/server/sources/
git commit -m "feat: add the source cache with single-flight and deadlines"
```

---

### Task 10: The InfrastructureSource router

**Files:**

- Create: `src/lib/server/sources/routers/shared.ts`, `src/lib/server/sources/routers/infrastructure.ts`
- Test: `src/lib/server/sources/routers/infrastructure.test.ts`

**Interfaces:**

- Consumes: `Dispatcher`, `createDispatcher` (Task 8); `SourceCache`, `DEFAULT_TTL_SECONDS` (Task 9); `SourceRegistry` (Task 5); `InfrastructureSource` from `../../platform/source`.
- Produces: `interface RouterDeps { registry: SourceRegistry; dispatcher: Dispatcher; cache: SourceCache }`; `function fanOut<T>(deps, capability, scope, args, call): Promise<T[]>`; `function fanOutSingle<T>(deps, capability, scope, args, call): Promise<T>`; `function createInfrastructureRouter(deps: RouterDeps): InfrastructureSource`.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/routers/infrastructure.test.ts
import { describe, expect, test } from 'bun:test';
import { createInfrastructureRouter } from './infrastructure';
import { createDispatcher } from '../dispatch';
import { SourceCache } from '../cache';
import { SourceRegistry } from '../registry';
import { CapabilityUnavailableError } from '../errors';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../fixtures';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

function build(connections: unknown = FIXTURE_CONNECTIONS) {
	const registry = new SourceRegistry();
	for (const provider of FIXTURE_PROVIDERS) registry.register(provider);
	registry.load(connections, {});

	return {
		registry,
		source: createInfrastructureRouter({
			registry,
			dispatcher: createDispatcher(registry),
			cache: new SourceCache()
		})
	};
}

describe('the infrastructure router', () => {
	test('serves every source-backed method from the connected cloud source', async () => {
		const { source } = build();

		expect((await source.listRegions(scope)).length).toBeGreaterThan(0);
		expect((await source.readNodeCounts(scope)).healthy).toBeGreaterThan(0);
		expect(await source.listClusters(scope, 3)).toHaveLength(3);
		expect(await source.readUtilization(scope)).toHaveLength(4);
		expect((await source.readStorage(scope)).totalBytes).toBeGreaterThan(0);
		expect(await source.listDatabases(scope, 2)).toHaveLength(2);
		expect(await source.listQueues(scope, 2)).toHaveLength(2);
		expect(await source.listAlerts(scope, 2)).toHaveLength(2);
		expect((await source.readCost(scope)).categories.length).toBeGreaterThan(0);
	});

	test('listGroups is composed from other capabilities rather than dispatched', async () => {
		const groups = await build().source.listGroups(scope);

		expect(groups.map((one) => one.id).sort()).toEqual([
			'clusters',
			'databases',
			'nodes',
			'queues'
		]);
	});

	test('the node group counts exactly what readNodeCounts counts', async () => {
		const { source } = build();
		const counts = await source.readNodeCounts(scope);
		const groups = await source.listGroups(scope);

		expect(groups.find((one) => one.id === 'nodes')?.count).toBe(
			counts.healthy + counts.warning + counts.down
		);
	});

	test('with no cloud connection every method is unavailable rather than empty', async () => {
		const { source } = build({ connections: [] });

		expect(source.listRegions(scope)).rejects.toThrow(CapabilityUnavailableError);
		expect(source.readCost(scope)).rejects.toThrow(CapabilityUnavailableError);
	});

	test('repeated reads inside the TTL reach the provider once', async () => {
		const { registry, source } = build();
		const client = registry.connection('fixture-cloud')!.client as {
			listRegions: () => Promise<unknown[]>;
		};
		let calls = 0;
		const original = client.listRegions.bind(client);
		client.listRegions = async () => {
			calls++;
			return original();
		};

		await source.listRegions(scope);
		await source.listRegions(scope);
		expect(calls).toBe(1);
	});

	test('different limits are cached separately', async () => {
		const { source } = build();

		expect(await source.listClusters(scope, 2)).toHaveLength(2);
		expect(await source.listClusters(scope, 4)).toHaveLength(4);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/routers/infrastructure.test.ts`
Expected: FAIL — `Cannot find module './infrastructure'`

- [ ] **Step 3: Write the shared helpers**

```ts
// src/lib/server/sources/routers/shared.ts
import type { Capability } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';
import { DEFAULT_TTL_SECONDS, type SourceCache } from '../cache';
import type { Dispatcher } from '../dispatch';
import type { SourceContext } from '../provider';
import type { SourceRegistry } from '../registry';

export interface RouterDeps {
	registry: SourceRegistry;
	dispatcher: Dispatcher;
	cache: SourceCache;
}

/**
 * How long this capability's answer keeps, letting a provider override the default.
 *
 * The first connection that supports it decides. With several connections of one kind
 * their TTLs could differ, and the shortest would be the safe choice — but the fan-out
 * is cached as one entry, so one number has to win, and the first is stable.
 */
function ttlFor(deps: RouterDeps, capability: Capability): number {
	return (
		deps.registry.supporting(capability)[0]?.definition.ttl?.[capability] ??
		DEFAULT_TTL_SECONDS[capability]
	);
}

/**
 * An aggregate read whose answer is a list: fan out, concatenate, cache.
 *
 * Shared by every router, because what differs between them is which capability answers
 * which port method — never how dispatch or caching work.
 */
export async function fanOut<T>(
	deps: RouterDeps,
	capability: Capability,
	scope: PlatformScope,
	args: string,
	call: (client: unknown, ctx: SourceContext) => Promise<T[]>
): Promise<T[]> {
	const { data } = await deps.cache.read(
		{ connectionId: 'fan-out', capability, args, ttlSeconds: ttlFor(deps, capability) },
		async () => (await deps.dispatcher.all<T>({ capability, scope, call })).data
	);

	// `all` already concatenates each connection's list into one, which is what the port
	// wants. Nothing to flatten here — see the dispatcher's flatMap.
	return data as T[];
}

/**
 * An aggregate read whose answer is a single value.
 *
 * With several connections the first answer stands. Nothing merges two answers to one
 * question — that is what "each resource belongs to one source" bought, and a router is
 * not the place to start reconciling.
 */
export async function fanOutSingle<T>(
	deps: RouterDeps,
	capability: Capability,
	scope: PlatformScope,
	args: string,
	call: (client: unknown, ctx: SourceContext) => Promise<T>
): Promise<T> {
	const { data } = await deps.cache.read(
		{ connectionId: 'fan-out', capability, args, ttlSeconds: ttlFor(deps, capability) },
		// `all` deals in lists, so a single-valued aggregate is wrapped into a
		// one-element list and unwrapped again below. The alternative is a third
		// dispatch rule, and two is the number this design deliberately stopped at.
		async () =>
			(
				await deps.dispatcher.all<T>({
					capability,
					scope,
					call: async (client, ctx) => [await call(client, ctx)]
				})
			).data
	);

	return (data as T[])[0];
}
```

- [ ] **Step 4: Write the router**

```ts
// src/lib/server/sources/routers/infrastructure.ts
import type { InfrastructureGroup } from '$lib/platform/types';
import type { InfrastructureSource } from '../../platform/source';
import type { CloudProvider } from '../contracts';
import { fanOut, fanOutSingle, type RouterDeps } from './shared';

/**
 * `InfrastructureSource`, implemented by dispatching to cloud providers.
 *
 * Every method of this port is source-backed — it has no catalog side — except
 * `listGroups`, which is composed from four other capabilities rather than being one of
 * its own. That keeps the four-count summary and the panels beneath it counting the
 * same things, and means the summary is available exactly when its parts are.
 */
export function createInfrastructureRouter(deps: RouterDeps): InfrastructureSource {
	const source: InfrastructureSource = {
		id: 'routed',

		listRegions: (scope) =>
			fanOut(deps, 'cloud.regions', scope, '', (client, ctx) =>
				(client as CloudProvider).listRegions!(ctx)
			),

		readNodeCounts: (scope) =>
			fanOutSingle(deps, 'cloud.nodes', scope, '', (client, ctx) =>
				(client as CloudProvider).readNodeCounts!(ctx)
			),

		listClusters: (scope, limit) =>
			fanOut(deps, 'cloud.clusters', scope, `limit=${limit}`, (client, ctx) =>
				(client as CloudProvider).listClusters!(ctx, limit)
			),

		readUtilization: (scope) =>
			fanOut(deps, 'cloud.utilization', scope, '', (client, ctx) =>
				(client as CloudProvider).readUtilization!(ctx)
			),

		readStorage: (scope) =>
			fanOutSingle(deps, 'cloud.storage', scope, '', (client, ctx) =>
				(client as CloudProvider).readStorage!(ctx)
			),

		listDatabases: (scope, limit) =>
			fanOut(deps, 'cloud.databases', scope, `limit=${limit}`, (client, ctx) =>
				(client as CloudProvider).listDatabases!(ctx, limit)
			),

		listQueues: (scope, limit) =>
			fanOut(deps, 'cloud.queues', scope, `limit=${limit}`, (client, ctx) =>
				(client as CloudProvider).listQueues!(ctx, limit)
			),

		listAlerts: (scope, limit) =>
			fanOut(deps, 'cloud.alerts', scope, `limit=${limit}`, (client, ctx) =>
				(client as CloudProvider).listAlerts!(ctx, limit)
			),

		readCost: (scope) =>
			fanOutSingle(deps, 'cloud.cost', scope, '', (client, ctx) =>
				(client as CloudProvider).readCost!(ctx)
			),

		async listGroups(scope): Promise<InfrastructureGroup[]> {
			const [nodes, clusters, databases, queues] = await Promise.all([
				source.readNodeCounts(scope),
				source.listClusters(scope, 100),
				source.listDatabases(scope, 100),
				source.listQueues(scope, 100)
			]);

			return [
				{
					id: 'clusters',
					label: 'Clusters',
					icon: 'boxes',
					count: clusters.length,
					status: 'healthy',
					statusLabel: 'Healthy'
				},
				{
					id: 'nodes',
					label: 'Nodes',
					icon: 'server',
					count: nodes.healthy + nodes.warning + nodes.down,
					status: nodes.down > 0 ? 'degraded' : 'healthy',
					statusLabel: nodes.down > 0 ? 'Degraded' : 'Healthy'
				},
				{
					id: 'databases',
					label: 'Databases',
					icon: 'database',
					count: databases.length,
					status: 'healthy',
					statusLabel: 'Healthy'
				},
				{
					id: 'queues',
					label: 'Queues',
					icon: 'layers',
					count: queues.length,
					status: queues.some((queue) => queue.status !== 'healthy') ? 'degraded' : 'healthy',
					statusLabel: 'Operational'
				}
			];
		}
	};

	return source;
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/lib/server/sources/routers/ && bun run check`
Expected: 6 tests PASS, 0 type errors.

- [ ] **Step 6: Commit**

```bash
bun run format
git add src/lib/server/sources/
git commit -m "feat: route InfrastructureSource to cloud providers"
```

---

### Task 11: The platform, service and deployment routers

**Files:**

- Create: `src/lib/server/sources/routers/platform.ts`, `routers/service.ts`, `routers/deployment.ts`, `routers/index.ts`
- Test: `src/lib/server/sources/routers/routers.test.ts`

**Interfaces:**

- Consumes: `RouterDeps`, `fanOut`, `fanOutSingle` (Task 10); the kind contracts (Task 3); `PlatformSource`, `ServiceSource`, `DeploymentSource` from `../../platform/source`; the existing fixture catalog modules.
- Produces: `function createPlatformRouter(deps, catalog: PlatformSource): PlatformSource`; `function createServiceRouter(deps, catalog: ServiceSource): ServiceSource`; `function createDeploymentRouter(deps): DeploymentSource`; `function createRouters(deps, catalog: { platform: PlatformSource; service: ServiceSource })`.

**The classification, restated from the spec.** Each router takes a `catalog` implementation for the app-owned half and dispatches the rest:

| Port               | Served from `catalog`                                                                                               | Dispatched (capability)                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PlatformSource`   | `queryDomains`, `findDomain`, `readDomainStatusCounts`, `listOwners`, `listRecentChanges`, `readDomainDependencies` | `readDomainVitals` (`apm.domainVitals`), `readRates` (`apm.rates`), `listIncidents` (`apm.incidents`), `readActivitySummary` (`apm.activity`)                                                                                                                                                                                                          |
| `ServiceSource`    | `listServices`, `findService`                                                                                       | `readStats` (`apm.serviceStats`), `listHealthChecks` (`apm.healthChecks`), `readDependencies` (`apm.dependencies`), `readRequestRate` (`apm.requestRate`), `listEndpoints` (`apm.endpoints`), `readMetricSeries` (`apm.metricSeries`), `readSloBudget` (`apm.slo`), `readLatencyHeatmap` (`apm.latencyHeatmap`), `listMetricInsights` (`apm.insights`) |
| `DeploymentSource` | —                                                                                                                   | `queryDeployments`, `listDeployments` (`deployment.log`), `readSummary` (`deployment.summary`), `readDomainBreakdown` (`deployment.breakdown`), `readStatusTrend` (`deployment.statusTrend`), `readTrends` (`deployment.trends`), `listInsights` (`deployment.insights`), `listDeployingDomains` (`deployment.domains`)                                |
| `WorkspaceSource`  | everything — no router; the existing fixture implementation is used unchanged                                       | —                                                                                                                                                                                                                                                                                                                                                      |

`ServiceSource.listServiceVitals` is the join: identity from `catalog`, readings from APM. In this plan it is served entirely from `catalog`, because the fixture catalog already produces the readings; the APM half arrives with the real Coralogix provider. A test records that, so it is a stated decision rather than an oversight.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/routers/routers.test.ts
import { describe, expect, test } from 'bun:test';
import { createRouters } from './index';
import { createDispatcher } from '../dispatch';
import { SourceCache } from '../cache';
import { SourceRegistry } from '../registry';
import { CapabilityUnavailableError } from '../errors';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../fixtures';
import { FixturePlatformSource, FixtureServiceSource } from '../../platform/fixture-source';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

function build(connections: unknown = FIXTURE_CONNECTIONS) {
	const registry = new SourceRegistry();
	for (const provider of FIXTURE_PROVIDERS) registry.register(provider);
	registry.load(connections, {});

	return createRouters(
		{
			registry,
			dispatcher: createDispatcher(registry),
			cache: new SourceCache()
		},
		{
			platform: new FixturePlatformSource(),
			service: new FixtureServiceSource()
		}
	);
}

describe('the platform router', () => {
	test('serves catalog methods locally, with no source connected at all', async () => {
		const { platform } = build({ connections: [] });

		// The domain catalog is app-owned: it must not depend on an APM connection.
		expect(
			(
				await platform.queryDomains(scope, {
					search: '',
					status: 'all',
					owner: 'all',
					sort: 'health-score',
					page: 1,
					pageSize: 5
				})
			).domains
		).toHaveLength(5);
		expect(await platform.findDomain(scope, 'payment-domain')).not.toBeNull();
		expect((await platform.readDomainStatusCounts(scope)).healthy).toBeGreaterThan(0);
	});

	test('dispatches the APM-backed methods', async () => {
		const { platform } = build();

		expect(await platform.readRates(scope)).toHaveLength(3);
		expect(await platform.listIncidents(scope, 2)).toHaveLength(2);
		expect((await platform.readActivitySummary(scope)).activeIncidents).toBeGreaterThan(0);
		expect(await platform.readDomainVitals(scope, 'payment-domain')).not.toBeNull();
	});

	test('without an APM connection the APM-backed methods are unavailable', async () => {
		const { platform } = build({ connections: [] });

		expect(platform.readRates(scope)).rejects.toThrow(CapabilityUnavailableError);
		expect(platform.listIncidents(scope, 2)).rejects.toThrow(CapabilityUnavailableError);
	});
});

describe('the service router', () => {
	test('serves the catalog locally and the readings from APM', async () => {
		const { service } = build();

		expect((await service.listServices(scope)).length).toBeGreaterThan(0);
		expect(await service.findService(scope, 'payment-api')).not.toBeNull();
		expect((await service.readStats(scope, 'payment-api')).length).toBeGreaterThan(0);
		expect((await service.readSloBudget(scope, 'payment-api')).targetPct).toBe(99.9);
	});

	test('listServiceVitals stays on the catalog in this increment', async () => {
		// Recorded as a decision: the fixture catalog already produces the readings, and
		// the APM half of this join arrives with the real Coralogix provider.
		const { service } = build({ connections: [] });
		const platform = new FixturePlatformSource();
		const domain = (await platform.findDomain(scope, 'payment-domain'))!;
		const vitals = (await platform.readDomainVitals(scope, 'payment-domain'))!;

		const rows = await service.listServiceVitals(scope, domain.id, vitals, domain.serviceCount);
		expect(rows).toHaveLength(domain.serviceCount);
	});
});

describe('the deployment router', () => {
	test('dispatches every method', async () => {
		const { deployment } = build();

		expect(await deployment.listDeployments(scope, 3)).toHaveLength(3);
		expect((await deployment.readSummary(scope)).total).toBeGreaterThan(0);
		expect(await deployment.readStatusTrend(scope)).toHaveLength(3);
		expect((await deployment.readTrends(scope, 'daily')).frequency.points.length).toBeGreaterThan(
			0
		);
		expect((await deployment.listInsights(scope)).length).toBeGreaterThan(0);
		expect((await deployment.listDeployingDomains(scope)).length).toBeGreaterThan(0);
		expect((await deployment.readDomainBreakdown(scope)).total).toBeGreaterThan(0);
	});

	test('a filtered query still reaches the source and narrows', async () => {
		const { deployment } = build();
		const page = await deployment.queryDeployments(scope, {
			search: '',
			state: 'failed',
			domain: 'all',
			service: 'all',
			environment: 'all',
			window: 'any',
			page: 1,
			pageSize: 50
		});

		expect(page.deployments.every((one) => one.status === 'failed')).toBe(true);
	});

	test('without a deployment connection every method is unavailable', async () => {
		const { deployment } = build({ connections: [] });

		expect(deployment.readSummary(scope)).rejects.toThrow(CapabilityUnavailableError);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/routers/routers.test.ts`
Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Write the platform router**

```ts
// src/lib/server/sources/routers/platform.ts
import type { PlatformSource } from '../../platform/source';
import type { ApmProvider } from '../contracts';
import { fanOut, fanOutSingle, type RouterDeps } from './shared';

/**
 * `PlatformSource`, split between the catalog and an APM source.
 *
 * The domain catalog is app-owned: which domains exist, what they are called and how
 * they depend on each other is this platform's own model, and no monitoring tool knows
 * it. What a domain is currently *doing* comes from APM. Serving the first from the
 * catalog is why the domains table keeps working with nothing connected.
 */
export function createPlatformRouter(deps: RouterDeps, catalog: PlatformSource): PlatformSource {
	return {
		id: 'routed',

		// App-owned: delegated to the catalog unchanged.
		queryDomains: (scope, query) => catalog.queryDomains(scope, query),
		findDomain: (scope, slug) => catalog.findDomain(scope, slug),
		readDomainStatusCounts: (scope) => catalog.readDomainStatusCounts(scope),
		listOwners: (scope) => catalog.listOwners(scope),
		listRecentChanges: (scope, limit) => catalog.listRecentChanges(scope, limit),
		readDomainDependencies: (scope, slug) => catalog.readDomainDependencies(scope, slug),

		// Source-backed.
		readDomainVitals: (scope, slug) =>
			fanOutSingle(deps, 'apm.domainVitals', scope, `domain=${slug}`, (client, ctx) =>
				(client as ApmProvider).readDomainVitals!({
					...ctx,
					binding: bindingFor(slug)
				})
			),

		readRates: (scope) =>
			fanOut(deps, 'apm.rates', scope, '', (client, ctx) =>
				(client as ApmProvider).readRates!(ctx)
			),

		listIncidents: (scope, limit) =>
			fanOut(deps, 'apm.incidents', scope, `limit=${limit}`, (client, ctx) =>
				(client as ApmProvider).listIncidents!(ctx, limit)
			),

		readActivitySummary: (scope) =>
			fanOutSingle(deps, 'apm.activity', scope, '', (client, ctx) =>
				(client as ApmProvider).readActivitySummary!(ctx)
			)
	};
}

/**
 * A binding standing in for the catalog's, until bindings land on domain records.
 *
 * Increment 6 replaces this with the record's own binding. Until then a resource-scoped
 * APM read still needs to say *which* resource, and the slug is what the fixture
 * provider expects.
 */
function bindingFor(slug: string) {
	return { kind: 'apm' as const, connectionId: '', externalId: slug };
}
```

- [ ] **Step 4: Write the service router**

```ts
// src/lib/server/sources/routers/service.ts
import type { ServiceSource } from '../../platform/source';
import type { ApmProvider } from '../contracts';
import { fanOut, fanOutSingle, type RouterDeps } from './shared';

const apmBinding = (slug: string) => ({
	kind: 'apm' as const,
	connectionId: '',
	externalId: slug
});

/**
 * `ServiceSource`, split between the catalog and an APM source.
 *
 * The catalog half is what a service *is*; the APM half is what it is *doing*. That is
 * also why Coralogix could never implement this port directly: it has no idea what
 * services exist, only what is emitting telemetry.
 */
export function createServiceRouter(deps: RouterDeps, catalog: ServiceSource): ServiceSource {
	return {
		id: 'routed',

		// App-owned.
		listServices: (scope, domainId) => catalog.listServices(scope, domainId),
		findService: (scope, slug) => catalog.findService(scope, slug),
		/*
		 * The join. Identity is the catalog's and the readings are APM's, but in this
		 * increment both come from the catalog, whose fixtures already produce them. The
		 * APM half arrives with the real provider; splitting it now would mean inventing
		 * a merge for data that comes from one place.
		 */
		listServiceVitals: (scope, domainId, vitals, total) =>
			catalog.listServiceVitals(scope, domainId, vitals, total),

		// Source-backed.
		readStats: (scope, slug) =>
			fanOut(deps, 'apm.serviceStats', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readServiceStats!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		listHealthChecks: (scope, slug) =>
			fanOut(deps, 'apm.healthChecks', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).listHealthChecks!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		readDependencies: (scope, slug) =>
			fanOutSingle(deps, 'apm.dependencies', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readServiceDependencies!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		readRequestRate: (scope, slug) =>
			fanOutSingle(deps, 'apm.requestRate', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readRequestRate!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		listEndpoints: (scope, slug, limit) =>
			fanOut(deps, 'apm.endpoints', scope, `service=${slug}&limit=${limit}`, (client, ctx) =>
				(client as ApmProvider).listEndpoints!({ ...ctx, binding: apmBinding(slug) }, limit)
			),

		readMetricSeries: (scope, slug) =>
			fanOutSingle(deps, 'apm.metricSeries', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readMetricSeries!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		readSloBudget: (scope, slug) =>
			fanOutSingle(deps, 'apm.slo', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readSloBudget!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		readLatencyHeatmap: (scope, slug) =>
			fanOutSingle(deps, 'apm.latencyHeatmap', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readLatencyHeatmap!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		listMetricInsights: (scope, slug) =>
			fanOut(deps, 'apm.insights', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).listMetricInsights!({
					...ctx,
					binding: apmBinding(slug)
				})
			)
	};
}
```

- [ ] **Step 5: Write the deployment router and the barrel**

```ts
// src/lib/server/sources/routers/deployment.ts
import type { DeploymentSource } from '../../platform/source';
import type { DeploymentProvider } from '../contracts';
import { fanOut, fanOutSingle, type RouterDeps } from './shared';

/** `DeploymentSource` has no catalog side: every method is a deployment source's answer. */
export function createDeploymentRouter(deps: RouterDeps): DeploymentSource {
	return {
		id: 'routed',

		queryDeployments: (scope, query) =>
			fanOutSingle(deps, 'deployment.log', scope, JSON.stringify(query), (client, ctx) =>
				(client as DeploymentProvider).queryDeployments!(ctx, query)
			),

		listDeployments: (scope, limit) =>
			fanOut(deps, 'deployment.log', scope, `recent=${limit}`, (client, ctx) =>
				(client as DeploymentProvider).listDeployments!(ctx, limit)
			),

		readSummary: (scope) =>
			fanOutSingle(deps, 'deployment.summary', scope, '', (client, ctx) =>
				(client as DeploymentProvider).readSummary!(ctx)
			),

		readDomainBreakdown: (scope) =>
			fanOutSingle(deps, 'deployment.breakdown', scope, '', (client, ctx) =>
				(client as DeploymentProvider).readDomainBreakdown!(ctx)
			),

		readStatusTrend: (scope) =>
			fanOut(deps, 'deployment.statusTrend', scope, '', (client, ctx) =>
				(client as DeploymentProvider).readStatusTrend!(ctx)
			),

		readTrends: (scope, grain) =>
			fanOutSingle(deps, 'deployment.trends', scope, `grain=${grain}`, (client, ctx) =>
				(client as DeploymentProvider).readTrends!(ctx, grain)
			),

		listInsights: (scope) =>
			fanOut(deps, 'deployment.insights', scope, '', (client, ctx) =>
				(client as DeploymentProvider).listInsights!(ctx)
			),

		listDeployingDomains: (scope) =>
			fanOut(deps, 'deployment.domains', scope, '', (client, ctx) =>
				(client as DeploymentProvider).listDeployingDomains!(ctx)
			)
	};
}
```

```ts
// src/lib/server/sources/routers/index.ts
import type { PlatformSource, ServiceSource } from '../../platform/source';
import { createDeploymentRouter } from './deployment';
import { createInfrastructureRouter } from './infrastructure';
import { createPlatformRouter } from './platform';
import { createServiceRouter } from './service';
import type { RouterDeps } from './shared';

export {
	createDeploymentRouter,
	createInfrastructureRouter,
	createPlatformRouter,
	createServiceRouter
};
export type { RouterDeps } from './shared';

/**
 * Every router, sharing one registry, dispatcher and cache.
 *
 * One cache across all four is deliberate: two screens asking different ports for the
 * same capability should still issue one call.
 */
export function createRouters(
	deps: RouterDeps,
	catalog: { platform: PlatformSource; service: ServiceSource }
) {
	return {
		platform: createPlatformRouter(deps, catalog.platform),
		service: createServiceRouter(deps, catalog.service),
		deployment: createDeploymentRouter(deps),
		infrastructure: createInfrastructureRouter(deps)
	};
}
```

- [ ] **Step 6: Run the tests**

Run: `bun test src/lib/server/sources/ && bun run check`
Expected: 8 new tests PASS, everything else still green.

- [ ] **Step 7: Commit**

```bash
bun run format
git add src/lib/server/sources/
git commit -m "feat: route the platform, service and deployment ports

Each router serves the app-owned half from the catalog and dispatches the rest.
The domain and service catalogs stay local because which domains exist and what
they are called is this platform's own model — which is also why Coralogix could
never implement ServiceSource directly: it knows what is emitting telemetry, not
what services exist.

listServiceVitals stays entirely on the catalog for now. Its APM half arrives with
the real provider; splitting it today would mean inventing a merge for data that
comes from one place. A test records that as a decision rather than an oversight."
```

---

### Task 12: Wire the resolver behind SOURCES_CONFIG

**Files:**

- Create: `src/lib/server/sources/boot.ts`
- Modify: `src/lib/server/platform/index.ts`
- Modify: `.env.example`
- Modify: `CLAUDE.md`
- Test: `src/lib/server/sources/boot.test.ts`

**Interfaces:**

- Consumes: `SourceRegistry` (Task 5), `createDispatcher` (Task 8), `SourceCache` (Task 9), `createRouters` (Task 11), `FIXTURE_PROVIDERS` and `FIXTURE_CONNECTIONS` (Task 7).
- Produces: `function buildSources(options: { config: unknown; env: Record<string, string | undefined>; catalog: { platform: PlatformSource; service: ServiceSource } }): Routers`; `function readSourceConfig(path: string | undefined): Promise<unknown | null>`.

This is the task that puts the framework on the live path. Everything before it was
provably correct in isolation; this one makes the running app use it.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/server/sources/boot.test.ts
import { describe, expect, test } from 'bun:test';
import { buildSources } from './boot';
import { FIXTURE_CONNECTIONS } from './fixtures';
import { FixturePlatformSource, FixtureServiceSource } from '../platform/fixture-source';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const catalog = { platform: new FixturePlatformSource(), service: new FixtureServiceSource() };

describe('buildSources', () => {
	test('with no config it connects the fixture providers, so the app runs as it does today', async () => {
		const routers = buildSources({ config: null, env: {}, catalog });

		expect((await routers.infrastructure.listRegions(scope)).length).toBeGreaterThan(0);
		expect((await routers.deployment.readSummary(scope)).total).toBeGreaterThan(0);
	});

	test('an explicit config is used instead of the fixtures', async () => {
		const routers = buildSources({ config: FIXTURE_CONNECTIONS, env: {}, catalog });

		expect((await routers.infrastructure.readNodeCounts(scope)).healthy).toBeGreaterThan(0);
	});

	test('a config naming an unregistered provider refuses to start', () => {
		expect(() =>
			buildSources({
				config: { connections: [{ id: 'x', provider: 'azure', label: 'X', settings: {} }] },
				env: {},
				catalog
			})
		).toThrow(/azure/);
	});

	test('a malformed config refuses to start rather than silently serving nothing', () => {
		expect(() => buildSources({ config: { nope: true }, env: {}, catalog })).toThrow();
	});

	test('the four routers share one cache, so one capability is fetched once', async () => {
		const routers = buildSources({ config: FIXTURE_CONNECTIONS, env: {}, catalog });

		// listGroups reads node counts internally; a direct read must hit the same entry.
		await routers.infrastructure.listGroups(scope);
		const counts = await routers.infrastructure.readNodeCounts(scope);

		expect(counts.healthy).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/lib/server/sources/boot.test.ts`
Expected: FAIL — `Cannot find module './boot'`

- [ ] **Step 3: Write the boot module**

```ts
// src/lib/server/sources/boot.ts
import type { PlatformSource, ServiceSource } from '../platform/source';
import { SourceCache } from './cache';
import { createDispatcher } from './dispatch';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from './fixtures';
import { SourceRegistry } from './registry';
import { createRouters } from './routers';

/**
 * Read the connections file, or nothing.
 *
 * `Bun.file` rather than `node:fs`, per the API selection order. A path that is set but
 * unreadable throws: someone meant to configure sources, and quietly falling back to
 * fixtures would serve seeded numbers in production with nothing on the page admitting
 * it — the failure the existing resolver's throw-on-unknown-name already guards against.
 */
export async function readSourceConfig(path: string | undefined): Promise<unknown | null> {
	if (!path) return null;

	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`SOURCES_CONFIG points at ${path}, which does not exist.`);
	}

	return file.json();
}

/**
 * Build the registry, the cache and the four routers.
 *
 * With no configuration the fixture providers are connected, so the app behaves exactly
 * as it does today while still exercising the routed path. That matters more than it
 * sounds: it means the routing layer is on the live path from the first commit rather
 * than being a branch nobody runs until a real provider exists.
 */
export function buildSources(options: {
	config: unknown;
	env: Record<string, string | undefined>;
	catalog: { platform: PlatformSource; service: ServiceSource };
}) {
	const registry = new SourceRegistry();
	for (const provider of FIXTURE_PROVIDERS) registry.register(provider);

	registry.load(options.config ?? FIXTURE_CONNECTIONS, options.env);

	// One cache across all four routers: two screens asking different ports for the same
	// capability should still issue one call.
	const deps = { registry, dispatcher: createDispatcher(registry), cache: new SourceCache() };

	return createRouters(deps, options.catalog);
}
```

- [ ] **Step 4: Point the resolver at the routers**

Replace the five cached singletons in `src/lib/server/platform/index.ts` with routers built
once. `WorkspaceSource` keeps its existing resolution — it has no router, because every
one of its methods is app-owned.

```ts
// src/lib/server/platform/index.ts — replacing the platform/deployment/service/
// infrastructure resolution. Keep the existing `workspaceSources` registry, the
// `selectSource` import and the `workspaceSource()` export exactly as they are.
import { env } from '$env/dynamic/private';
import { buildSources, readSourceConfig } from '../sources/boot';
import {
	FixtureDeploymentSource,
	FixtureInfrastructureSource,
	FixturePlatformSource,
	FixtureServiceSource,
	FixtureWorkspaceSource
} from './fixture-source';
import type {
	DeploymentSource,
	InfrastructureSource,
	PlatformSource,
	ServiceSource,
	WorkspaceSource
} from './source';

/**
 * Resolves which implementations the app runs against.
 *
 * Every read now goes through a router, whatever is configured. With `SOURCES_CONFIG`
 * unset the routers dispatch to fixture providers and the app behaves exactly as it did
 * — but the routed path is the only path, so it cannot rot while nobody is looking.
 *
 * The catalog half — which domains and services exist — is still served by the fixture
 * implementations, because that is app-owned data and no data source knows it. It is
 * what a real database will replace, separately from any of this.
 */
let routers: ReturnType<typeof buildSources> | undefined;

async function resolveRouters() {
	if (routers) return routers;

	routers = buildSources({
		config: await readSourceConfig(env.SOURCES_CONFIG),
		env,
		catalog: { platform: new FixturePlatformSource(), service: new FixtureServiceSource() }
	});

	return routers;
}

/*
 * The port accessors stay synchronous, because every caller and every test expects them
 * to be. Each returns a facade that resolves the routers on first use — the alternative
 * is making forty call sites `await` a resolver whose answer never changes.
 */
function facade<T extends object>(pick: (r: ReturnType<typeof buildSources>) => T): T {
	return new Proxy({} as T, {
		get(_target, property) {
			if (property === 'id') return 'routed';
			return async (...args: unknown[]) => {
				const resolved = pick(await resolveRouters());
				return (resolved[property as keyof T] as (...a: unknown[]) => unknown)(...args);
			};
		}
	});
}

export function platformSource(): PlatformSource {
	return facade((r) => r.platform);
}

export function deploymentSource(): DeploymentSource {
	return facade((r) => r.deployment);
}

export function serviceSource(): ServiceSource {
	return facade((r) => r.service);
}

export function infrastructureSource(): InfrastructureSource {
	return facade((r) => r.infrastructure);
}
```

**If the proxy is uncomfortable**, the alternative is to make `readSourceConfig`
synchronous with `Bun.file(path).text()` read at module load and drop the facade
entirely. Prefer that if the implementer finds the proxy hard to reason about — a
synchronous boot is simpler than a lazy one, and the config is read once. Whichever is
chosen, the behaviour the tests assert is the same.

- [ ] **Step 5: Run the whole suite**

Run: `bun test && bun run check && bun run lint`
Expected: every pre-existing test still passes. This is the gate for the whole plan —
the app now reads through routers, and nothing above the ports changed.

- [ ] **Step 6: Verify in a browser**

```bash
bun run build && bun run dev
```

Open `/`, `/domains`, `/domains/payment-domain`, `/services/payment-api`,
`/services/payment-api/metrics`, `/deployments` and `/infrastructure`. Every page must
render exactly as before. Check the console is clean.

- [ ] **Step 7: Document the variable**

In `.env.example`, beneath the existing source variables:

```bash
# Path to the data-source connections file. Unset means the fixture providers are
# connected, and the app behaves exactly as it does with no configuration at all.
# See docs/superpowers/specs/2026-09-04-data-source-plugins-design.md for the format.
SOURCES_CONFIG=
```

In `CLAUDE.md`, under Architecture, after the "Plugging in a real data source" section:

```markdown
### Data sources sit beneath the ports

`src/lib/server/sources/` is where data comes from; `src/lib/server/platform/` is what
the app asks for. Providers declare a kind (`cloud`, `apm`, `deployment`) and the
capabilities they implement; connections are configured instances of them, listed in the
file `SOURCES_CONFIG` names. Routers implement each port by serving app-owned methods
from the catalog and dispatching the rest to whichever connection owns the resource.

**Every read goes through a router, always.** With `SOURCES_CONFIG` unset the routers
dispatch to fixture providers, so the routed path is the only path and cannot rot while
nobody is looking.

**A capability nobody implements is stated, never faked.** The router throws
`CapabilityUnavailableError`; assemblers turn that into a `Panel<T>` the UI renders as an
explicit empty state. Serving zeros instead would reproduce exactly the failure the
resolver's throw-on-unknown-name exists to prevent.
```

- [ ] **Step 8: Commit**

```bash
bun run format
git add -A
git commit -m "feat: read every port through a source router

The routing layer is now the only path. With SOURCES_CONFIG unset the routers
dispatch to fixture providers and the app behaves exactly as it did — which is the
point: a routed path that only runs once a real provider exists is a path nobody
has tested.

The catalog half stays on the fixture implementations, because which domains and
services exist is app-owned data no monitoring tool knows. That is what a real
database replaces, separately from any of this.

A SOURCES_CONFIG that points at a missing file throws rather than falling back to
fixtures: somebody meant to configure sources, and quietly serving seeded numbers
is the failure the resolver's throw-on-unknown-name already guards against."
```

---

## What this plan does not cover

After Task 12 the framework is complete and on the live path, and the app is unchanged
from a reader's point of view. Three pieces of the spec remain, each its own plan:

- **Panels reporting gaps** — putting `Panel<T>` into the snapshot types, wrapping
  source-backed reads in `panel()` in the six assemblers, and giving the panel components
  their `unavailable` and `failed` states. Plus the API's 501 `capability_unavailable`.
  The contract for all of it exists already (Tasks 1–2); this is its adoption.
- **The harness and the Azure provider** — spec increments 4 and 5.
- **Bindings and exposure** — spec increment 6: `bindings` on domain and service records,
  replacing the placeholder `bindingFor`/`apmBinding` helpers in the platform and service
  routers, and `/api/v1/sources`.

Three loose threads this plan knowingly leaves, each recorded so a reviewer does not
read them as oversights:

- **`panel()` has no caller yet.** Tasks 1–2 build the `Panel<T>` contract because the
  routers throw the errors it converts; the assemblers that wrap reads in it belong to
  the next plan. It is fully tested in isolation.
- **`Dispatcher.one` has no caller yet.** The resource-scoped rule is implemented and
  tested, but every router currently reaches for `fanOut`, because a resource-scoped
  dispatch needs a real binding and bindings land in increment 6. Wiring it early would
  mean routing on a placeholder.
- **The placeholder binding helpers** (`bindingFor` in the platform router, `apmBinding`
  in the service router) exist for the same reason and are marked in the code with the
  increment that removes them.
