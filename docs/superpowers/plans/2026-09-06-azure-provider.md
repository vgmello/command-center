# Azure Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the infrastructure screen from a real Azure subscription, with a local
emulator standing in for it, so `/infrastructure` stops being invented data.

**Architecture:** A new `src/lib/server/sources/providers/azure/` implementing
`CloudProvider` against ARM and Azure Monitor, reached through the existing router and
dispatcher. `baseUrl` in its settings chooses floci-az or real Azure — nothing above the
port changes. Before any of that, `CloudProvider` is narrowed to facts, because it
currently requires a provider to invent UI tints and formatted strings.

**Tech Stack:** TypeScript, Valibot, `bun test`, `@azure/identity` (the one new runtime
dependency, sanctioned by the source spec).

**Spec:** `docs/superpowers/specs/2026-09-06-azure-provider-design.md`

## Global Constraints

- **Valibot, not Zod.** Namespaced: `import * as v from 'valibot'`.
- **`bun test`**, not Vitest. `import { describe, expect, test } from 'bun:test'`.
- **One new dependency, `@azure/identity`.** Nothing else. Everything else — the REST calls,
  the paging, the mapping — is `fetch` and hand-written, per the API selection order.
- **Sources return facts.** No provider emits a colour, an accent, an icon or a
  pre-formatted string. Task 1 makes that true of `CloudProvider`; nothing after it may
  reintroduce one.
- **Declare only what is implemented.** A capability the adapter cannot serve is left out of
  the provider's `capabilities` set, never stubbed with zeros.
- **Nothing is classified `series`.** `tiers.test.ts` refuses a `series` capability that no
  router accumulates.
- **Secrets never reach an error message.** Settings are validated with `v.safeParse` and
  only issue _paths_ are reported, per the existing `loadConnections`.
- **Run before every commit:** `bun run check && bun run lint && bun test`.
- **The fixture stays.** `fixture-cloud` is not deleted or weakened; it remains the
  no-configuration default.

## File Structure

| File                                                  | Responsibility                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `src/lib/platform/types.ts`                           | narrowed `ResourceUsage`, `StorageClass`, `CostBreakdown` (Task 1) |
| `src/lib/platform/infrastructure.ts`                  | the presentation those types lost — accents, formatting (Task 1)   |
| `src/lib/server/platform/infrastructure-view.ts`      | derives presentation from facts (Task 1)                           |
| `src/lib/server/sources/providers/azure/client.ts`    | auth, ARM/Monitor REST, paging                                     |
| `src/lib/server/sources/providers/azure/map.ts`       | ARM shapes → domain facts                                          |
| `src/lib/server/sources/providers/azure/index.ts`     | `defineProvider`, settings, capabilities, deep links               |
| `src/lib/server/sources/providers/azure/mock/cost.ts` | Cost Management mock — floci-az does not emulate it                |
| `docker-compose.yml`                                  | the floci-az service                                               |
| `sources.local.json`                                  | the connections file naming it                                     |

---

### Task 1: Narrow `CloudProvider` to facts

The prerequisite. `ResourceUsage` carries `formatted`, `StorageClass` carries `accent` and
`formatted`, `DatabaseInstance` carries `storageFormatted`. An Azure adapter would have to
decide that Blob Storage is tinted violet, which is not a fact about Azure.

It is also already losing data. `toStorageDto` reconstructs bytes from a rounded
percentage, because the internal type kept a string and a share instead of the number:

```ts
bytes: Math.round((one.percentage / 100) * storage.totalBytes);
```

**Files:**

- Modify: `src/lib/platform/types.ts`
- Modify: `src/lib/platform/infrastructure.ts`
- Modify: `src/lib/server/platform/infrastructure-fixtures.ts`
- Modify: `src/lib/server/platform/infrastructure-view.ts`
- Modify: `src/lib/server/api/v1/dto.ts`
- Test: `src/lib/platform/infrastructure.test.ts`, `src/lib/server/api/v1/dto.test.ts`

**Interfaces:**

- Produces: the narrowed types every later task implements against.

```ts
// Facts. The provider knows bytes; it does not know violet.
export interface StorageClass {
	id: string;
	label: string;
	bytes: number;
}

export interface ResourceUsage {
	id: string;
	label: string;
	/** The headline reading, in `unit`. */
	value: number;
	/** The unit `value` is in: '%' or 'bps'. */
	unit: string;
	series: TimeSeries;
	axisMax: number;
	change: number;
	direction: TrendDirection;
	polarity: TrendPolarity;
}

export interface DatabaseInstance {
	id: string;
	name: string;
	engine: string;
	status: HealthStatus;
	cpuPct: number;
	connections: number;
	connectionLimit: number;
	storageBytes: number;
}
```

- [ ] **Step 1: Write the failing test for the accent assignment moving up**

```ts
// src/lib/platform/infrastructure.test.ts
import { describe, expect, test } from 'bun:test';
import { accentForStorageClass, toStorageView } from './infrastructure';

describe('storage presentation', () => {
	test('shares are computed from the bytes, not the other way round', () => {
		const view = toStorageView({
			totalBytes: 1000,
			classes: [
				{ id: 'hot', label: 'Hot', bytes: 750 },
				{ id: 'cool', label: 'Cool', bytes: 250 }
			]
		});

		expect(view.classes.map((one) => one.percentage)).toEqual([75, 25]);
		// The bytes survive exactly, which is what the DTO could not do when the internal
		// shape kept only a rounded share.
		expect(view.classes.map((one) => one.bytes)).toEqual([750, 250]);
	});

	test('every class gets a stable accent, so two renders agree', () => {
		expect(accentForStorageClass('hot')).toBe(accentForStorageClass('hot'));
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/platform/infrastructure.test.ts`
Expected: FAIL — `accentForStorageClass` and `toStorageView` are not exported.

- [ ] **Step 3: Narrow the three types in `src/lib/platform/types.ts`**

Replace the fields listed under **Interfaces** above. Delete `formatted`, `accent` and
`percentage` from `StorageClass`; delete `formatted`, `changeFormatted` and
`comparedToLabel` from `ResourceUsage`; rename `storageFormatted` to `storageBytes`.

- [ ] **Step 4: Add the presentation to `src/lib/platform/infrastructure.ts`**

```ts
/** The tint each storage class is drawn in. Presentation, so it lives above the port. */
const STORAGE_ACCENTS: DomainAccent[] = ['violet', 'sky', 'emerald', 'amber', 'rose'];

export function accentForStorageClass(id: string): DomainAccent {
	// Hashed rather than positional, so adding a class does not recolour the others.
	return STORAGE_ACCENTS[hashSeed(id) % STORAGE_ACCENTS.length];
}

export function toStorageView(storage: { totalBytes: number; classes: StorageClass[] }) {
	return {
		totalBytes: storage.totalBytes,
		totalFormatted: formatBytes(storage.totalBytes),
		classes: storage.classes.map((one) => ({
			...one,
			formatted: formatBytes(one.bytes),
			accent: accentForStorageClass(one.id),
			percentage: storage.totalBytes === 0 ? 0 : (one.bytes / storage.totalBytes) * 100
		}))
	};
}
```

- [ ] **Step 5: Run the test, expect PASS**

Run: `bun test src/lib/platform/infrastructure.test.ts`

- [ ] **Step 6: Update the fixture and the assembler**

`infrastructure-fixtures.ts` stops emitting `accent`/`formatted` and emits `bytes`.
`infrastructure-view.ts` calls `toStorageView` and the equivalent for utilization and cost.
The UI components are unchanged: they still receive the same rendered shape, now derived one
layer up.

- [ ] **Step 7: Fix the DTO, which stops reconstructing**

```ts
export function toStorageDto(storage: { totalBytes: number; classes: StorageClass[] }): StorageDto {
	return {
		totalBytes: storage.totalBytes,
		// The bytes are carried now, so nothing is recovered from a rounded share.
		classes: storage.classes.map((one) => ({ id: one.id, label: one.label, bytes: one.bytes }))
	};
}
```

Also drop the `usage.unit === '%' ? 'percent' : 'bits_per_second'` sniff in
`toResourceUsageDto` — `unit` is now a stated fact.

- [ ] **Step 8: Add a DTO test proving the round trip is exact**

```ts
test('published bytes are the bytes, not a share multiplied back out', () => {
	const dto = toStorageDto({
		totalBytes: 3,
		classes: [
			{ id: 'a', label: 'A', bytes: 1 },
			{ id: 'b', label: 'B', bytes: 2 }
		]
	});

	// A third of three is 33%, and 33% of three is not one. The old shape could not
	// represent this at all.
	expect(dto.classes.map((one) => one.bytes)).toEqual([1, 2]);
});
```

- [ ] **Step 9: Run the gate and commit**

```bash
bun run check && bun run lint && bun test
git add -A
git commit -m "refactor: narrow CloudProvider to facts, so an adapter need not invent tints"
```

---

### Task 2: The floci-az harness and the cost mock

**Files:**

- Modify: `docker-compose.yml`
- Create: `sources.local.json`
- Modify: `scripts/mocks.ts`
- Create: `src/lib/server/sources/providers/azure/mock/cost.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `startCostMock({ port?, apiKey? })` returning `{ url, port, stop() }`, matching
  the shape `startOctopusMock` and `startCoralogixMock` already return.

- [ ] **Step 1: Add the service to `docker-compose.yml`**

```yaml
# A local Azure: ARM, Monitor and Entra, so @azure/identity authenticates against it
# and the provider talks to it exactly as it would to Azure. Only the endpoint differs.
floci-az:
  image: ghcr.io/floci-io/floci-az:latest
  ports:
    - '4577:4577'
  healthcheck:
    test: ['CMD-SHELL', 'wget -qO- http://localhost:4577/health || exit 1']
    interval: 5s
    timeout: 3s
    retries: 10
```

- [ ] **Step 2: Write the failing test for the cost mock**

```ts
// src/lib/server/sources/providers/azure/mock/cost.test.ts
import { expect, test } from 'bun:test';
import { startCostMock } from './cost';

test('answers a Cost Management query with daily rows', async () => {
	// floci-az does not emulate Cost Management, so this is the one Azure surface that
	// needs a mock of our own. Without it five of the nine capabilities are untestable.
	const mock = startCostMock({ apiKey: 'k' });

	try {
		const response = await fetch(`${mock.url}/providers/Microsoft.CostManagement/query`, {
			method: 'POST',
			headers: { authorization: 'Bearer k', 'content-type': 'application/json' },
			body: JSON.stringify({ type: 'Usage', timeframe: 'MonthToDate' })
		});

		expect(response.status).toBe(200);
		const body = (await response.json()) as { properties: { rows: unknown[] } };
		expect(body.properties.rows.length).toBeGreaterThan(0);
	} finally {
		mock.stop();
	}
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `bun test src/lib/server/sources/providers/azure/mock/cost.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the mock**

Serve `POST /providers/Microsoft.CostManagement/query` returning the real response shape —
`{ properties: { columns: [...], rows: [[cost, date, service], ...] } }` — from a seeded
estate, using `seededRandom`/`hashSeed` like every other fixture, so the numbers do not move
between restarts.

- [ ] **Step 5: Run the test, expect PASS**

- [ ] **Step 6: Start it from `scripts/mocks.ts`**

Add it beside the other two on port `4593`, and print its URL in the banner.

- [ ] **Step 7: Write `sources.local.json`**

```jsonc
{
	"connections": [
		{
			"id": "azure-local",
			"provider": "azure",
			"label": "Azure (floci-az)",
			"settings": {
				"baseUrl": "http://localhost:4577",
				"costBaseUrl": "http://localhost:4593",
				"subscriptionId": "00000000-0000-0000-0000-000000000000",
				"tenantId": "00000000-0000-0000-0000-000000000000",
				"clientId": "local",
				"clientSecret": { "$env": "AZURE_LOCAL_SECRET" }
			}
		}
		// No fixture-cloud here: loadConnections refuses a fixture beside a real source,
		// because the aggregate rule would merge invented regions into real ones.
	]
}
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: a local Azure to develop against, and the cost mock floci-az lacks"
```

---

### Task 3: The Azure client

**Files:**

- Create: `src/lib/server/sources/providers/azure/client.ts`
- Test: `src/lib/server/sources/providers/azure/client.test.ts`

**Interfaces:**

- Produces:

```ts
export class AzureClient {
	constructor(options: {
		baseUrl: string;
		costBaseUrl: string;
		subscriptionId: string;
		credential: TokenCredential;
	});
	/** One ARM GET, with the subscription path prefixed and the token attached. */
	get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T>;
	/** Every page of a `value[]`/`nextLink` collection, bounded by `limit`. */
	collect<T>(path: string, options: { limit: number }): Promise<T[]>;
	/** A Monitor metrics query, returning timeseries in the order requested. */
	metrics(
		resourceId: string,
		names: string[],
		window: { from: Date; to: Date; stepSeconds: number }
	): Promise<MetricSeries[]>;
	readonly portalBase: string;
}
```

- [ ] **Step 1: Write the failing test for paging**

```ts
test('follows nextLink until the limit, then stops', async () => {
	// ARM pages with an absolute nextLink rather than a skip parameter, so a client that
	// assumed offsets would silently read page one forever.
	let served = 0;
	const server = Bun.serve({
		port: 0,
		fetch: (request) => {
			served++;
			const page = Number(new URL(request.url).searchParams.get('page') ?? 1);
			return Response.json({
				value: [{ id: `r${page}` }],
				nextLink: page < 5 ? `${new URL(request.url).origin}/x?page=${page + 1}` : undefined
			});
		}
	});

	try {
		const client = new AzureClient({
			baseUrl: `http://localhost:${server.port}`,
			costBaseUrl: `http://localhost:${server.port}`,
			subscriptionId: 'sub',
			credential: { getToken: async () => ({ token: 't', expiresOnTimestamp: Date.now() + 1e6 }) }
		});

		expect(await client.collect<{ id: string }>('/x', { limit: 3 })).toHaveLength(3);
		// Bounded: it must not walk all five pages to return three rows.
		expect(served).toBeLessThan(5);
	} finally {
		server.stop(true);
	}
});
```

- [ ] **Step 2: Run it and watch it fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `AzureClient`**

`fetch`, not an SDK client, per the API selection order — the only Azure dependency is
`@azure/identity` for the token, which is the security-sensitive part worth a dependency.
Cache the token until `expiresOnTimestamp`; attach `Authorization: Bearer`. A non-2xx
response throws with the status and the ARM `error.code`, never the body verbatim.

- [ ] **Step 4: Run the test, expect PASS**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat: an Azure REST client that pages the way ARM actually pages"
```

---

### Task 4: Mapping and the first four capabilities

Regions, node counts, clusters and alerts — the inventory reads, all `reference` tier
except alerts.

**Files:**

- Create: `src/lib/server/sources/providers/azure/map.ts`
- Create: `src/lib/server/sources/providers/azure/index.ts`
- Test: `src/lib/server/sources/providers/azure/map.test.ts`, `provider.test.ts`

**Interfaces:**

- Consumes: `AzureClient` from Task 3, the narrowed types from Task 1.
- Produces: `azureProvider`, exported from `providers/index.ts` in `REAL_PROVIDERS`.

- [ ] **Step 1: Write the failing mapping test**

```ts
test('an ARM location becomes a region with coordinates, because the map needs them', () => {
	// ARM gives a location name, not a latitude. The map draws points, so the provider
	// resolves the name to coordinates rather than leaving the UI to guess.
	const region = toRegion(
		{ name: 'westeurope', displayName: 'West Europe' },
		{ healthy: 4, warning: 1, down: 0 }
	);

	expect(region.name).toBe('West Europe');
	expect(region.nodeCount).toBe(5);
	expect(Number.isFinite(region.latitude)).toBe(true);
	expect(Number.isFinite(region.longitude)).toBe(true);
});
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement `map.ts`**

A static `AZURE_REGION_COORDS` table keyed by ARM location name. A location not in the
table is skipped rather than placed at 0,0 in the Gulf of Guinea — `world.ts` already
asserts the open ocean is not land, and a region drawn there is a visible lie.

- [ ] **Step 4: Implement the provider with four capabilities**

```ts
export const azureProvider = defineProvider<CloudProvider>({
	id: 'azure',
	kind: 'cloud',
	name: 'Microsoft Azure',
	icon: 'cloud',
	// Four now. The rest are added in Task 5, and until then they are stated gaps
	// rather than zeros — capability-gaps.test.ts already proves a partial cloud
	// provider costs the reader those panels and not the dashboard.
	capabilities: ['cloud.regions', 'cloud.nodes', 'cloud.clusters', 'cloud.alerts'],
	settings: azureSettings,
	connect: (raw) => {
		/* v.parse, not a cast — see the Coralogix note */
	}
});
```

- [ ] **Step 5: Run the provider test against floci-az, expect PASS**

- [ ] **Step 6: Register it and commit**

Add to `REAL_PROVIDERS`. Commit.

---

### Task 5: The remaining five capabilities

Utilization, storage, databases, queues, cost.

**Files:**

- Modify: `src/lib/server/sources/providers/azure/index.ts`, `map.ts`
- Modify: `src/lib/server/sources/tiers.ts` — no change expected; assert it
- Test: `provider.test.ts`

- [ ] **Step 1: Write the failing test for utilization units**

```ts
test('utilization states the unit its headline is in, not the series unit', () => {
	// The network tile reads "1.2 Gbps" while its series carries bits per second. The DTO
	// publishes the base unit, so pairing the two would label 1,200,000,000 as gigabits.
	const usage = toUsage(monitorResponse, 'network');

	expect(usage.unit).toBe('bps');
	expect(usage.value).toBeGreaterThan(1_000_000);
});
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement the five reads**

Cost goes to `costBaseUrl`, which is the mock locally and Cost Management in production.
Storage returns `bytes` per class — never a formatted string, per Task 1.

- [ ] **Step 4: Run the tests, expect PASS**

- [ ] **Step 5: Assert the full capability set**

```ts
test('declares all nine, so nothing on the infrastructure page is a gap', () => {
	expect(azureProvider.capabilities.size).toBe(9);
});
```

- [ ] **Step 6: Commit**

---

### Task 6: Deep links, and the budgets

**Files:**

- Modify: `src/lib/server/sources/providers/azure/index.ts`
- Modify: `src/lib/server/platform/request-budget.test.ts`, `warm-budget.test.ts`
- Test: `provider.test.ts`

- [ ] **Step 1: Write the failing deep-link test**

```ts
test('a resource links to its blade in the portal', () => {
	const link = azureProvider.connect(settings).resourceLink(
		{
			kind: 'cloud',
			connectionId: 'azure-local',
			externalId:
				'/subscriptions/s/resourceGroups/g/providers/Microsoft.Compute/virtualMachines/vm1'
		},
		'metrics'
	);

	expect(link?.href).toContain('portal.azure.com');
	// The portal addresses a resource by its full ARM id, so the id travels whole.
	expect(link?.href).toContain('Microsoft.Compute');
});
```

- [ ] **Step 2: Run it and watch it fail**

- [ ] **Step 3: Implement `resourceLink`**

`https://portal.azure.com/#@{tenantId}/resource{armId}/{view}`. Return `null` without a
binding, as Octopus does.

- [ ] **Step 4: Extend the budgets to the cloud kind**

The infrastructure screen measures 0 requests today because the fixture is in-process. With
a real adapter it costs something, and nobody knows what. Add cold and warm figures for it
the way the other screens have them, measured against floci-az rather than estimated.

- [ ] **Step 5: Run the gate and commit**

```bash
bun run check && bun run lint && bun test
git commit -am "feat: portal deep links, and what the infrastructure screen costs"
```

---

## Self-review

**Spec coverage.** Increment 4 is Task 2 (harness plus the cost mock the spec names as the
honest gap). Increment 5 is Tasks 3–6. The switching model needs no task: it is the
connections file, already built, and its guard shipped with the spec.

**The one addition.** Task 1 is not in the spec. It is a prerequisite discovered while
writing this plan: `CloudProvider` currently requires an adapter to emit `accent` and
formatted strings, and the public API already reconstructs bytes from a rounded percentage
because of it. Every later task would either inherit that or work around it.

**Type consistency.** `StorageClass.bytes`, `ResourceUsage.value`/`unit` and
`DatabaseInstance.storageBytes` are introduced in Task 1 and used unchanged in Tasks 4–5.
`AzureClient` is defined in Task 3 and consumed in 4–6 with the same signature.

**Out of scope.** Increment 6 (catalog bindings, `/api/v1/sources`), and a second cloud
provider.
