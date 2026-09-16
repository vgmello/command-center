# Domain Infrastructure Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the domain detail screen's Infrastructure placeholder with six domain-scoped panels over the existing cloud capabilities, where a domain owns a cloud resource by the tag `domain=<slug>`.

**Architecture:** One new concept — ownership by tag — recorded as the domain's `cloud` binding in the catalog. `InfrastructureSource` methods gain an optional `owner`; the router resolves the declared binding via the `CatalogSource` and dispatches through a new cached `routeOne` helper wrapping `dispatcher.one()`; providers honour `ctx.binding` inside their existing methods with a client-side tag check. No new capabilities. Gaps are stated through a single pure `gapSentence` used by both the page and the 501 body.

**Tech Stack:** SvelteKit 2 remote functions, Svelte 5 runes, Valibot, Bun test, floci-az (Azure emulator), existing Cost/Monitor mocks.

**Spec:** `docs/superpowers/specs/2026-09-16-domain-infrastructure-tab-design.md` — reviewed in seven rounds; read its Router, Gap presentation, Providers, and "Two worlds" sections before any task.

## Global Constraints

- **Svelte 5 runes only.** `$props`, `$state`, `$derived`, `onclick`. No `export let`, `$:`, `on:click`.
- **Valibot namespaced:** `import * as v from 'valibot'`. Never Zod.
- **`bun test`**, not Vitest/Jest. `bun test` cannot render `.svelte`; anything that must be asserted lives in a pure module.
- **A capability nobody implements is stated, never faked.** Router throws `CapabilityUnavailableError`; `panel()` renders it; never `[]`/`0` for a gap.
- **The tag key is the Azure setting `ownerTagKey`, default `domain`; the value is the domain's catalog slug.** Key compared case-insensitively, value case-sensitively, in ONE helper `ownsResource(tags, key, value)`.
- **Binding is DECLARED only.** The router reads `record.bindings.find(b => b.kind === 'cloud')`. It NEVER calls `bindingFor()` for cloud — its fallback would make all 25 fixture domains look bound.
- **`routeOne` resolves `connectionId: ''`** via `registry.supporting(capability)`: exactly one → use it; zero → `'no-capability'` if connections of the kind exist else `'no-connection'`; two or more → `'ambiguous-connection'`. Then wraps `dispatcher.one()` in `deps.cache.read` keyed `{ connectionId: <resolved id>, capability, args: scopedArgs(scope, 'owner=<slug>'), ttlSeconds: ttlFor(deps, capability) }`. `dispatcher.one()` itself is unchanged.
- **No tag `$filter` is sent on ARM list requests.** The client-side check is the mechanism on every stack. Server-side narrowing via `/resources?$filter=tag…` is a `docs/todo` ceiling, not a claim.
- **`GapReason` gains `'ambiguous-connection'`.** No 501 schema is documented (standing todo `api-501-undocumented.md`); the OpenAPI exact-set test is NOT touched.
- **Estate figures never move.** `readNodeCounts()` with no owner returns today's constant `{42,4,2}`; owner reads are DERIVED from owned regions. The seed tags VMs, AKS and storage by their resource GROUP's owner, databases by their own name.
- **Gap collapse rule:** all SEVEN reads `unavailable` with reason `'no-binding'` → snapshot `unbound: true`, page renders one sentence once; any other mix → per-panel `PanelGap`.
- **Ownership lives in ONE module** `src/lib/platform/ownership.ts`: role-keyed domain assignments + two name maps (fixture, seed). Fixtures bind six domains (`payment`, `order`, `user`, `inventory`, `notification`, `analytics`), the seed five (no ClickHouse). Clusters inherit their region's owner. `tax-domain` is bound in neither world.
- **Publish measurements.** `InfraSummary.storageBytes: number | null`; `clusters`/`databases` are `{ count, atLimit } | null` (null when that panel is a gap — a dash, never 0); `100+` is rendered only in `toInfraSummaryView`.
- **API:** seven per-resource paths `/api/v1/domains/{slug}/infrastructure/{regions,nodes,clusters,databases,utilization,storage,cost}` reusing `toRegionDto`, `toNodeCountsDto`, `toClusterDto`, `toDatabaseDto`, `toResourceUsageDto`, `toStorageDto`, `toCostDto`; the 501 body's free-text `message` changes from "…implements…" to the page's "…provides…" wording on every gap-capable route — intentional and pinned by a test, not a schema change; 404 unknown slug; 501 via `requirePanel`. The composite is never published.
- Every number written into docs or test comments is MEASURED in that task, with the command in the report.
- Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Jgha5PbXCX8KuAgLNTKpEW`.

---

## File Structure

| File                                                                                                                                                                                                                   | Responsibility                                                                                                            | Task |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---- |
| `src/lib/platform/ownership.ts` (+test)                                                                                                                                                                                | **new** — role-keyed assignments, fixture/seed name maps, `ownsResource`, `fixtureOwnerOf`, `seedTagsFor`, `boundDomains` | 1    |
| `src/lib/platform/sources.ts`                                                                                                                                                                                          | `GapReason` + `'ambiguous-connection'`                                                                                    | 2    |
| `src/lib/platform/gaps.ts` (+test)                                                                                                                                                                                     | **new** — `gapSentence(reason, kind, noun)`, `collapseUnbound(panels)`                                                    | 2    |
| `src/lib/components/PanelGap.svelte`                                                                                                                                                                                   | call `gapSentence` with `panel.reason`                                                                                    | 2    |
| `src/lib/server/api/error-response.ts`                                                                                                                                                                                 | 501 `message` from `gapSentence`                                                                                          | 2    |
| `src/lib/server/catalog/fixture-source.ts`                                                                                                                                                                             | domains' `bindings` from `ownership.ts`                                                                                   | 3    |
| `src/lib/server/sources/routers/shared.ts`                                                                                                                                                                             | **new** `routeOne`                                                                                                        | 4    |
| `src/lib/server/sources/routers/dispatch-tiers.test.ts`                                                                                                                                                                | `routeOne` in `Helper` + regex + `ALLOWED`                                                                                | 4    |
| `src/lib/server/platform/source.ts`                                                                                                                                                                                    | `owner?` on seven `InfrastructureSource` methods (+ queues/alerts)                                                        | 6    |
| `src/lib/server/sources/routers/infrastructure.ts`, `index.ts`, `boot.test.ts`, `infrastructure.test.ts`                                                                                                               | `CatalogSource` dep, owner path; both one-arg `createInfrastructureRouter(deps)` call sites updated                       | 6    |
| `src/lib/server/platform/infrastructure-fixtures.ts`, `sources/fixtures/cloud.ts`                                                                                                                                      | owner filtering via ownership table; per-(domain, class) storage                                                          | 5    |
| `src/lib/server/sources/providers/azure/{map,client,index}.ts`                                                                                                                                                         | `ArmResource.tags`, `ownerTagKey`, owner-keyed memo, `ownsResource` filter, cost `filter.tags`                            | 7    |
| `src/lib/server/sources/providers/azure/mock/cost.ts`                                                                                                                                                                  | domain axis, async body-parsing handler                                                                                   | 8    |
| `scripts/seed-azure.ts`                                                                                                                                                                                                | `tags` on every PUT body                                                                                                  | 9    |
| `src/lib/server/platform/service.ts`                                                                                                                                                                                   | seven readers gain `owner?`; `readDomainInfrastructure`                                                                   | 10   |
| `src/lib/server/platform/domain-infrastructure-view.ts` (+test)                                                                                                                                                        | **new** assembler; `InfraSummary`, `toInfraSummaryView` in `platform/infrastructure.ts`                                   | 10   |
| `src/routes/domains.remote.ts`, `src/routes/domains/[slug]/infrastructure/+page.svelte`, `src/lib/components/domains/DomainInfra*.svelte`, `[tab]/+page.ts`, `e2e/harness.ts`, `capability-gaps.test.ts`, budget tests | the tab                                                                                                                   | 11   |
| `src/routes/api/v1/domains/[slug]/infrastructure/*/+server.ts` (7)                                                                                                                                                     | the API                                                                                                                   | 12   |
| `CLAUDE.md`, spec, `docs/todo/*`                                                                                                                                                                                       | docs                                                                                                                      | 13   |

---

### Task 1: The ownership module

**Files:**

- Create: `src/lib/platform/ownership.ts`
- Create: `src/lib/platform/ownership.test.ts`

**Interfaces — Produces:**

```ts
export const OWNER_TAG_KEY = 'domain';
export type OwnershipRole =
	| 'region-1'
	| 'region-2'
	| 'region-3'
	| 'region-4'
	| 'region-5'
	| 'db-payments'
	| 'db-orders'
	| 'db-users'
	| 'db-inventory'
	| 'db-analytics';
export const ASSIGNMENTS: Record<OwnershipRole, string>; // role → domain slug
export const FIXTURE_NAMES: Record<OwnershipRole, string[]>; // role → fixture names (regions, clusters, dbs)
export const SEED_NAMES: Record<OwnershipRole, string[]>; // role → seed group or resource names
export function ownsResource(
	tags: Record<string, string> | undefined,
	key: string,
	value: string
): boolean;
export function fixtureOwnerOf(name: string): string | null; // fixture region/cluster/db name → slug
export function seedOwnerOf(groupOrResource: string): string | null; // seed name → slug
export function boundDomains(world: 'fixture' | 'seed'): string[]; // distinct slugs
export const FIXTURE_STORAGE_BYTES: Record<string, Record<'block' | 'object' | 'file', number>>; // slug → class → bytes
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';
import {
	ASSIGNMENTS,
	FIXTURE_STORAGE_BYTES,
	boundDomains,
	fixtureOwnerOf,
	ownsResource,
	seedOwnerOf
} from './ownership';

describe('ownsResource', () => {
	test("key is case-insensitive, value is case-sensitive — ARM's own rule", () => {
		expect(ownsResource({ Domain: 'payment-domain' }, 'domain', 'payment-domain')).toBe(true);
		expect(ownsResource({ domain: 'Payment-Domain' }, 'domain', 'payment-domain')).toBe(false);
	});
	test('a missing tag never matches', () => {
		expect(ownsResource(undefined, 'domain', 'payment-domain')).toBe(false);
		expect(ownsResource({}, 'domain', 'payment-domain')).toBe(false);
	});
});

describe('two worlds, one assignment', () => {
	test('fixture and seed names resolve to the same domain for the same role', () => {
		expect(fixtureOwnerOf('eu-west-1')).toBe(ASSIGNMENTS['region-1']);
		expect(seedOwnerOf('cc-westeurope')).toBe(ASSIGNMENTS['region-1']);
		expect(fixtureOwnerOf('payment-db')).toBe('payment-domain');
		expect(seedOwnerOf('cc-payments')).toBe('payment-domain');
	});
	test('clusters inherit their region', () => {
		expect(fixtureOwnerOf('prod-eu-west-1-a')).toBe(fixtureOwnerOf('eu-west-1'));
		expect(fixtureOwnerOf('prod-eu-west-1-b')).toBe(fixtureOwnerOf('eu-west-1'));
		expect(seedOwnerOf('cc-westeurope-aks')).toBe(seedOwnerOf('cc-westeurope'));
	});
	test('fixtures bind six domains, the seed five', () => {
		expect(boundDomains('fixture').sort()).toEqual([
			'analytics-domain',
			'inventory-domain',
			'notification-domain',
			'order-domain',
			'payment-domain',
			'user-domain'
		]);
		expect(boundDomains('seed')).toHaveLength(5);
		expect(boundDomains('seed')).not.toContain('analytics-domain');
	});
	test('tax-domain is bound in neither world', () => {
		expect(boundDomains('fixture')).not.toContain('tax-domain');
		expect(boundDomains('seed')).not.toContain('tax-domain');
	});
	test('an unknown name belongs to nobody', () => {
		expect(fixtureOwnerOf('nope')).toBeNull();
		expect(seedOwnerOf('nope')).toBeNull();
	});
	test("per-domain storage sums to the estate's three classes", () => {
		// infrastructure-fixtures.ts readStorage(): block 5.1 TiB, object 4.8 TiB, file 2.5 TiB.
		const TIB = 1024 ** 4;
		const sum = (cls: 'block' | 'object' | 'file') =>
			Object.values(FIXTURE_STORAGE_BYTES).reduce((t, d) => t + d[cls], 0);
		expect(sum('block')).toBeCloseTo(5.1 * TIB, -6);
		expect(sum('object')).toBeCloseTo(4.8 * TIB, -6);
		expect(sum('file')).toBeCloseTo(2.5 * TIB, -6);
	});
});
```

- [ ] **Step 2: Run to verify it fails** — `bun test src/lib/platform/ownership.test.ts` → cannot resolve `./ownership`.

- [ ] **Step 3: Implement**

```ts
/**
 * Who owns what, stated once.
 *
 * Two stands-in describe this estate and they name nothing alike: the fixture world says
 * `eu-west-1` and `payment-db`, the floci-az seed says `westeurope` and `cc-payments`. Left to
 * two tables they would disagree about which domain a resource belongs to — so the DOMAIN each
 * role belongs to lives here once, and each world attaches its names to the role.
 *
 * Clusters have no role of their own: a cluster lives in a region and inherits its owner.
 */
export const OWNER_TAG_KEY = 'domain';

export type OwnershipRole =
	| 'region-1'
	| 'region-2'
	| 'region-3'
	| 'region-4'
	| 'region-5'
	| 'db-payments'
	| 'db-orders'
	| 'db-users'
	| 'db-inventory'
	| 'db-analytics';

export const ASSIGNMENTS: Record<OwnershipRole, string> = {
	'region-1': 'payment-domain',
	'region-2': 'order-domain',
	'region-3': 'user-domain',
	'region-4': 'inventory-domain',
	'region-5': 'notification-domain',
	'db-payments': 'payment-domain',
	'db-orders': 'order-domain',
	'db-users': 'user-domain',
	'db-inventory': 'inventory-domain',
	// ClickHouse exists only in the fixture world; the seed has no row for this role.
	'db-analytics': 'analytics-domain'
};

/** Fixture names per role: the region, its clusters, and (for db roles) the database. */
export const FIXTURE_NAMES: Record<OwnershipRole, string[]> = {
	'region-1': ['eu-west-1', 'prod-eu-west-1-a', 'prod-eu-west-1-b'],
	'region-2': ['eu-central-1', 'prod-eu-central-1-a'],
	'region-3': ['us-east-1', 'prod-us-east-1-a'],
	'region-4': ['us-west-2', 'prod-us-west-2-a'],
	'region-5': ['ap-southeast-1', 'prod-ap-southeast-1-a'],
	'db-payments': ['payment-db'],
	'db-orders': ['order-db'],
	'db-users': ['user-db'],
	'db-inventory': ['inventory-db'],
	'db-analytics': ['analytics-db']
};

/**
 * Seed names per role: the resource GROUP and its AKS; db roles name the server.
 *
 * Storage accounts are deliberately absent: the seed names them `ccst${location.slice(0, 12)}`,
 * which truncates `southeastasia` to `southeastasi` — a name nobody should have to spell here.
 * The seed tags VMs, AKS and storage by their GROUP's owner (`seedOwnerOf(group)`), so only the
 * group needs a row; databases are tagged by their own name because they override the group.
 */
export const SEED_NAMES: Record<OwnershipRole, string[]> = {
	'region-1': ['cc-westeurope', 'cc-westeurope-aks'],
	'region-2': ['cc-northeurope', 'cc-northeurope-aks'],
	'region-3': ['cc-eastus', 'cc-eastus-aks'],
	'region-4': ['cc-westus2', 'cc-westus2-aks'],
	'region-5': ['cc-southeastasia', 'cc-southeastasia-aks'],
	'db-payments': ['cc-payments'],
	'db-orders': ['cc-orders'],
	'db-users': ['cc-users'],
	'db-inventory': ['cc-inventory'],
	'db-analytics': []
};

/**
 * ARM's tag-matching rule: names are case-insensitive, values are not.
 * Both the provider filter and its test go through this, so they cannot disagree.
 */
export function ownsResource(
	tags: Record<string, string> | undefined,
	key: string,
	value: string
): boolean {
	if (!tags) return false;
	const wanted = key.toLowerCase();
	for (const [name, tagValue] of Object.entries(tags)) {
		if (name.toLowerCase() === wanted) return tagValue === value;
	}
	return false;
}

function ownerIn(names: Record<OwnershipRole, string[]>, name: string): string | null {
	for (const role of Object.keys(names) as OwnershipRole[]) {
		if (names[role].includes(name)) return ASSIGNMENTS[role];
	}
	return null;
}

export function fixtureOwnerOf(name: string): string | null {
	return ownerIn(FIXTURE_NAMES, name);
}

export function seedOwnerOf(groupOrResource: string): string | null {
	return ownerIn(SEED_NAMES, groupOrResource);
}

export function boundDomains(world: 'fixture' | 'seed'): string[] {
	const names = world === 'fixture' ? FIXTURE_NAMES : SEED_NAMES;
	const slugs = (Object.keys(names) as OwnershipRole[])
		.filter((role) => names[role].length > 0)
		.map((role) => ASSIGNMENTS[role]);
	return [...new Set(slugs)];
}

const TIB = 1024 ** 4;

/**
 * The fixture estate's three storage classes split across the bound domains.
 *
 * Classes are types, not resources, so a domain's storage is a share of each class. The
 * per-class sums equal `readStorage()`'s 5.1 / 4.8 / 2.5 TiB — one fixture derives from the
 * other, so the estate donut and a domain's cell cannot tell two stories.
 */
export const FIXTURE_STORAGE_BYTES: Record<string, Record<'block' | 'object' | 'file', number>> = {
	'payment-domain': { block: 2.0 * TIB, object: 1.2 * TIB, file: 0.5 * TIB },
	'order-domain': { block: 1.1 * TIB, object: 1.0 * TIB, file: 0.6 * TIB },
	'user-domain': { block: 0.9 * TIB, object: 1.4 * TIB, file: 0.4 * TIB },
	'inventory-domain': { block: 0.6 * TIB, object: 0.7 * TIB, file: 0.5 * TIB },
	'notification-domain': { block: 0.3 * TIB, object: 0.3 * TIB, file: 0.3 * TIB },
	'analytics-domain': { block: 0.2 * TIB, object: 0.2 * TIB, file: 0.2 * TIB }
};
```

- [ ] **Step 4: Run** — `bun test src/lib/platform/ownership.test.ts` → all pass. Storage sums: block 5.1, object 4.8, file 2.5 ✓ (check the arithmetic; adjust shares, never the totals).

- [ ] **Step 5: Commit** — `feat: state cloud ownership once, for both worlds`

---

### Task 2: Gap presentation — `GapReason`, `gapSentence`, `collapseUnbound`, PanelGap, 501

**Files:**

- Modify: `src/lib/platform/sources.ts` (GapReason at ~:78 and its docstring ~:72-77)
- Create: `src/lib/platform/gaps.ts`, `src/lib/platform/gaps.test.ts`
- Modify: `src/lib/components/PanelGap.svelte` (the `unavailable` branch, :34-37)
- Modify: `src/lib/server/api/error-response.ts` (:51 message)
- Test: `src/lib/server/api/respond.test.ts` (or `error-response.test.ts` if that is where 501 is tested)

**Interfaces — Produces:**

```ts
export type GapReason =
	'no-connection' | 'no-binding' | 'no-capability' | 'not-implemented' | 'ambiguous-connection';
export function gapSentence(reason: GapReason, kind: SourceKind, noun: string): string;
export function collapseUnbound(panels: ReadonlyArray<Panel<unknown>>): boolean;
```

- [ ] **Step 1: Failing tests** (`gaps.test.ts`)

```ts
import { describe, expect, test } from 'bun:test';
import { collapseUnbound, gapSentence } from './gaps';
import type { Panel } from './sources';

import type { GapReason, SourceRef } from './sources';
// Check `SourceRef`'s exact fields in src/lib/platform/sources.ts:60-70 first; the literal must satisfy the type without a cast.
\1\n\tconnectionId: 'x',
	name: 'x',
	providerId: 'x',
	kind: 'cloud',
	icon: 'cloud',
	link: null
};
const gap = (reason: GapReason): Panel<unknown> => ({
	status: 'unavailable',
	capability: 'cloud.nodes',
	kind: 'cloud',
	reason
});
const ok: Panel<unknown> = { status: 'ok', data: 1, source };

describe('gapSentence', () => {
	test("the three existing reasons keep today's wording", () => {
		for (const r of ['no-connection', 'no-capability', 'not-implemented'] as const) {
			expect(gapSentence(r, 'cloud', 'regions')).toBe(
				'No connected cloud source provides regions.'
			);
		}
	});
	test('an unbound domain is not "no connected source" — the cloud is connected', () => {
		expect(gapSentence('no-binding', 'cloud', 'regions')).toBe(
			'Not bound to a cloud — no resources are tagged for this domain.'
		);
	});
	test('several connections need a named binding', () => {
		expect(gapSentence('ambiguous-connection', 'cloud', 'regions')).toBe(
			"Several cloud connections are configured; this domain's binding must name one."
		);
	});
	test('APM reads as "APM", matching the component\'s existing label table', () => {
		expect(gapSentence('no-connection', 'apm', 'incidents')).toBe(
			'No connected APM source provides incidents.'
		);
	});
});

describe('collapseUnbound', () => {
	test('seven no-binding gaps collapse', () => {
		expect(collapseUnbound(Array(7).fill(gap('no-binding')))).toBe(true);
	});
	test('six ok and one capability gap do not', () => {
		expect(collapseUnbound([...Array(6).fill(ok), gap('no-capability')])).toBe(false);
	});
	test('mixed reasons never collapse', () => {
		expect(collapseUnbound([...Array(6).fill(gap('no-binding')), gap('no-capability')])).toBe(
			false
		);
	});
	test('an empty list is not unbound', () => {
		expect(collapseUnbound([])).toBe(false);
	});
});
```

- [ ] **Step 2: Run → fails** (module missing; `'ambiguous-connection'` not in the union).

- [ ] **Step 3: Widen `GapReason`** in `src/lib/platform/sources.ts`:

```ts
/**
 * Why a panel has no data.
 *
 * Five distinct causes, because the remedies differ: connect a source, bind the resource,
 * name which of several connections the binding means, pick a provider that implements it,
 * or nothing — it is simply absent.
 */
export type GapReason =
	'no-connection' | 'no-binding' | 'no-capability' | 'not-implemented' | 'ambiguous-connection';
```

- [ ] **Step 4: Create `gaps.ts`**

```ts
import type { GapReason, Panel, SourceKind } from './sources';

/** The label each kind prints as — moved here from PanelGap so the page and the API share it. */
const KIND_LABEL: Record<SourceKind, string> = {
	cloud: 'cloud',
	apm: 'APM',
	deployment: 'deployment'
};

/**
 * The one sentence a gap produces, for the page and for the 501 body alike.
 *
 * Pure so `bun test` can assert it — the component that prints it cannot be rendered by the
 * test runner. "No connected source" is FALSE for an unbound domain (its cloud is connected
 * and answering) and for an ambiguous binding, which is why those two reasons have their own
 * sentences and the rest keep the wording every panel has printed until now.
 */
export function gapSentence(reason: GapReason, kind: SourceKind, noun: string): string {
	switch (reason) {
		case 'no-binding':
			// Key-agnostic on purpose: `ownerTagKey` is a provider setting, and a sentence naming it
			// would be wrong the moment someone changes it.
			return `Not bound to a ${KIND_LABEL[kind]} — no resources are tagged for this domain.`;
		case 'ambiguous-connection':
			return `Several ${KIND_LABEL[kind]} connections are configured; this domain's binding must name one.`;
		default:
			return `No connected ${KIND_LABEL[kind]} source provides ${noun}.`;
	}
}

/**
 * Whether a screen's panels are all unbound — and only then.
 *
 * Binding is per domain, so `'no-binding'` is all-or-nothing across a domain screen's reads;
 * a capability gap is not. Six identical "not bound" cards would say one thing six times, so
 * the page says it once when every panel agrees, and falls through to per-panel gaps for any
 * other mix — a bound domain missing one capability shows five panels and one stated gap.
 */
export function collapseUnbound(panels: ReadonlyArray<Panel<unknown>>): boolean {
	return (
		panels.length > 0 &&
		panels.every((panel) => panel.status === 'unavailable' && panel.reason === 'no-binding')
	);
}
```

- [ ] **Step 5: `PanelGap.svelte`** — replace the `unavailable` branch body and drop the local `KIND_LABEL` for that branch:

```svelte
<script lang="ts">
	import type { Panel, SourceKind } from '$lib/platform/sources';
	import { gapSentence } from '$lib/platform/gaps';
	/* … existing docblock … */
	let { panel, noun, class: className = '' }: { panel: Panel<unknown>; noun: string; class?: string } = $props();
	// Kept for the `failed` branch, which names the source rather than the kind's noun.
	const KIND_LABEL: Record<SourceKind, string> = { cloud: 'cloud', apm: 'APM', deployment: 'deployment' };
</script>

{#if panel.status === 'unavailable'}
	<p class="text-[12px] text-muted-foreground {className}">
		{gapSentence(panel.reason, panel.kind, noun)}
	</p>
{:else if panel.status === 'failed'}
	<!-- unchanged -->
```

- [ ] **Step 6: `error-response.ts`** — the 501 message:

```ts
import { gapSentence } from '$lib/platform/gaps';
// …
				message: gapSentence(cause.reason, cause.kind, cause.capability),
```

(The estate routes pass the capability as the noun. **This changes the 501 body's free-text `message`** from "No connected cloud source implements cloud.regions." to "…provides cloud.regions." on every gap-capable route — intentional: one sentence on the page and on the wire; free text, not schema. Pin the NEW wording in the 501 test so the change is deliberate rather than silent. Keep the comment above it; add one line: "Same sentence the page prints — `gapSentence` is the single source.")

- [ ] **Step 7: Extend the 501 test** in the existing respond/error-response test: for a `CapabilityUnavailableError('cloud.regions', 'no-binding')` the body's `message` equals `gapSentence('no-binding', 'cloud', 'cloud.regions')` and `reason === 'no-binding'`.

- [ ] **Step 8: Run** — `bun test src/lib/platform/gaps.test.ts src/lib/server/api`, `bun run check`, `bun run lint` → green. Verify the sentence test bites: change the default branch's wording and watch three assertions fail; restore.

- [ ] **Step 9: Commit** — `feat: one sentence per gap reason, on the page and on the wire`

---

### Task 3: Fixture catalog declares cloud bindings

**Files:**

- Modify: `src/lib/server/catalog/fixture-source.ts:22-37` (`#domains()`)
- Test: `src/lib/server/catalog/catalog.test.ts` (append)

- [ ] **Step 1: Failing test**

```ts
import { FixtureCatalogSource } from './fixture-source';
import { boundDomains } from '$lib/platform/ownership';

describe('cloud bindings from the ownership table', () => {
	const catalog = new FixtureCatalogSource();
	test('a bound domain declares exactly one cloud binding whose externalId is its slug', async () => {
		const d = await catalog.findDomain('payment-domain');
		expect(d?.bindings.filter((b) => b.kind === 'cloud')).toEqual([
			{ kind: 'cloud', connectionId: '', externalId: 'payment-domain' }
		]);
	});
	test("the six bound domains are exactly the ownership table's", async () => {
		const all = await catalog.listDomains();
		const bound = all
			.filter((d) => d.bindings.some((b) => b.kind === 'cloud'))
			.map((d) => d.slug)
			.sort();
		expect(bound).toEqual(boundDomains('fixture').sort());
	});
	test('tax-domain declares no cloud binding', async () => {
		const d = await catalog.findDomain('tax-domain');
		expect(d?.bindings.some((b) => b.kind === 'cloud')).toBe(false);
	});
});
```

- [ ] **Step 2: Run → fails** (bindings are `[]`).

- [ ] **Step 3: Implement** — in `#domains()`:

```ts
import { boundDomains } from '$lib/platform/ownership';
// …
// A cloud binding for every domain the ownership table assigns resources to, and
// none for the rest: "unbound" has to be the common case under fixtures or the
// stated-gap path is never exercised. The externalId is the tag VALUE.
bindings: boundDomains('fixture').includes(domain.slug)
	? [{ kind: 'cloud', connectionId: '', externalId: domain.slug }]
	: [];
```

Update the comment that said "The fixture declares none" accordingly.

- [ ] **Step 4: Run** — `bun test src/lib/server/catalog` → pass. `bun test src` → the catalog schema's one-per-kind rule still holds (a test exists at `catalog/schema.ts:52`'s consumer).

- [ ] **Step 5: Commit** — `feat: the fixture catalog says which domains own cloud resources`

---

### Task 4: `routeOne` — the cached resource-scoped dispatch

**Files:**

- Modify: `src/lib/server/sources/routers/shared.ts` (add after `fanOutSingle`, ~:160)
- Modify: `src/lib/server/sources/routers/dispatch-tiers.test.ts:30-51`
- Test: `src/lib/server/sources/routers/routers.test.ts` (append, using its `build()`)

**Interfaces — Produces:**

```ts
export async function routeOne<T>(
	deps: RouterDeps,
	capability: Capability,
	scope: PlatformScope,
	binding: SourceBinding,
	args: string,
	call: (client: unknown, ctx: SourceContext) => Promise<T>
): Promise<T>;
```

- [ ] **Step 1: Failing tests** (in `routers.test.ts`; `build()` exists at :15; import `routeOne`, `CapabilityUnavailableError`, `SourceRegistry`, `createDispatcher`, `SourceCache`)

```ts
describe('routeOne', () => {
	const scope = { environment: 'production' as const, timeRange: '1h' as const };
	const binding = { kind: 'cloud' as const, connectionId: '', externalId: 'payment-domain' };
	function depsWith(connections: unknown) {
		const registry = new SourceRegistry();
		for (const p of FIXTURE_PROVIDERS) registry.register(p);
		registry.load(connections, {});
		return { registry, dispatcher: createDispatcher(registry), cache: new SourceCache() };
	}

	test('an empty connectionId resolves to the one connection of that kind', async () => {
		const deps = depsWith(FIXTURE_CONNECTIONS);
		let seen: string | undefined;
		await routeOne(deps, 'cloud.nodes', scope, binding, 'owner=payment-domain', async (_c, ctx) => {
			seen = ctx.connection.id;
			return 1;
		});
		expect(seen).toBe(deps.registry.supporting('cloud.nodes')[0].ref.id);
	});
	test('no connection of the kind → no-connection; kind present but none declaring → no-capability', async () => {
		await expect(
			routeOne(depsWith({ connections: [] }), 'cloud.nodes', scope, binding, '', async () => 1)
		).rejects.toMatchObject({ reason: 'no-connection' });
		// A cloud connection that does not declare cloud.queues... use a provider copy minus the capability,
		// the way capability-gaps.test.ts's routersWithout() builds one.
	});
	test('two connections of the kind → ambiguous-connection', async () => {
		const two = {
			connections: [
				...FIXTURE_CONNECTIONS.connections,
				{
					...FIXTURE_CONNECTIONS.connections.find(
						(c: { provider: string }) => c.provider === 'fixture-cloud'
					),
					id: 'cloud-2'
				}
			]
		};
		await expect(
			routeOne(depsWith(two), 'cloud.nodes', scope, binding, '', async () => 1)
		).rejects.toMatchObject({ reason: 'ambiguous-connection' });
	});
	test('a second read inside TTL issues no upstream call, and owners/environments key separately', async () => {
		const deps = depsWith(FIXTURE_CONNECTIONS);
		let calls = 0;
		const call = async () => {
			calls++;
			return calls;
		};
		await routeOne(deps, 'cloud.nodes', scope, binding, 'owner=payment-domain', call);
		await routeOne(deps, 'cloud.nodes', scope, binding, 'owner=payment-domain', call);
		expect(calls).toBe(1);
		await routeOne(
			deps,
			'cloud.nodes',
			scope,
			{ ...binding, externalId: 'order-domain' },
			'owner=order-domain',
			call
		);
		expect(calls).toBe(2);
		await routeOne(
			deps,
			'cloud.nodes',
			{ ...scope, environment: 'staging' },
			binding,
			'owner=payment-domain',
			call
		);
		expect(calls).toBe(3);
	});
});
```

- [ ] **Step 2: Run → fails** (`routeOne` not exported).

- [ ] **Step 3: Implement** in `shared.ts` (after `fanOutSingle`):

```ts
/**
 * A resource-scoped read: one connection, chosen by the binding, cached per owner.
 *
 * `dispatcher.one()` routes by `binding.connectionId` and looks it up in the registry — so
 * the catalog's `''` ("whichever connection of this kind answers") has to be resolved here
 * first, or every bound read would throw `no-connection`. It is also the only dispatch path
 * with no cache of its own; without this wrapper a domain tab would re-issue the full
 * upstream chain on every refresh tick.
 *
 * The owner is in `args`, and `scopedArgs` adds the environment and time range — so a
 * domain's answer can be served to neither the estate nor another domain nor another
 * environment. That is the same rule `fanOutKey` applies to the connection set, on a new axis.
 */
export async function routeOne<T>(
	deps: RouterDeps,
	capability: Capability,
	scope: PlatformScope,
	binding: SourceBinding,
	args: string,
	call: (client: unknown, ctx: SourceContext) => Promise<T>
): Promise<T> {
	const resolved = resolveConnection(deps, capability, binding);
	const { data } = await deps.cache.read(
		{
			connectionId: resolved.connectionId,
			capability,
			args: scopedArgs(scope, args),
			ttlSeconds: ttlFor(deps, capability)
		},
		async () => (await deps.dispatcher.one<T>({ capability, scope, binding: resolved, call })).data
	);
	return data as T;
}

/**
 * Which connection a binding means.
 *
 * Named → itself. Empty → the one connection of the kind that declares the capability; the
 * same three-way distinction `dispatcher.all()` makes when nothing answers, plus a fourth for
 * "several could" — a binding must name its connection once more than one cloud is connected.
 */
function resolveConnection(
	deps: RouterDeps,
	capability: Capability,
	binding: SourceBinding
): SourceBinding {
	if (binding.connectionId !== '') return binding;
	const supporting = deps.registry.supporting(capability);
	if (supporting.length === 1) return { ...binding, connectionId: supporting[0].ref.id };
	if (supporting.length === 0) {
		const anyOfKind = deps.registry.connections(kindOf(capability)).length > 0;
		throw new CapabilityUnavailableError(capability, anyOfKind ? 'no-capability' : 'no-connection');
	}
	throw new CapabilityUnavailableError(capability, 'ambiguous-connection');
}
```

Add imports: `SourceBinding` from `../provider`, `kindOf` from `$lib/platform/sources`, `CapabilityUnavailableError` from `../errors` (check what is already imported).

- [ ] **Step 4: `dispatch-tiers.test.ts`** — `type Helper = 'fanOut' | 'fanOutSingle' | 'fanOutSeries' | 'routeOne';` and add `'routeOne'` to `live` and `reference` in `ALLOWED`. Do NOT add `routeOne` to the existing regex alternation: routers never call `routeOne(deps, 'cap'` with a literal — they call `scoped(deps, catalog, 'cap', …)`, which Task 6 teaches the test to read. Run the file — must still pass (no router uses the owner path yet).

- [ ] **Step 5: Run** — `bun test src/lib/server/sources` → green; `check`, `lint` green.

- [ ] **Step 6: Commit** — `feat: routeOne — the cached, resolved caller dispatcher.one() never had`

---

### Task 5: Fixture cloud honours the owner

**Files:**

- Modify: `src/lib/server/platform/infrastructure-fixtures.ts` — `listRegions`, `listClusters`, `readNodeCounts`, `readUtilization`, `readStorage`, `listDatabases`, `readCost` gain an `owner?: string` parameter
- Modify: `src/lib/server/sources/fixtures/cloud.ts:33-58` — pass `ctx.binding?.externalId`
- Test: `src/lib/server/platform/infrastructure-fixtures.test.ts` (append)

**Why before the port:** the router's owner path (Task 6) is only testable end to end once the fixture cloud filters. `ctx.binding` already exists on `SourceContext`, so this task needs nothing from Task 6.

**Interfaces — Produces:** `listRegions(owner?)`, `listClusters(limit, owner?)`, `readNodeCounts(owner?)`, `readUtilization(now, owner?, buckets = 18)`, `readStorage(owner?)`, `listDatabases(limit, owner?)`, `readCost(now, owner?)`. With `owner` undefined every function returns EXACTLY what it returns today.

- [ ] **Step 1: Failing tests**

```ts
import { boundDomains } from '$lib/platform/ownership';
import type { NodeCounts } from '$lib/platform/types';

describe('owner-scoped fixtures', () => {
	const total = (c: NodeCounts) => c.healthy + c.warning + c.down;

	test('the estate figures do not move', () => {
		// The estate donut, the node tile's Degraded status, e2e text and the DTO tests all encode these.
		expect(readNodeCounts()).toEqual({ healthy: 42, warning: 4, down: 2 });
		expect(listRegions().map((r) => r.id)).toEqual([
			'eu-west-1',
			'eu-central-1',
			'us-east-1',
			'us-west-2',
			'ap-southeast-1'
		]);
	});
	test('regions: payment-domain runs in eu-west-1 only', () => {
		expect(listRegions('payment-domain').map((r) => r.id)).toEqual(['eu-west-1']);
	});
	test('clusters inherit the region: exactly the two in eu-west-1', () => {
		expect(
			listClusters(100, 'payment-domain')
				.map((c) => c.id)
				.sort()
		).toEqual(['prod-eu-west-1-a', 'prod-eu-west-1-b']);
	});
	test("an owner's node count is derived from its regions, and the owners sum to the estate total", () => {
		const mine = readNodeCounts('payment-domain');
		expect(total(mine)).toBe(12); // eu-west-1 nodeCount
		expect(mine.healthy).toBe(Math.floor((12 * 96) / 100)); // region score 96 → 11
		expect(mine.down).toBe(0);
		const owned = boundDomains('fixture').map((s) => total(readNodeCounts(s)));
		expect(owned.reduce((t, n) => t + n, 0)).toBe(48); // the five regions' nodeCounts = the estate total
	});
	test('databases: analytics-domain owns analytics-db only', () => {
		expect(listDatabases(100, 'analytics-domain').map((d) => d.id)).toEqual(['analytics-db']);
	});
	test("storage: a domain's classes come from FIXTURE_STORAGE_BYTES, and owners sum to the estate", () => {
		const estate = readStorage();
		const mine = readStorage('payment-domain');
		expect(mine.classes.map((c) => c.id)).toEqual(estate.classes.map((c) => c.id));
		const owned = boundDomains('fixture').map((s) => readStorage(s).totalBytes);
		expect(owned.reduce((t, b) => t + b, 0)).toBeCloseTo(estate.totalBytes, -6);
	});
	test('an unbound owner gets empty lists — the router will have thrown first, but the fixture is honest too', () => {
		expect(listRegions('tax-domain')).toEqual([]);
		expect(total(readNodeCounts('tax-domain'))).toBe(0);
	});
});
```

- [ ] **Step 2: Run → fails** — `bun test src/lib/server/platform/infrastructure-fixtures.test.ts`.

- [ ] **Step 3: Implement** — read each existing body first; every change is "compute what you compute today, then filter by owner":

```ts
import { FIXTURE_STORAGE_BYTES, fixtureOwnerOf } from '$lib/platform/ownership';

/** Region rows carry `[id, name, lat, lon, nodeCount, score]` — the seeds at ~:53-57, hoisted to module scope. */
const REGION_ROWS = /* the existing tuple array */;
/** Storage class seeds `[id, label, bytes]` — the array at ~:187-189, hoisted the same way. */
const STORAGE_SEEDS = /* the existing tuple array */;

export function listRegions(owner?: string): InfraRegion[] {
	const all = /* existing mapping of REGION_ROWS → InfraRegion */;
	return owner === undefined ? all : all.filter((r) => fixtureOwnerOf(r.id) === owner);
}

export function listClusters(limit: number, owner?: string): ClusterLoad[] {
	const all = /* existing */;
	return (owner === undefined ? all : all.filter((c) => fixtureOwnerOf(c.id) === owner)).slice(0, limit);
}

/**
 * The estate split is its own constant and does not move: the donut, the node tile's
 * "Degraded" and the e2e text encode it. An owner's count is derived from its regions —
 * healthy = floor(nodeCount · score / 100), warning = the rest, down = 0 — so the owners'
 * totals sum to the estate total (48) by construction while the estate split stays honest.
 */
export function readNodeCounts(owner?: string): NodeCounts {
	if (owner === undefined) return NODE_COUNTS; // the existing constant at ~:28
	return listRegions(owner).reduce(
		(acc, r) => {
			const row = REGION_ROWS.find((one) => one[0] === r.id)!;
			const healthy = Math.floor((row[4] * row[5]) / 100);
			return { healthy: acc.healthy + healthy, warning: acc.warning + (row[4] - healthy), down: acc.down };
		},
		{ healthy: 0, warning: 0, down: 0 }
	);
}

export function readStorage(owner?: string) {
	if (owner === undefined) return /* existing */;
	const mine = FIXTURE_STORAGE_BYTES[owner] ?? { block: 0, object: 0, file: 0 };
	const classes = STORAGE_SEEDS.map(([id, label]) => ({ id, label, bytes: mine[id as 'block' | 'object' | 'file'] }));
	return { totalBytes: classes.reduce((t, c) => t + c.bytes, 0), classes };
}

export function listDatabases(limit: number, owner?: string) { /* existing rows; filter by fixtureOwnerOf(id) === owner when set; then .slice(0, limit) */ }

/** `owner` before `buckets` so callers never restate the default to reach it. */
export function readUtilization(now: Date, owner?: string, buckets = 18): ResourceReading[] {
	/* identical body; seed with `infra:${owner ?? ''}:${id}` so a domain's line is its own */
}

export function readCost(now: Date, owner?: string): CostBreakdown {
	/* existing categories; when owner is set, scale EACH category's `amount` AND every point of its
	   `daily[]` by share = total(readNodeCounts(owner)) / 48, then recompute `total` = Σ amounts and
	   `forecast` = (total / daysElapsed) · daysInMonth from the SCALED values — the columns and the
	   headline must describe the same spend. `changePct` / `forecastChangePct` stay as they are
	   ("not derivable", as the estate says). Derived, so the owners sum to the estate. */
}
```

Grep every existing caller of `readUtilization(` and move `buckets` to the third position.

In `sources/fixtures/cloud.ts`: `async listRegions(ctx) { return estate.listRegions(ctx.binding?.externalId); }`, `async readNodeCounts(ctx) { return estate.readNodeCounts(ctx.binding?.externalId); }`, `async listClusters(ctx, limit) { return estate.listClusters(limit, ctx.binding?.externalId); }`, `async readUtilization(ctx) { return estate.readUtilization(new Date(), ctx.binding?.externalId); }`, `async readStorage(ctx) { return estate.readStorage(ctx.binding?.externalId); }`, `async listDatabases(ctx, limit) { return estate.listDatabases(limit, ctx.binding?.externalId); }`, `async readCost(ctx) { return estate.readCost(new Date(), ctx.binding?.externalId); }`.

- [ ] **Step 4: Run** — `bun test src` → green with NO change to any existing assertion (the estate path is byte-identical). `check`, `lint`.

- [ ] **Step 5: Commit** — `feat: the fixture cloud knows which domain owns what`

---

### Task 6: The owner argument — port and router

**Files:**

- Modify: `src/lib/server/platform/source.ts:300-331` (`InfrastructureSource`, methods ~:304-330)
- Modify: `src/lib/server/platform/fixture-source.ts:230-274` (`FixtureInfrastructureSource` — add the optional parameter to every method and forward it to the Task 5 functions)
- Modify: `src/lib/server/sources/routers/infrastructure.ts` (whole file), `routers/index.ts:31`
  \1
- Modify: `src/lib/server/sources/boot.test.ts:106` — the OTHER one-argument `createInfrastructureRouter(deps)` call; a `catalog` is already in scope at `:105` — pass the CatalogSource it holds. Grep `createInfrastructureRouter(` to confirm these two plus `routers/index.ts` are the only call sites.
- Modify: `src/lib/server/sources/routers/dispatch-tiers.test.ts:30-52` — `Helper`, `ALLOWED`, and a second pattern

**Red window, stated:** after Step 3 `bun run check` is red until Step 4 updates `FixtureInfrastructureSource`, the router, `infrastructure.test.ts` AND `boot.test.ts` — all inside this task. Do not commit between them.

**Interfaces — Produces:** every `InfrastructureSource` method takes a trailing `owner?: string`; `createInfrastructureRouter(deps: RouterDeps, catalog: CatalogSource)`.

- [ ] **Step 1: Failing tests** (append to `infrastructure.test.ts`, using its `build()` → `source`)

```ts
import { FixtureCatalogSource } from '../../catalog/fixture-source';

describe('owner-scoped reads', () => {
	test('a bound domain gets exactly its own resources', async () => {
		const { source } = build();
		expect((await source.listRegions(scope, 'payment-domain')).map((r) => r.id)).toEqual([
			'eu-west-1'
		]);
		expect(
			(await source.listClusters(scope, 100, 'payment-domain')).map((c) => c.id).sort()
		).toEqual(['prod-eu-west-1-a', 'prod-eu-west-1-b']);
	});
	test('a domain with NO declared cloud binding is no-binding — the bindingFor fallback must not count', async () => {
		const { source } = build();
		await expect(source.readNodeCounts(scope, 'tax-domain')).rejects.toMatchObject({
			reason: 'no-binding'
		});
	});
	test('an unknown slug is no-binding too', async () => {
		const { source } = build();
		await expect(source.listRegions(scope, 'no-such-domain')).rejects.toMatchObject({
			reason: 'no-binding'
		});
	});
	test('the estate path is untouched', async () => {
		const { source } = build();
		expect((await source.listRegions(scope)).map((r) => r.id)).toHaveLength(5);
	});
});
```

- [ ] **Step 2: Run → fails** (TS: too many arguments).

- [ ] **Step 3: Port** — in `source.ts` each of the nine methods gains `owner?: string` last, with one docblock:

```ts
	/**
	 * `owner` narrows a read to one domain's resources — the ones tagged with its slug.
	 *
	 * App vocabulary: the port says which domain, never which tag. The router resolves the
	 * domain's DECLARED cloud binding and throws `no-binding` when there is none, which the
	 * assembler renders as a stated gap. Absent, the read is the estate's, exactly as before.
	 */
	listRegions(scope: PlatformScope, owner?: string): Promise<InfraRegion[]>;
	readNodeCounts(scope: PlatformScope, owner?: string): Promise<NodeCounts>;
	listClusters(scope: PlatformScope, limit: number, owner?: string): Promise<ClusterLoad[]>;
	readUtilization(scope: PlatformScope, owner?: string): Promise<ResourceReading[]>;
	readStorage(scope: PlatformScope, owner?: string): Promise<{ totalBytes: number; classes: StorageClass[] }>;
	listDatabases(scope: PlatformScope, limit: number, owner?: string): Promise<DatabaseInstance[]>;
	listQueues(scope: PlatformScope, limit: number, owner?: string): Promise<MessageQueue[]>;
	listAlerts(scope: PlatformScope, limit: number, owner?: string): Promise<InfraAlert[]>;
	readCost(scope: PlatformScope, owner?: string): Promise<CostBreakdown>;
```

- [ ] **Step 4: Implementations** — `FixtureInfrastructureSource`: add the parameter and forward it (`return listRegions(owner)` etc.; queues/alerts accept and ignore it). Router: `createInfrastructureRouter(deps: RouterDeps, catalog: CatalogSource)` with two helpers, every method rewritten:

```ts
/**
 * A domain's DECLARED cloud binding, or the reason there is none.
 *
 * Declared only — `bindingFor()`'s fallback synthesises a slug binding for APM identity and
 * would make every domain look bound. Unknown slug and no binding are the same gap: nothing
 * to read for.
 */
async function ownerBinding(
	catalog: CatalogSource,
	capability: Capability,
	owner: string
): Promise<SourceBinding> {
	const record = await catalog.findDomain(owner);
	const declared = record?.bindings.find((one) => one.kind === 'cloud');
	if (!declared) throw new CapabilityUnavailableError(capability, 'no-binding');
	return { kind: 'cloud', connectionId: declared.connectionId, externalId: declared.externalId };
}

/** Estate → the fan-out as before; owner → resolve and route to one connection, cached per owner. */
async function scoped<T>(
	deps: RouterDeps,
	catalog: CatalogSource,
	capability: Capability,
	scope: PlatformScope,
	args: string,
	owner: string | undefined,
	call: (client: unknown, ctx: SourceContext) => Promise<T>,
	estate: () => Promise<T>
): Promise<T> {
	if (owner === undefined) return estate();
	const binding = await ownerBinding(catalog, capability, owner);
	return routeOne(
		deps,
		capability,
		scope,
		binding,
		`${args}${args ? '&' : ''}owner=${owner}`,
		call
	);
}
```

```ts
		listRegions: (scope, owner) =>
			scoped(deps, catalog, 'cloud.regions', scope, '', owner,
				(client, ctx) => (client as CloudProvider).listRegions!(ctx),
				() => fanOut(deps, 'cloud.regions', scope, '', (client, ctx) => (client as CloudProvider).listRegions!(ctx))
			),
```

…and likewise for the other eight (`readNodeCounts`/`readStorage`/`readCost` use `fanOutSingle` for the estate branch; `listClusters`/`listDatabases`/`listQueues`/`listAlerts` pass `limit=${limit}` as `args`). `listGroups(scope)` is unchanged. Rewrite the file's docstring: it has a catalog side now, for bindings only. In `routers/index.ts:31`: `infrastructure: createInfrastructureRouter(deps, catalog.services)`. Update `infrastructure.test.ts`'s `build()` to pass `new FixtureCatalogSource()`.

- [ ] **Step 5: `dispatch-tiers.test.ts`** — the regex at `:52` matches `fanOut(deps, 'cap'` literally and can never see a capability routed through `scoped(deps, catalog, 'cap'`. Add `'routeOne'` to `Helper` and to `live`/`reference` in `ALLOWED`, and add a second pattern `/\bscoped\s*\(\s*deps,\s*catalog,\s*'([^']+)'/g` that records helper `'routeOne'` for its capability. Run the file: every cloud capability must now report BOTH its fan-out helper (the estate branch) and `routeOne`.

- [ ] **Step 6: Run** — `bun test src`, `check` (0 errors — the window is closed), `lint`.

- [ ] **Step 7: Commit** — `feat: a domain can ask the estate about its own resources`

---

### Task 7: Azure provider honours the owner

**Files:**

- Modify: `src/lib/server/sources/providers/azure/map.ts` (`ArmResource` gains `tags?: Record<string, string>`)
- Modify: `src/lib/server/sources/providers/azure/index.ts` — settings `ownerTagKey`; `loadMachines(owner?)` as an owner-keyed `Map`; `listRegions(ctx)` and `readNodeCounts(ctx)` gain the `ctx` parameter they do not take today (`:170-176`); an `owned()` filter in `listClusters`/`readStorage`/`listDatabases`; `readCost` `filter.tags`
- Test: `src/lib/server/sources/providers/azure/provider.test.ts` (append)

**Self-contained against floci-az:** the emulator test PATCHes its own tag and restores it, so it does not depend on Task 9's seed.

- [ ] **Step 1: Failing tests**

```ts
import { ownsResource } from '$lib/platform/ownership';

describe('owner filtering (pure)', () => {
	const vm = (
		name: string,
		location: string,
		tags?: Record<string, string>
	): ArmVirtualMachine => ({
		id: `/subscriptions/s/resourceGroups/g/providers/Microsoft.Compute/virtualMachines/${name}`,
		name,
		location,
		tags,
		properties: { instanceView: { statuses: [{ code: 'PowerState/running' }] } }
	});
	test("regionsOf over the owned subset lists only the owner's regions", () => {
		const machines = [
			vm('a', 'eastus', { domain: 'payment-domain' }),
			vm('b', 'westeurope'),
			vm('c', 'westus2', { Domain: 'payment-domain' })
		];
		const mine = machines.filter((m) => ownsResource(m.tags, 'domain', 'payment-domain'));
		expect(
			regionsOf(mine)
				.map((r) => r.id)
				.sort()
		).toEqual(['eastus', 'westus2']); // key case-insensitive
		expect(countNodes(mine)).toEqual({ healthy: 2, warning: 0, down: 0 });
	});
});

describe('no tag $filter is sent on ARM lists', () => {
	test('an owner read lists the whole type and filters here', async () => {
		const urls: string[] = [];
		const server = Bun.serve({
			port: 0,
			fetch: (req) => {
				urls.push(req.url);
				return Response.json({ value: [] });
			}
		});
		try {
			const client = azureProvider.connect({
				baseUrl: `http://localhost:${server.port}`,
				subscriptionId: 'sub',
				tenantId: 't',
				clientId: 'c',
				clientSecret: 'local-dev-only'
			});
			await client.listRegions!({
				...context(),
				binding: { kind: 'cloud', connectionId: 'az', externalId: 'payment-domain' }
			});
			expect(urls.length).toBeGreaterThan(0);
			for (const u of urls) expect(new URL(u).searchParams.has('$filter')).toBe(false);
		} finally {
			server.stop(true);
		}
	});
});

// APPEND inside the EXISTING `describe.if(emulator)('against floci-az', …)` block (~:274), where
// `client` is declared — do not open a second block. Its `const`s and `test` go in that block:
	const H = { authorization: 'Bearer local-dev-key', 'content-type': 'application/json' };
	const VM =
		'/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/cc-eastus/providers/Microsoft.Compute/virtualMachines/cc-eastus-node-1';
	const patch = (tags: Record<string, string>) =>
		fetch(`http://localhost:4577${VM}?api-version=2023-03-01`, {
			method: 'PATCH',
			headers: H,
			body: JSON.stringify({ tags })
		});
	test("a tagged VM appears in its owner's regions and nowhere else", async () => {
		await patch({ domain: 'zz-test-domain' });
		try {
			const mine = await client.listRegions!({
				...context(),
				binding: { kind: 'cloud', connectionId: 'azure-local', externalId: 'zz-test-domain' }
			});
			expect(mine.map((r) => [r.id, r.nodeCount])).toEqual([['eastus', 1]]);
			const other = await client.listRegions!({
				...context(),
				binding: { kind: 'cloud', connectionId: 'azure-local', externalId: 'zz-other' }
			});
			expect(other).toEqual([]);
		} finally {
			await patch({});
		}
	});
});
```

(`emulator`, `client`, `context()` already exist in this test file; the final `});` in the snippet closes that existing block.)

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement**
  - `map.ts`: `export interface ArmResource { id: string; name: string; location: string; tags?: Record<string, string>; properties?: Record<string, unknown>; }`
  - Settings: `ownerTagKey: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(128)), 'domain')`.
  - `loadMachines(owner?: string)`: replace the single memo with `const windows = new Map<string, { at: number; rows: Promise<ArmVirtualMachine[]> }>()` keyed `owner ?? ''`; the owner entry is `loadMachines().then((rows) => rows.filter((m) => ownsResource(m.tags, settings.ownerTagKey, owner)))` — derived from the estate window, never filtering it in place; the same 30s TTL per entry.
  - `const owned = <T extends ArmResource>(rows: T[], ctx: SourceContext) => ctx.binding ? rows.filter((r) => ownsResource(r.tags, settings.ownerTagKey, ctx.binding!.externalId)) : rows;`
  - `async listRegions(ctx) { return regionsOf(await loadMachines(ctx.binding?.externalId)); }`, `async readNodeCounts(ctx) { return countNodes(await loadMachines(ctx.binding?.externalId)); }`; `readUtilization(ctx)` uses `loadMachines(ctx.binding?.externalId)`; `listClusters`/`readStorage`/`listDatabases` apply `owned(rows, ctx)` after each `collect`. No `$filter` is added anywhere.
  - `readCost(ctx)`: when `ctx.binding`, the body gains `filter: { tags: { name: settings.ownerTagKey, operator: 'In', values: [ctx.binding.externalId] } }`.
  - Provider docblock: the client-side check is the mechanism; server-side narrowing via `/resources?$filter=tag…` is the `docs/todo` ceiling.

- [ ] **Step 4: Run** — unit + wire tests green; with `bun run db:up` the emulator test green; estate tests unchanged.

- [ ] **Step 5: Commit** — `feat: Azure answers for one domain by its tag`

---

### Task 8: Cost mock — a domain axis and a body-parsing handler

**Files:**

- Modify: `src/lib/server/sources/providers/azure/mock/cost.ts`
- Modify: `src/lib/server/sources/providers/azure/mock/cost.test.ts` (EXISTS with 5 tests — append; keep them green)

**Shape rule:** real Cost Management with `grouping: [ServiceName]` returns ONE row per (day, service). After filtering by domain the mock must re-aggregate to that shape — never emit duplicate (day, service) rows. Only `mock/cost.ts` itself reads `CostEstate.rows` (verified: every other `buildEstate` in the tree is the Coralogix or Octopus mock), so the row tuple may gain an internal 5th element safely.

- [ ] **Step 1: Failing tests**

```ts
describe('cost mock, tag-aware', () => {
	const now = new Date('2026-09-16T12:00:00Z');
	const url =
		'http://x/subscriptions/s/providers/Microsoft.CostManagement/query?api-version=2021-10-01';
	const post = (body: unknown) =>
		costMockHandler({ now })(
			new Request(url, {
				method: 'POST',
				headers: { authorization: 'Bearer local-dev-key', 'content-type': 'application/json' },
				body: JSON.stringify(body)
			})
		);
	const base = {
		type: 'Usage',
		timeframe: 'MonthToDate',
		dataset: {
			granularity: 'Daily',
			aggregation: { totalCost: { name: 'Cost', function: 'Sum' } },
			grouping: [{ type: 'Dimension', name: 'ServiceName' }]
		}
	};
	const withTag = (value: string) => ({
		...base,
		dataset: {
			...base.dataset,
			filter: { tags: { name: 'domain', operator: 'In', values: [value] } }
		}
	});
	type Row = [number, number, string, string];
	const rowsOf = async (r: Response) =>
		((await r.json()) as { properties: { rows: Row[] } }).properties.rows;
	const total = (rows: Row[]) => rows.reduce((t, [c]) => t + c, 0);

	test('unfiltered rows are one per (day, service) and exceed the sum of every domain', async () => {
		const estate = await rowsOf(await post(base));
		const keys = estate.map(([, d, s]) => `${d}|${s}`);
		expect(new Set(keys).size).toBe(keys.length);
		let sum = 0;
		for (const d of [
			'payment-domain',
			'order-domain',
			'user-domain',
			'inventory-domain',
			'notification-domain'
		])
			sum += total(await rowsOf(await post(withTag(d))));
		expect(sum).toBeLessThan(total(estate)); // an untagged remainder exists
		expect(sum).toBeGreaterThan(total(estate) * 0.5); // and most spend is attributed
	});
	test('a tag filter narrows to one domain, re-aggregated to one row per (day, service)', async () => {
		const mine = await rowsOf(await post(withTag('payment-domain')));
		expect(total(mine)).toBeGreaterThan(0);
		const keys = mine.map(([, d, s]) => `${d}|${s}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
	test('an unknown tag value has no rows', async () => {
		expect(await rowsOf(await post(withTag('tax-domain')))).toEqual([]);
	});
	test('a body that is not JSON is a 400 with an error code, not a crash', async () => {
		const r = await costMockHandler({ now })(
			new Request(url, {
				method: 'POST',
				headers: { authorization: 'Bearer local-dev-key' },
				body: '{'
			})
		);
		expect(r.status).toBe(400);
	});
});
```

- [ ] **Step 2: Run → fails** (handler ignores the body / is sync).

- [ ] **Step 3: Implement** — `CostEstate.rows` becomes `Array<[number, number, string, string, string]>` (5th: domain slug or `''`). `buildEstate` splits each service's daily rate across `boundDomains('seed')` plus `''` by a seeded share (`buildSeries(\`azure-cost:${service}:${domain}\`, …)`), so per-(day, service) sums reproduce today's totals. `costMockHandler`becomes`async (request: Request): Promise<Response>`; on POST: `const body = await request.json().catch(() => null); if (!body) return Response.json({ error: { code: 'BadRequest', message: 'Body is not JSON.' } }, { status: 400 });`; `const wanted = body.dataset?.filter?.tags?.values as string[] | undefined`; `rows = wanted ? estate.rows.filter((r) => wanted.includes(r[4])) : estate.rows`; then re-aggregate by `(usageDate, service)` summing cost, and emit the 4-column shape (`COLUMNS` unchanged). Docblock: "answer the real request shape; the estate total is the sum over domains plus untagged — one fixture derived from the other."

- [ ] **Step 4: Run** — `bun test src/lib/server/sources/providers/azure` → the 5 existing + 4 new green; `provider.test.ts`'s cost test unchanged.

- [ ] **Step 5: Commit** — `feat: the cost mock answers a tag filter the way Cost Management does`

---

### Task 9: The seed tags every resource

**Files:**

- Modify: `scripts/seed-azure.ts` (every `put()` body)

**Dependency:** Task 7 does not need this (its emulator test tags its own VM); the Azure-mode e2e in Task 11 does. Tag by GROUP for everything in a region group; by NAME for the four PostgreSQL servers, which override their group.

- [ ] **Step 1:** `import { OWNER_TAG_KEY, seedOwnerOf } from '../src/lib/platform/ownership';` and:

```ts
/** The seed's half of "ownership by tag": every resource carries the domain that owns it. */
function tagged<T extends object>(body: T, ownerOf: string): T & { tags?: Record<string, string> } {
	const owner = seedOwnerOf(ownerOf);
	return owner ? { ...body, tags: { [OWNER_TAG_KEY]: owner } } : body;
}
```

Wrap every body: resource group → `tagged({ location }, group)`; each VM → `tagged(vmBody(location, state), group)`; AKS → `tagged({...}, group)`; storage account → `tagged({...}, group)` (its own truncated name is deliberately NOT in the ownership table); each PostgreSQL server → `tagged({...}, \`cc-${name}\`)`.

- [ ] **Step 2:** With floci-az up: `bun run seed:azure`; then

```bash
S=/subscriptions/00000000-0000-0000-0000-000000000001; H="authorization: Bearer local-dev-key"
curl -s -H "$H" "http://localhost:4577$S/resourceGroups/cc-southeastasia/providers/Microsoft.Storage/storageAccounts/ccstsoutheastasi?api-version=2023-01-01" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tags'))"   # → {'domain': 'notification-domain'}
curl -s -H "$H" "http://localhost:4577$S/resourceGroups/cc-westeurope/providers/Microsoft.DBforPostgreSQL/flexibleServers/cc-orders?api-version=2023-03-01-preview" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tags'))"   # → {'domain': 'order-domain'} (overrides the group's payment-domain)
```

Then run Task 7's emulator test again (still green — it restores its own tag).

- [ ] **Step 3: Commit** — `feat: the seed tags every resource with the domain that owns it`

---

### Task 10: service.ts readers, the assembler, and `toInfraSummaryView`

**Files:**

- Modify: `src/lib/server/platform/service.ts:317-350` (seven readers gain `owner?`); add `readDomainInfrastructure`
- Modify: `src/lib/platform/types.ts` (`InfraSummary`, `DomainInfrastructureSnapshot`)
- Modify: `src/lib/platform/infrastructure.ts` (`toInfraSummaryView`)
- Create: `src/lib/server/platform/domain-infrastructure-view.ts`, `domain-infrastructure-view.test.ts`

**Interfaces — Produces:**

```ts
export interface InfraSummary {
	nodes: NodeCounts;
	clusters: { count: number; atLimit: boolean } | null;
	databases: { count: number; atLimit: boolean } | null;
	storageBytes: number | null;
}
export interface DomainInfrastructureSnapshot {
	generatedAt: string;
	domain: Domain;
	unbound: boolean;
\1
	/** The nodes panel itself — `ComputeCard` takes `Panel<NodeCounts>` beside the clusters. */
	nodes: Panel<NodeCounts>;
\2
	clusters: Panel<ClusterLoad[]>;
	databases: Panel<DatabaseInstance[]>;
	// VIEW types, converted in the assembler with toUsageView / toCostView exactly as
	// infrastructure-view.ts does — UtilizationCard and CostCard take these, not the raw facts.
	utilization: Panel<ResourceUsage[]>;
	cost: Panel<CostBreakdownView>;
}
export function buildDomainInfrastructureSnapshot(
	platform: PlatformSource,
	infrastructure: InfrastructureSource,
	scope: PlatformScope,
	slug: string,
	now?: Date
): Promise<DomainInfrastructureSnapshot | null>;
export function toInfraSummaryView(s: InfraSummary): {
	nodesLabel: string;
	clustersLabel: string;
	databasesLabel: string;
	storageLabel: string;
};
export const DOMAIN_INFRA_LIMIT = 100;
```

- [ ] **Step 1: Failing tests** (build routers the way `capability-gaps.test.ts` does; `routersWithout`)

```ts
import { describe, expect, test } from 'bun:test';
import { buildDomainInfrastructureSnapshot } from './domain-infrastructure-view';
import { toInfraSummaryView } from '$lib/platform/infrastructure';
// Build routers exactly as capability-gaps.test.ts does — SourceRegistry + createDispatcher + SourceCache +
// createRouters over FIXTURE_PROVIDERS — and reuse its `routersWithout(capabilities)` for the gap cases.

const scope = { environment: 'production' as const, timeRange: '1h' as const };
const now = new Date('2026-09-16T12:00:00Z');
const ok = <T>(p: { status: string; data?: T }): T => {
	if (p.status !== 'ok') throw new Error(p.status);
	return p.data as T;
};

describe('the domain infrastructure tab', () => {
	test('a bound domain gets its own panels, a composed strip, and unbound false', async () => {
		const r = routersWithout([]);
		const snap = (await buildDomainInfrastructureSnapshot(
			r.platform,
			r.infrastructure,
			scope,
			'payment-domain',
			now
		))!;
		expect(snap.unbound).toBe(false);
		expect(ok(snap.regions).map((x) => x.id)).toEqual(['eu-west-1']);
		expect(
			ok(snap.clusters)
				.map((x) => x.id)
				.sort()
		).toEqual(['prod-eu-west-1-a', 'prod-eu-west-1-b']);
		const summary = ok(snap.summary);
		expect(summary.nodes).toEqual({ healthy: 11, warning: 1, down: 0 }); // floor(12·96/100) = 11
		expect(summary.clusters).toEqual({ count: 2, atLimit: false });
		expect(summary.databases).toEqual({ count: 1, atLimit: false }); // payment-db
		expect(summary.storageBytes).toBeGreaterThan(0);
	});
	test('an unbound domain: every panel no-binding, unbound true, and the strip is the nodes gap', async () => {
		const r = routersWithout([]);
		const snap = (await buildDomainInfrastructureSnapshot(
			r.platform,
			r.infrastructure,
			scope,
			'tax-domain',
			now
		))!;
		expect(snap.unbound).toBe(true);
		for (const p of [
			snap.summary,
			snap.nodes,
			snap.regions,
			snap.clusters,
			snap.databases,
			snap.utilization,
			snap.cost
		]) {
			expect(p.status).toBe('unavailable');
			expect((p as { reason?: string }).reason).toBe('no-binding');
		}
	});
	test('a bound domain missing cloud.storage alone: storageBytes null, unbound false', async () => {
		const r = routersWithout(['cloud.storage']);
		const snap = (await buildDomainInfrastructureSnapshot(
			r.platform,
			r.infrastructure,
			scope,
			'payment-domain',
			now
		))!;
		expect(snap.unbound).toBe(false);
		expect(ok(snap.summary).storageBytes).toBeNull();
		expect(ok(snap.summary).clusters).toEqual({ count: 2, atLimit: false });
	});
	test('a bound domain missing cloud.nodes: the strip is that gap, the other panels are ok', async () => {
		const r = routersWithout(['cloud.nodes']);
		const snap = (await buildDomainInfrastructureSnapshot(
			r.platform,
			r.infrastructure,
			scope,
			'payment-domain',
			now
		))!;
		expect(snap.unbound).toBe(false);
		expect(snap.summary.status).toBe('unavailable');
		expect((snap.summary as { reason?: string }).reason).toBe('no-capability');
		expect(snap.regions.status).toBe('ok');
	});
	test('unknown slug → null', async () => {
		const r = routersWithout([]);
		expect(
			await buildDomainInfrastructureSnapshot(
				r.platform,
				r.infrastructure,
				scope,
				'no-such-domain',
				now
			)
		).toBeNull();
	});
	test('toInfraSummaryView prints 100+ at the limit and a dash for a null cell', () => {
		const view = toInfraSummaryView({
			nodes: { healthy: 1, warning: 0, down: 0 },
			clusters: { count: 100, atLimit: true },
			databases: null,
			storageBytes: null
		});
		expect(view.clustersLabel).toBe('100+');
		expect(view.databasesLabel).toBe('—');
		expect(view.storageLabel).toBe('—');
	});
});
// `InfraSummary` is never published — the seven API paths carry the resources, not the strip — so
// `count`/`atLimit` are asserted on `toInfraSummaryView` only (Task 13 corrects the spec's testing row).
```

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3: Implement** — readers: `export function readRegions(scope: PlatformScope, owner?: string) { return infrastructureSource().listRegions(scope, owner); }` etc. for all seven. Assembler:

```ts
const LIMIT = 100;
export const DOMAIN_INFRA_LIMIT = LIMIT;

export async function buildDomainInfrastructureSnapshot(
	platform,
	infrastructure,
	scope,
	slug,
	now = new Date()
) {
	const domain = await platform.findDomain(scope, slug);
	if (!domain) return null;
	const owner = slug;
	const [nodes, regions, clusters, databases, utilization, cost, storage] = await Promise.all([
		panel('cloud.nodes', async () => ({ data: await infrastructure.readNodeCounts(scope, owner) })),
		panel('cloud.regions', async () => ({ data: await infrastructure.listRegions(scope, owner) })),
		panel('cloud.clusters', async () => ({
			data: await infrastructure.listClusters(scope, LIMIT, owner)
		})),
		panel('cloud.databases', async () => ({
			data: await infrastructure.listDatabases(scope, LIMIT, owner)
		})),
		panel('cloud.utilization', async () => ({
			data: (await infrastructure.readUtilization(scope, owner)).map(toUsageView)
		})),
		panel('cloud.cost', async () => ({
			data: toCostView(await infrastructure.readCost(scope, owner))
		})),
		panel('cloud.storage', async () => ({ data: await infrastructure.readStorage(scope, owner) }))
	]);
	// The strip is composed, not read: no node count, no strip; a storage-only gap is a null cell.
	const summary: Panel<InfraSummary> =
		nodes.status !== 'ok'
			? (nodes as Panel<InfraSummary>)
			: {
					...nodes,
					data: {
						nodes: nodes.data,
						clusters:
							clusters.status === 'ok'
								? { count: clusters.data.length, atLimit: clusters.data.length === LIMIT }
								: null,
						databases:
							databases.status === 'ok'
								? { count: databases.data.length, atLimit: databases.data.length === LIMIT }
								: null,
						storageBytes: storage.status === 'ok' ? storage.data.totalBytes : null
					}
				};
	return {
		generatedAt: now.toISOString(),
		domain,
		unbound: collapseUnbound([nodes, regions, clusters, databases, utilization, cost, storage]),
		summary,
		nodes,
		regions,
		clusters,
		databases,
		utilization,
		cost
	};
}
```

(A clusters or databases gap makes that cell `null` — a dash, never `0`, per `CountTile.value`. Task 13 records this nullable shape as a spec correction.)

`toInfraSummaryView` in `platform/infrastructure.ts`: `clustersLabel = c === null ? '—' : c.atLimit ? \`${c.count}+\` : String(c.count)`; storage via `formatBytes`or`—`.

- [ ] **Step 4: Run** — green; `check`, `lint`.

- [ ] **Step 5: Commit** — `feat: assemble a domain's infrastructure, and say when it owns nothing`

---

### Task 11: The tab

**Files:**

- Modify: `src/routes/domains.remote.ts` (`getDomainInfrastructure`)
- Create: `src/routes/domains/[slug]/infrastructure/+page.svelte`
- Create: `src/lib/components/domains/DomainInfraSummary.svelte` ONLY. Every infrastructure card already takes `Panel<T>` (verified): REUSE `RegionHealthCard` (`Panel<InfraRegion[]>`), `ComputeCard` (`Panel<NodeCounts>` + `Panel<ClusterLoad[]>`), `DatabasesCard` (`Panel<DatabaseInstance[]>`), `UtilizationCard` (`Panel<ResourceUsage[]>`), `CostCard` (`Panel<CostBreakdownView>`) as-is — the snapshot carries the view types they need (Task 10). Read each card's title/noun props and pass domain-appropriate copy.
- Modify: `src/routes/domains/[slug]/[tab]/+page.ts` (`_BUILT_TABS` + `'infrastructure'`), `e2e/harness.ts` (`ROUTES` + `'/domains/payment-domain/infrastructure'`), `src/lib/server/platform/capability-gaps.test.ts` (two `SCREENS` entries: `'domain infrastructure'` slug `'payment-domain'`; `'domain infrastructure (unbound)'` slug `'tax-domain'`), `request-budget.test.ts` + `warm-budget.test.ts` (rows, MEASURED)

- [ ] **Step 1:** Remote: `export const getDomainInfrastructure = query(scopedServiceSchema, async ({ slug, ...scope }) => readDomainInfrastructure(scope, slug));`
- [ ] **Step 2:** Page, following `domains/[slug]/deployments/+page.svelte`: `getDomainHeader` for chrome; `{#if snapshot.unbound}` → one sentence `{gapSentence('no-binding', 'cloud', 'infrastructure')}` above the strip; else the six panels each with `PanelGap` fallback. Use the five cards named in Step 1 — `RegionHealthCard`, `ComputeCard` (`nodes` + `clusters` panels, both on the snapshot), `DatabasesCard`, `UtilizationCard`, `CostCard`. NOT `StorageCard`: storage is a strip cell only; this tab has no storage panel.
- [ ] **Step 3:** `_BUILT_TABS`, `ROUTES`, two sweep entries, budget rows with measured numbers (`cost()` helper; comment the numbers). The unbound entry (`tax-domain`) short-circuits on `no-binding` for every dropped capability — it proves the unbound path renders, not capability gaps; say so in its comment.
- [ ] **Step 4:** Browser: `bun run build && PORT=4907 ORIGIN=http://localhost:4907 bun ./build/index.js`; `/domains/payment-domain/infrastructure` (strip `11/12`-style counts under fixtures will be fixture numbers — record them), `/domains/tax-domain/infrastructure` (one "Not bound" sentence, no zeros), `/domains/no-such/infrastructure` (not-found). `bun test e2e/render.test.ts` green in all stacks available.
- [ ] **Step 5: Commit** — `feat: a domain's Infrastructure tab — what it runs on, by its tag`

---

### Task 12: Seven public resources

**Files:**

- Create: `src/routes/api/v1/domains/[slug]/infrastructure/{regions,nodes,clusters,databases,utilization,storage,cost}/+server.ts`
- Modify: `src/lib/server/api/v1/openapi.ts` (no new schemas needed — verify), `components.yaml` (regenerate)
- Test: `src/lib/server/api/openapi.test.ts` (must pass unchanged), a route test for 404 and 501-on-unbound

- [ ] **Step 1:** Copy `domains/[slug]/services/+server.ts`'s structure. Each route: `parseScope`, `v.parse(serviceSlugSchema, params.slug)`, `const domain = await readDomain(scope, slug); if (!domain) throw new NotFoundError(…)`, then `requirePanel(await panel('cloud.regions', …))` — or call the reader directly and let `CapabilityUnavailableError` map to 501 via the existing `errorResponse` (it already does; `requirePanel` is only needed when you hold a Panel). Map with `toRegionDto` etc. `operationId`s: `readDomainInfrastructureRegions` … `readDomainInfrastructureCost`. Tag `Domains`. Responses exactly `200/400/401/404` per the exact-set test — **do not add 501**.
- [ ] **Step 2:** `bun run openapi:components`; `bun test src/lib/server/api` (annotation checks); add a test: `GET …/tax-domain/infrastructure/regions` with a token → 501 body `reason: 'no-binding'`, `message === gapSentence('no-binding','cloud','cloud.regions')`.
- [ ] **Step 3: Commit** — `feat: publish a domain's infrastructure as seven resources, like the estate's`

---

### Task 13: Docs

- `CLAUDE.md`: State (6 of 8 domain tabs; 43 paths — measured; test count — measured; e2e routes — measured); "Data sources" section: ownership by tag, `routeOne`, the connection-resolution rule, the gap-sentence single source, the server-side-narrowing ceiling; budget table rows (measured).
- Spec: "Corrections during implementation" section: nullable `clusters`/`databases` cells; the snapshot carries VIEW types for utilisation/cost; the `count`/`atLimit` testing row is asserted on `toInfraSummaryView` only (the strip is never published); `gapSentence('no-binding')` is key-agnostic; the 501 `message` wording change; `readUtilization(now, owner?, buckets)` order; the seed tags storage by group (truncated names).
- `docs/todo/`: close `adopt-dispatcher-one.md` (delete or mark done); NEW `azure-owner-server-side-narrowing.md` (the `/resources?$filter` / Resource Graph ceiling); update `unbuilt-screen-sections.md` (domain 6 of 8); README table.
- Commit `docs: record ownership by tag and what it cost`.

---

## Self-review

**Spec coverage:** ownership concept + catalog binding (1, 3); port owner + router + `routeOne` + resolution + cache key (4, 5); providers Azure/fixture (6, 7); cost mock (8); seed (9); two worlds module (1); gap presentation — `GapReason`, `gapSentence`, `collapseUnbound`, PanelGap, 501 message (2); assembler, `InfraSummary`, `toInfraSummaryView`, composed strip, storage-null (10); tab, `_BUILT_TABS`, sweep bound+unbound, budgets, e2e (11); seven API paths, no 501 doc (12); docs + todo + spec corrections (13). Risks: cache/no-cache (4 tests), tag lag (13 doc), floci-az no filter (7 emulator test), drift (13).

**Placeholder scan:** Task 6's fixture bodies and Task 7/8's tests say "existing body"/"write these fully" in places — acceptable only because the implementer must READ those bodies; the assertions to make are named. Task 11's components defer to reading existing card props — stated as "wrap rather than fork". No TBD/TODO.

**Type consistency:** `InfraSummary.clusters`/`databases` changed to nullable in Task 10's note — carry to the type block at the top of Task 10 and to Task 13's spec correction. `routeOne` signature in Task 4 matches its use in Task 5's `scoped()`. `gapSentence(reason, kind, noun)` 3-arg everywhere. `boundDomains('fixture')` used in 3, 6; `seedOwnerOf` in 9; `fixtureOwnerOf` in 6.
