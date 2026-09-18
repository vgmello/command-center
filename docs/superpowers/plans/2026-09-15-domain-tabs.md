# Domain Detail Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Services, Deployments and SLOs placeholders on the domain detail screen with purpose-built pages, backed by a new per-service deployment accumulation.

**Architecture:** A new optional capability `deployment.serviceTrends` accumulates run counts, failure counts and duration totals per service into `source_series` under `entity = <service slug>`; a domain's figures are a sum over its services' rows, and the estate's are a sum over every entity. Above that, a shared `getDomainHeader` query plus one query per tab replaces the current pattern of every tab refetching the Overview's composite.

**Tech Stack:** SvelteKit 2 remote functions, Svelte 5 runes, Valibot, Bun test, Drizzle/Postgres (`source_series`, no migration needed).

**Spec:** `docs/superpowers/specs/2026-09-15-domain-tabs-design.md`

## Global Constraints

- **Svelte 5 runes only.** No `export let`, no `$:`, no `on:click`. Use `$props`, `$derived`, `onclick`.
- **Valibot, namespaced:** `import * as v from 'valibot'`. Never Zod.
- **`bun test`, not Vitest or Jest.** `import { test, expect } from 'bun:test'`.
- **Declare only what is implemented.** A capability in a provider's `capabilities` array with no method is a runtime hole; `agreement.ts` fails the build both directions.
- **Every source-backed read in an assembler is wrapped in `panel()`.** Catalog reads are not.
- **A gap propagates as `null`, never `0`.**
- **Sources return facts.** No colours, no formatted strings, no percentages computed for a bar width.
- **The API publishes measurements, not renderings.** Minutes not `"21m"`, seconds not `"4m 12s"`, counts not percentages.
- **Entity is the service's catalog slug**; a deployment whose service is not in the catalog accumulates under the exact string `(unattributed)`.
- **One accumulation per connection, once the migration is complete.** The end state is that a connection declaring `deployment.serviceTrends` does not also declare `deployment.trends` — two accumulations of the same runs put two answers to one question in the store. Tasks 5 through 9 are the transition and both are declared across them: Task 5 adds the new capability while the deployments screen still reads the old one, and Task 9 Step 6 moves that screen onto a sum over entities. **Do not retire `deployment.trends` before Task 9 Step 6 passes its before-and-after budget measurement.**
- **~~The estate read sums every entity, `''` included.~~ SUPERSEDED — see the Task 9 finding
  note directly below.** ~~The two are never written for the same period, so nothing
  double-counts.~~ `source_series` is partitioned by capability, so a `''` row and a
  per-service row for the same period are never read together and cannot be summed inside
  one accumulation.
- **Note (Task 9 finding):** the "one accumulation per connection" constraint above is satisfied by _dispatch_, not by forbidding a connection from declaring both capabilities — only one of the two `readTrends` paths executes per read, decided by whether any connection in the registry supports `deployment.serviceTrends`. See `docs/superpowers/specs/2026-09-15-domain-tabs-design.md`'s "Corrections during implementation" section and `CLAUDE.md`'s "What the store buys, and what it cannot".
- **Series geometry for `deployment.serviceTrends` is identical to `deployment.trends`:** `bucketSeconds: 86400`, `settlingSeconds: 86400`, year horizon.
- **The SLO tab headline is `DomainVitals.sloCompliancePct`, never recomputed.**
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Jgha5PbXCX8KuAgLNTKpEW`

---

## File Structure

| File                                                                 | Responsibility                                                                       | Task        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------- |
| `src/lib/platform/types.ts`                                          | `ServiceTrend`, `DomainDeploymentStats`, `DomainSloRollup` types                     | 1, 6, 10    |
| `src/lib/platform/deployment-aggregates.ts`                          | `serviceTrendsOf` — rows to per-service buckets                                      | 1           |
| `src/lib/platform/sources.ts`                                        | `deployment.serviceTrends` in the `CAPABILITIES` union                               | 2           |
| `src/lib/server/sources/contracts.ts`                                | `readServiceTrends?` on `DeploymentProvider`                                         | 2           |
| `src/lib/server/sources/agreement.ts`                                | capability → method entry                                                            | 2           |
| `src/lib/server/sources/tiers.ts`                                    | `series` tier entry                                                                  | 2           |
| `src/lib/server/sources/series.ts`                                   | geometry entry                                                                       | 2           |
| `src/lib/server/platform/source.ts`                                  | `readServiceTrends` on `DeploymentSource`                                            | 2           |
| `src/lib/server/sources/routers/deployment-series-shape.ts`          | `serviceTrendsShape` — flatten/rebuild per entity                                    | 3           |
| `src/lib/server/sources/routers/deployment.ts`                       | router wiring for the new capability                                                 | 4           |
| `src/lib/server/sources/fixtures/deployment.ts`                      | fixture implementation                                                               | 5           |
| `src/lib/server/sources/providers/octopus/index.ts`                  | Octopus implementation                                                               | 5           |
| `src/lib/platform/domain-deployments.ts`                             | **new** — roll service trends into a domain's DORA figures                           | 6           |
| `src/lib/server/platform/service.ts`                                 | `readDomainHeader`, `readDomainDeployments`, `readDomainSlos`                        | 7, 9, 10    |
| `src/routes/domains.remote.ts`                                       | `getDomainHeader`, `getDomainServices`, `getDomainDeployments`, `getDomainSlos`      | 7, 8, 9, 10 |
| `src/lib/server/platform/domain-tabs-view.ts`                        | **new** — the three tab assemblers                                                   | 8, 9, 10    |
| `src/routes/domains/[slug]/{services,deployments,slos}/+page.svelte` | the three pages                                                                      | 8, 9, 10    |
| `src/lib/components/domains/`                                        | `DomainServicesTable`, `DomainDeployStats`, `DomainServiceDeploys`, `DomainSloTable` | 8, 9, 10    |
| `src/routes/api/v1/domains/[slug]/{deployments,slo}/+server.ts`      | **new** public resources                                                             | 11          |

---

### Task 1: `ServiceTrend` and the per-service aggregator

**Files:**

- Modify: `src/lib/platform/types.ts`
- Modify: `src/lib/platform/deployment-aggregates.ts`
- Test: `src/lib/platform/deployment-aggregates.test.ts`

**Interfaces:**

- Produces: `ServiceTrend` (type), `serviceTrendsOf(deployments: Deployment[], grain: TrendGrain, from: Date, to: Date): ServiceTrend[]`

Context: `deployment-aggregates.ts` already has `trendsOf`, which collapses `Deployment[]` into two estate-wide series. This adds the per-service sibling. The private helpers `bucketsBetween(from, to, grain)`, `bucketOf(date, grain)` and `seriesOf(id, label, points)` already exist in that file — reuse them, do not reimplement.

`DeploymentStatus` is `'success' | 'failed' | 'in-progress' | 'rolled-back'`. A failure is `'failed'` **or** `'rolled-back'`, matching `summariseDeployments`.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/platform/deployment-aggregates.test.ts`:

```ts
import { serviceTrendsOf } from './deployment-aggregates';
import type { Deployment } from './types';

function run(over: Partial<Deployment> = {}): Deployment {
	return {
		id: 'd1',
		reference: '#1',
		service: 'payment-api',
		version: 'v1',
		domainId: 'payment-domain',
		domainName: 'Payment Domain',
		icon: 'rocket',
		environment: 'production',
		status: 'success',
		trigger: 'pipeline',
		deployedBy: 'ci',
		deployedAt: '2026-09-15T10:00:00.000Z',
		durationSeconds: 100,
		...over
	};
}

describe('serviceTrendsOf', () => {
	const from = new Date('2026-09-14T00:00:00.000Z');
	const to = new Date('2026-09-15T23:59:59.000Z');

	test('splits the runs by service rather than collapsing them', () => {
		const rows = serviceTrendsOf(
			[run(), run({ id: 'd2', service: 'payment-gateway' })],
			'daily',
			from,
			to
		);

		expect(rows.map((one) => one.service).sort()).toEqual(['payment-api', 'payment-gateway']);
	});

	test('counts a rollback as a failure, the way the summary does', () => {
		const [row] = serviceTrendsOf(
			[run(), run({ id: 'd2', status: 'rolled-back' }), run({ id: 'd3', status: 'failed' })],
			'daily',
			from,
			to
		);

		expect(row.runs.points.reduce((sum, one) => sum + one.value, 0)).toBe(3);
		expect(row.failures.points.reduce((sum, one) => sum + one.value, 0)).toBe(2);
	});

	test('stores the duration total, not a mean, so a domain mean can be rebuilt', () => {
		// Two runs at 10s and two hundred at 1000s is a mean of 990, and averaging two
		// per-service means gives 505. Only the totals survive being summed.
		const [row] = serviceTrendsOf(
			[run({ durationSeconds: 10 }), run({ id: 'd2', durationSeconds: 1_000 })],
			'daily',
			from,
			to
		);

		expect(row.durationTotal.points.reduce((sum, one) => sum + one.value, 0)).toBe(1_010);
	});

	test('a run still going has no duration and does not count as instantaneous', () => {
		const [row] = serviceTrendsOf([run({ durationSeconds: null })], 'daily', from, to);

		expect(row.durationTotal.points.reduce((sum, one) => sum + one.value, 0)).toBe(0);
		expect(row.runs.points.reduce((sum, one) => sum + one.value, 0)).toBe(1);
	});

	test('every service shares the same buckets, so the rows line up on one axis', () => {
		const rows = serviceTrendsOf(
			[run(), run({ id: 'd2', service: 'payment-gateway' })],
			'daily',
			from,
			to
		);

		expect(rows[0].runs.points.length).toBe(rows[1].runs.points.length);
		expect(rows[0].runs.points.map((one) => one.label)).toEqual(
			rows[1].runs.points.map((one) => one.label)
		);
	});

	test('a deployment with no catalog service is kept, not dropped', () => {
		// Discarding runs silently makes a frequency chart understate reality.
		const rows = serviceTrendsOf([run({ service: '' })], 'daily', from, to);

		expect(rows.map((one) => one.service)).toEqual(['(unattributed)']);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/platform/deployment-aggregates.test.ts`
Expected: FAIL — `serviceTrendsOf` is not exported.

- [ ] **Step 3: Add the type**

In `src/lib/platform/types.ts`, beside the other deployment types:

```ts
/** The string a run with no catalog service is filed under. */
export const UNATTRIBUTED = '(unattributed)';

/**
 * One service's runs over a window, decomposed so every figure re-aggregates.
 *
 * Totals and counts rather than rates and means, for the reason the estate trends already
 * store it that way: a mean cannot be rebuilt from means, and a rate cannot be rebuilt
 * from rates. A domain is the sum of its services, so only additive quantities travel.
 */
export interface ServiceTrend {
	/** The service as the catalog names it, or `UNATTRIBUTED`. */
	service: string;
	/** Runs started in each bucket. */
	runs: TimeSeries;
	/** Runs that failed or were rolled back, same buckets. */
	failures: TimeSeries;
	/** Total wall-clock seconds of the runs that finished, same buckets. */
	durationTotal: TimeSeries;
}
```

- [ ] **Step 4: Implement the aggregator**

Append to `src/lib/platform/deployment-aggregates.ts`:

```ts
/**
 * The same runs as `trendsOf`, grouped by service instead of collapsed.
 *
 * Every service gets the same buckets so the rows line up on one axis and a domain can be
 * summed bucket by bucket. Nothing is averaged here — see `ServiceTrend` for why.
 */
export function serviceTrendsOf(
	deployments: Deployment[],
	grain: TrendGrain,
	from: Date,
	to: Date
): ServiceTrend[] {
	const buckets = bucketsBetween(from, to, grain);
	const empty = () => new Map(buckets.map((one) => [one.key, 0]));
	const byService = new Map<
		string,
		{ runs: Map<string, number>; failures: Map<string, number>; totals: Map<string, number> }
	>();

	for (const deployment of deployments) {
		const at = new Date(deployment.deployedAt);
		if (Number.isNaN(at.getTime())) continue;

		const { key } = bucketOf(at, grain);
		if (!buckets.some((one) => one.key === key)) continue;

		const service = deployment.service || UNATTRIBUTED;
		const found = byService.get(service) ?? { runs: empty(), failures: empty(), totals: empty() };
		byService.set(service, found);

		found.runs.set(key, (found.runs.get(key) ?? 0) + 1);

		if (deployment.status === 'failed' || deployment.status === 'rolled-back') {
			found.failures.set(key, (found.failures.get(key) ?? 0) + 1);
		}

		// `null` is a run still going, which has no duration. Zero would sort and average
		// as though it were instantaneous.
		if (deployment.durationSeconds !== null) {
			found.totals.set(key, (found.totals.get(key) ?? 0) + deployment.durationSeconds);
		}
	}

	const pointsOf = (counts: Map<string, number>) =>
		buckets.map((one) => ({ label: one.label, value: counts.get(one.key) ?? 0 }));

	return [...byService.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([service, found]) => ({
			service,
			runs: seriesOf('runs', 'Deployments', pointsOf(found.runs)),
			failures: seriesOf('failures', 'Failures', pointsOf(found.failures)),
			durationTotal: seriesOf('duration-total', 'Duration total', pointsOf(found.totals))
		}));
}
```

Add `ServiceTrend` and `UNATTRIBUTED` to the file's existing `types` import.

- [ ] **Step 5: Run the tests**

Run: `bun test src/lib/platform/deployment-aggregates.test.ts`
Expected: PASS, all six new tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/platform/types.ts src/lib/platform/deployment-aggregates.ts src/lib/platform/deployment-aggregates.test.ts
git commit -m "feat: group deployment runs by service, decomposed so they re-aggregate"
```

---

### Task 2: Register the capability

**Files:**

- Modify: `src/lib/platform/sources.ts`
- Modify: `src/lib/server/sources/contracts.ts`
- Modify: `src/lib/server/sources/agreement.ts`
- Modify: `src/lib/server/sources/tiers.ts`
- Modify: `src/lib/server/sources/series.ts`
- Modify: `src/lib/server/platform/source.ts`

**Interfaces:**

- Consumes: `ServiceTrend` from Task 1.
- Produces: capability string `'deployment.serviceTrends'`; `DeploymentProvider.readServiceTrends?(ctx: SourceContext, grain: TrendGrain): Promise<ServiceTrend[]>`; `DeploymentSource.readServiceTrends(scope: PlatformScope, grain: TrendGrain): Promise<ServiceTrend[]>`

This task deliberately registers the capability everywhere at once. `agreement.ts` and `tiers.ts` both have exhaustive `Record<Capability, …>` maps, so adding the string to the union without the other entries does not compile — they are one change, not four.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/sources/tiers.test.ts`:

```ts
test('the per-service trends are accumulated, not re-fetched', () => {
	// `series` is a promise that a router accumulates the capability. Declaring the tier
	// without a `fanOutSeries` call is how the deployment trends fell through both
	// strategies for the whole of this project's life.
	expect(CAPABILITY_TIER['deployment.serviceTrends']).toBe('series');
});

test('they are bucketed by day, like the estate trends they replace', () => {
	const geometry = geometryFor('deployment.serviceTrends');

	expect(geometry.bucketSeconds).toBe(86_400);
	expect(geometry.settlingSeconds).toBe(86_400);
});
```

Add `import { geometryFor } from './series';` if not already present.

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/server/sources/tiers.test.ts`
Expected: FAIL — `'deployment.serviceTrends'` is not assignable to `Capability`.

- [ ] **Step 3: Add the capability to the union**

`src/lib/platform/sources.ts`, in the `CAPABILITIES` array after `'deployment.trends'`:

```ts
	'deployment.serviceTrends',
```

- [ ] **Step 4: Add the contract method**

`src/lib/server/sources/contracts.ts`, on `DeploymentProvider` after `readTrends`:

```ts
	/**
	 * The same runs as `readTrends`, split per service.
	 *
	 * Optional and separate rather than a wider `readTrends`, so a provider that can only
	 * answer estate-wide is unchanged. A connection declares one or the other and never
	 * both: two accumulations of the same runs put two answers to one question in the
	 * store, and then nothing can say which is right.
	 */
	readServiceTrends?(ctx: SourceContext, grain: TrendGrain): Promise<ServiceTrend[]>;
```

Add `ServiceTrend` to the file's `$lib/platform/types` import.

- [ ] **Step 5: Add the agreement, tier and geometry entries**

`src/lib/server/sources/agreement.ts`, in `CAPABILITY_METHODS`:

```ts
	'deployment.serviceTrends': 'readServiceTrends',
```

`src/lib/server/sources/tiers.ts`, beside `'deployment.trends'`:

```ts
	'deployment.serviceTrends': 'series',
```

`src/lib/server/sources/series.ts`, in the `GEOMETRY` map, beside the `deployment.trends` entry:

```ts
	'deployment.serviceTrends': {
		bucketSeconds: DAY_SECONDS,
		settlingSeconds: DAY_SECONDS,
		horizonSeconds: 365 * DAY_SECONDS
	},
```

Copy the exact key names from the existing `deployment.trends` entry — if it spells the horizon differently, match it.

- [ ] **Step 6: Add the port method**

`src/lib/server/platform/source.ts`, on `DeploymentSource` after `readTrends`:

```ts
	/**
	 * Per-service run counts, failures and duration totals at the requested grain.
	 *
	 * The domain tabs sum these; the estate figures are the same sum over every service.
	 * Returns an empty array when no connection accumulates them, which the assembler
	 * turns into a stated gap rather than a zero.
	 */
	readServiceTrends(scope: PlatformScope, grain: TrendGrain): Promise<ServiceTrend[]>;
```

- [ ] **Step 7: Run the tests**

Run: `bun test src/lib/server/sources/ && bun run check`
Expected: the two new tier tests PASS. `check` reports errors for every `DeploymentSource` implementation that now lacks `readServiceTrends` — that is expected and Tasks 4 and 5 close it. Note the count.

- [ ] **Step 8: Commit**

```bash
git add src/lib/platform/sources.ts src/lib/server/sources/contracts.ts src/lib/server/sources/agreement.ts src/lib/server/sources/tiers.ts src/lib/server/sources/series.ts src/lib/server/platform/source.ts src/lib/server/sources/tiers.test.ts
git commit -m "feat: declare deployment.serviceTrends, accumulated per service"
```

---

### Task 3: The series shape

**Files:**

- Modify: `src/lib/server/sources/routers/deployment-series-shape.ts`
- Test: `src/lib/server/sources/routers/deployment-series-shape.test.ts`

**Interfaces:**

- Consumes: `ServiceTrend` (Task 1), the capability (Task 2).
- Produces: `serviceTrendsShape(grain: TrendGrain)` with the `{ flatten, rebuild }` shape `fanOutSeries` expects.

Context: this file already exports `trendsShape` and `statusTrendShape`, and has private helpers `timestamps(count, window)`, `labelFor(grain)`, `seriesOf(id, label, points)`, `rebuildSeries(groups, metric, window, grain)` and the constants `TREND_DAYS` and `GRAIN_DAYS`. `rebuildSeries` is hardcoded to the key `` `${SEPARATOR}${metric}` `` — the empty entity — so it needs an entity parameter rather than a copy.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/sources/routers/deployment-series-shape.test.ts`, following the existing `roundTrip` helper in that file:

```ts
import { serviceTrendsShape } from './deployment-series-shape';

describe('serviceTrendsShape', () => {
	const answer = [
		{
			service: 'payment-api',
			runs: series([2, 4]),
			failures: series([0, 1]),
			durationTotal: series([20, 4_000])
		},
		{
			service: 'payment-gateway',
			runs: series([1, 1]),
			failures: series([1, 0]),
			durationTotal: series([10, 10])
		}
	];

	test('writes one entity per service, so a domain can be summed from them', () => {
		const keys = serviceTrendsShape('daily').flatten(answer, {
			from: new Date('2026-09-14T00:00:00Z'),
			to: new Date('2026-09-15T00:00:00Z')
		});

		expect([...new Set(keys.map((one) => one.key.entity))].sort()).toEqual([
			'payment-api',
			'payment-gateway'
		]);
		expect([...new Set(keys.map((one) => one.key.metric))].sort()).toEqual([
			'duration_total',
			'failure_count',
			'run_count'
		]);
	});

	test('survives a round trip through the store', () => {
		const back = roundTrip(serviceTrendsShape('daily'), answer, 'deployment.serviceTrends');

		expect(back.map((one) => one.service).sort()).toEqual(['payment-api', 'payment-gateway']);
		const api = back.find((one) => one.service === 'payment-api');
		expect(api?.runs.points.reduce((sum, one) => sum + one.value, 0)).toBe(6);
		expect(api?.failures.points.reduce((sum, one) => sum + one.value, 0)).toBe(1);
	});

	test('counts sum across a coarser grain rather than averaging', () => {
		// A week that averaged its days reports a seventh of the deployments that happened.
		const back = roundTrip(serviceTrendsShape('weekly'), answer, 'deployment.serviceTrends');
		const api = back.find((one) => one.service === 'payment-api');

		expect(api?.runs.points.reduce((sum, one) => sum + one.value, 0)).toBe(6);
	});
});
```

Add a local `series` helper to the test file if one does not already exist:

```ts
function series(values: number[]) {
	return {
		id: 's',
		label: 's',
		points: values.map((value, index) => ({ label: `p${index}`, value })),
		min: 0,
		max: Math.max(...values)
	};
}
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/server/sources/routers/deployment-series-shape.test.ts`
Expected: FAIL — `serviceTrendsShape` is not exported.

- [ ] **Step 3: Give `rebuildSeries` an entity**

In `src/lib/server/sources/routers/deployment-series-shape.ts`, change the private helper's signature and its lookup, and update the two existing `trendsShape` call sites to pass `''`:

```ts
function rebuildSeries(
	groups: Map<string, StoredSample[]>,
	entity: string,
	metric: string,
	window: { from: Date; to: Date },
	grain: TrendGrain,
	capability: Capability = 'deployment.trends'
): Array<{ at: Date; value: number }> {
	const samples = groups.get(`${entity}${SEPARATOR}${metric}`) ?? [];
	const geometry = geometryFor(capability);
	const days = Math.max(
		Math.round((window.to.getTime() - window.from.getTime()) / (86_400 * 1000)),
		1
	);

	return downsample(samples, window.from, window.to, Math.ceil(days / GRAIN_DAYS[grain]), {
		aggregate: 'sum',
		bucketSeconds: geometry.bucketSeconds
	});
}
```

Inside `trendsShape`'s `rebuild`, the two calls become `rebuildSeries(groups, '', 'run_count', window, grain)` and `rebuildSeries(groups, '', 'duration_total', window, grain)`.

Add `import type { Capability } from '$lib/platform/sources';`.

- [ ] **Step 4: Add the shape**

Append to the same file:

```ts
/**
 * `deployment.serviceTrends`: the same runs as the estate trends, keyed per service.
 *
 * Three metrics rather than two. A change failure rate is a headline on the domain tab and
 * a rate cannot be re-aggregated from rates, so the failures travel as their own count and
 * the rate is divided out after both have been summed.
 */
export function serviceTrendsShape(grain: TrendGrain) {
	return {
		flatten(
			answer: ServiceTrend[],
			window: { from: Date; to: Date }
		): Array<{ key: SeriesKey; points: Array<{ at: Date; value: number }> }> {
			return answer.flatMap((row) => {
				const times = timestamps(row.runs.points.length, window);
				const at = (points: typeof row.runs.points) =>
					points.map((point, index) => ({ at: times[index], value: point.value }));

				return [
					{ key: { entity: row.service, metric: 'run_count' }, points: at(row.runs.points) },
					{
						key: { entity: row.service, metric: 'failure_count' },
						points: at(row.failures.points)
					},
					{
						key: { entity: row.service, metric: 'duration_total' },
						points: at(row.durationTotal.points)
					}
				];
			});
		},

		rebuild(groups: Map<string, StoredSample[]>, window: { from: Date; to: Date }): ServiceTrend[] {
			// The entity is the first half of every stored key, so the services present are
			// read back off the store rather than assumed from a catalog that may have moved
			// on since the rows were written.
			const services = [...new Set([...groups.keys()].map((key) => key.split(SEPARATOR)[0]))]
				.filter((one) => one !== '')
				.sort();

			const label = labelFor(grain);
			const read = (service: string, metric: string) =>
				rebuildSeries(groups, service, metric, window, grain, 'deployment.serviceTrends');

			return services.map((service) => {
				const runs = read(service, 'run_count');
				const failures = read(service, 'failure_count');
				const totals = read(service, 'duration_total');
				const points = (values: Array<{ at: Date; value: number }>) =>
					values.map((one) => ({ label: label(one.at), value: one.value }));

				return {
					service,
					runs: seriesOf('runs', 'Deployments', points(runs)),
					failures: seriesOf('failures', 'Failures', points(failures)),
					durationTotal: seriesOf('duration-total', 'Duration total', points(totals))
				};
			});
		}
	};
}
```

Add `ServiceTrend` to the file's `$lib/platform/types` import.

- [ ] **Step 5: Run the tests**

Run: `bun test src/lib/server/sources/routers/deployment-series-shape.test.ts`
Expected: PASS — the three new tests and every pre-existing one in the file.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/sources/routers/deployment-series-shape.ts src/lib/server/sources/routers/deployment-series-shape.test.ts
git commit -m "feat: decompose per-service trends, with failures as their own count"
```

---

### Task 4: Router wiring

**Files:**

- Modify: `src/lib/server/sources/routers/deployment.ts`
- Test: `src/lib/server/sources/routers/deployment.test.ts`

**Interfaces:**

- Consumes: `serviceTrendsShape` (Task 3), the capability and port method (Task 2).
- Produces: `DeploymentSource.readServiceTrends` on the routed source.

Context: `readTrends` in this file already shows the exact call shape, including the deliberate empty `args` (`''`) and the window argument `TREND_DAYS[grain] * 86_400`. Copy that shape.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/sources/routers/deployment.test.ts`:

```ts
test('per-service trends come back grouped by service', async () => {
	const source = routedDeploymentSource();
	const rows = await source.readServiceTrends(scope, 'daily');

	expect(rows.length).toBeGreaterThan(0);
	for (const row of rows) {
		expect(row.service.length).toBeGreaterThan(0);
		expect(row.runs.points.length).toBe(row.failures.points.length);
		expect(row.runs.points.length).toBe(row.durationTotal.points.length);
	}
});

test('a source that does not accumulate them answers empty, not zero rows of noise', async () => {
	// The assembler turns an empty answer into a stated gap. Fabricating a zeroed series
	// would draw a flat line that reads as "nothing deployed".
	const source = routedDeploymentSource({ without: 'deployment.serviceTrends' });

	expect(await source.readServiceTrends(scope, 'daily')).toEqual([]);
});
```

Use whatever harness the existing tests in this file use to build a routed source; if they build it inline, follow that and name the helper `routedDeploymentSource`.

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/server/sources/routers/deployment.test.ts`
Expected: FAIL — `readServiceTrends` is not a function.

- [ ] **Step 3: Wire the router**

In `src/lib/server/sources/routers/deployment.ts`, directly after the `readTrends` entry:

```ts
		readServiceTrends: (scope, grain) =>
			fanOutSeries(
				deps,
				'deployment.serviceTrends',
				scope,
				// No grain in the args, for the same reason `readTrends` omits it: one set of
				// daily samples serves all three grains, and keying on the grain is what stops
				// them sharing.
				'',
				serviceTrendsShape(grain),
				(client, ctx) => (client as DeploymentProvider).readServiceTrends!(ctx, grain),
				TREND_DAYS[grain] * 86_400
			),
```

Add `serviceTrendsShape` to the `./deployment-series-shape` import.

- [ ] **Step 4: Run the tests**

Run: `bun test src/lib/server/sources/`
Expected: PASS, including `dispatch-tiers.test.ts` — which asserts every capability's dispatch helper matches its tier, and would fail if `fanOutSeries` had not been used.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/sources/routers/deployment.ts src/lib/server/sources/routers/deployment.test.ts
git commit -m "feat: route the per-service trends through the accumulator"
```

---

### Task 5: Provider implementations

**Files:**

- Modify: `src/lib/server/sources/fixtures/deployment.ts`
- Modify: `src/lib/server/sources/providers/octopus/index.ts`
- Test: `src/lib/server/sources/providers/octopus/provider.test.ts`

**Interfaces:**

- Consumes: `serviceTrendsOf` (Task 1), the contract method (Task 2).
- Produces: both providers declare and implement `deployment.serviceTrends`.

Context: the Octopus provider's `readTrends` is three lines — `trendWindow(ctx, TREND_DAYS[grain])` then `trendsOf(rows, grain, from, to)` — and `trendWindow` returns `{ from, to, rows }` where `rows` are `Deployment[]` already fetched into the shared window. The per-service variant reuses all of it and swaps the mapper, so it costs **no additional Octopus request**.

Both providers declare **both** capabilities for the duration of the transition, which the Global Constraints section describes: the deployments screen still reads `deployment.trends` until Task 9 Step 6 moves it onto a sum over entities. Declaring both means both accumulate, and for the overlapping period the store holds the same runs twice — under `''` and under each service. That is why the estate read must never sum the two together before the migration completes, and why Task 9 Step 6 carries a before-and-after measurement. Record the overlap in the commit message so a bisect lands on an explanation.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/sources/providers/octopus/provider.test.ts`, inside the block that runs against the mock:

```ts
test('per-service trends split the same runs the estate trends count', async () => {
	const [estate, perService] = await Promise.all([
		client.readTrends!(context(), 'daily'),
		client.readServiceTrends!(context(), 'daily')
	]);

	const estateRuns = estate.frequency.points.reduce((sum, one) => sum + one.value, 0);
	const splitRuns = perService.reduce(
		(sum, row) => sum + row.runs.points.reduce((inner, one) => inner + one.value, 0),
		0
	);

	// The same runs counted two ways. If these diverge, one of the two is dropping rows.
	expect(splitRuns).toBe(estateRuns);
	expect(perService.length).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/server/sources/providers/octopus/`
Expected: FAIL — `readServiceTrends` is not a function.

- [ ] **Step 3: Implement it on Octopus**

In `src/lib/server/sources/providers/octopus/index.ts`, add `'deployment.serviceTrends'` to the `capabilities` array, add `serviceTrendsOf` to the `$lib/platform/deployment-aggregates` import, and add the method directly after `readTrends`:

```ts
			/**
			 * The same window as `readTrends`, grouped by service rather than collapsed.
			 *
			 * `trendWindow` returns rows already fetched into the shared window, so this
			 * costs no additional Octopus request — the estate answer and the per-service
			 * one are two readings of one fetch.
			 */
			async readServiceTrends(ctx, grain) {
				const { from, to, rows } = await trendWindow(ctx, TREND_DAYS[grain]);
				return serviceTrendsOf(rows, grain, from, to);
			},
```

- [ ] **Step 4: Implement it on the fixture provider**

In `src/lib/server/sources/fixtures/deployment.ts`, add `'deployment.serviceTrends'` to `capabilities` and the method after `readTrends`:

```ts
		async readServiceTrends(_ctx, grain) {
			const now = new Date();
			const from = new Date(now.getTime() - TREND_DAYS[grain] * 86_400_000);
			return serviceTrendsOf(log.listDeployments(now), grain, from, now);
		},
```

Import `serviceTrendsOf` from `$lib/platform/deployment-aggregates` and `TREND_DAYS` from `../routers/deployment-series-shape`.

- [ ] **Step 5: Run the tests**

Run: `bun test src/`
Expected: PASS. `agreement.test.ts` in particular — it fails in both directions, so a declared capability with no method or a method with no declaration is caught here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/sources/fixtures/deployment.ts src/lib/server/sources/providers/octopus/index.ts src/lib/server/sources/providers/octopus/provider.test.ts
git commit -m "feat: answer per-service trends from rows both providers already fetch

Both providers keep deployment.trends alongside the new capability, because
the deployments screen still reads it. Task 9 moves that screen onto a
sum-over-entities read, and the estate capability is retired then."
```

---

### Task 6: Roll service trends into a domain

**Files:**

- Create: `src/lib/platform/domain-deployments.ts`
- Create: `src/lib/platform/domain-deployments.test.ts`
- Modify: `src/lib/platform/types.ts`

**Interfaces:**

- Consumes: `ServiceTrend` (Task 1).
- Produces: `DomainDeploymentStats` (type), `rollUpDeployments(rows: ServiceTrend[], services: string[]): DomainDeploymentStats`

Its own file rather than an addition to `deployment-aggregates.ts`: that module turns raw runs into estate figures, this one turns stored per-service series into a domain's. Different inputs, different callers, and `deployment-aggregates.ts` is already 250 lines.

- [ ] **Step 1: Write the failing test**

Create `src/lib/platform/domain-deployments.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { rollUpDeployments } from './domain-deployments';
import type { ServiceTrend } from './types';

function trend(
	service: string,
	runs: number[],
	failures: number[],
	totals: number[]
): ServiceTrend {
	const series = (id: string, values: number[]) => ({
		id,
		label: id,
		points: values.map((value, index) => ({ label: `p${index}`, value })),
		min: 0,
		max: Math.max(...values, 0)
	});

	return {
		service,
		runs: series('runs', runs),
		failures: series('failures', failures),
		durationTotal: series('duration-total', totals)
	};
}

describe('rollUpDeployments', () => {
	test('sums only the services the domain owns', () => {
		const stats = rollUpDeployments(
			[
				trend('payment-api', [2, 2], [0, 0], [100, 100]),
				trend('order-api', [9, 9], [9, 9], [1, 1])
			],
			['payment-api']
		);

		expect(stats.total).toBe(4);
		expect(stats.byService.map((one) => one.service)).toEqual(['payment-api']);
	});

	test('rebuilds the mean from the sums, never from per-service means', () => {
		// Two runs at 10s and two hundred at 1000s is a mean of 990. Averaging the two
		// service means gives 505, which is simply a different number.
		const stats = rollUpDeployments(
			[trend('a', [2], [0], [20]), trend('b', [200], [0], [200_000])],
			['a', 'b']
		);

		expect(stats.total).toBe(202);
		expect(stats.meanDurationSeconds).toBe(990);
	});

	test('rebuilds the failure rate from two counts, never from per-service rates', () => {
		const stats = rollUpDeployments(
			[trend('a', [100], [1], [0]), trend('b', [2], [1], [0])],
			['a', 'b']
		);

		// 2 of 102, not the mean of 1% and 50%.
		expect(stats.changeFailureRatePct).toBeCloseTo(1.96, 1);
	});

	test('a service with no runs does not divide by zero', () => {
		const stats = rollUpDeployments([trend('a', [0], [0], [0])], ['a']);

		expect(stats.meanDurationSeconds).toBe(0);
		expect(stats.changeFailureRatePct).toBe(0);
	});

	test('the frequency series keeps the buckets the services shared', () => {
		const stats = rollUpDeployments(
			[trend('a', [1, 2, 3], [0, 0, 0], [0, 0, 0]), trend('b', [1, 1, 1], [0, 0, 0], [0, 0, 0])],
			['a', 'b']
		);

		expect(stats.frequency.points.map((one) => one.value)).toEqual([2, 3, 4]);
	});

	test('a domain whose services never deployed reports zero, not a missing reading', () => {
		// Distinct from "nothing is accumulating", which is a gap the assembler states.
		const stats = rollUpDeployments([], ['a']);

		expect(stats.total).toBe(0);
		expect(stats.byService).toEqual([]);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/platform/domain-deployments.test.ts`
Expected: FAIL — cannot resolve `./domain-deployments`.

- [ ] **Step 3: Add the type**

In `src/lib/platform/types.ts`:

```ts
/** One service's contribution to its domain's deployment figures. */
export interface ServiceDeployShare {
	service: string;
	total: number;
	failures: number;
	changeFailureRatePct: number;
	/** Runs per bucket, for the row's sparkline. */
	frequency: TimeSeries;
}

/**
 * A domain's deployment figures, summed from its services.
 *
 * Every field is derived from additive quantities: the rate is two counts divided after
 * summing, and the mean is a total over a count. Neither is an average of averages.
 */
export interface DomainDeploymentStats {
	total: number;
	failures: number;
	changeFailureRatePct: number;
	meanDurationSeconds: number;
	frequency: TimeSeries;
	/** Worst failure rate first — the row a reader is looking for. */
	byService: ServiceDeployShare[];
}
```

- [ ] **Step 4: Implement the rollup**

Create `src/lib/platform/domain-deployments.ts`:

```ts
import type { DomainDeploymentStats, ServiceDeployShare, ServiceTrend, TimeSeries } from './types';

/**
 * A domain's deployment figures, summed from its services' stored series.
 *
 * The arithmetic is the whole point of this module, and both halves of it are mistakes
 * this codebase has already made once: a mean rebuilt from means weights a day of two runs
 * the same as a day of two hundred, and a rate rebuilt from rates does the same to a
 * service that deployed twice beside one that deployed a hundred times.
 */
export function rollUpDeployments(rows: ServiceTrend[], services: string[]): DomainDeploymentStats {
	const owned = rows.filter((row) => services.includes(row.service));
	const sum = (points: Array<{ value: number }>) =>
		points.reduce((total, one) => total + one.value, 0);

	const total = owned.reduce((count, row) => count + sum(row.runs.points), 0);
	const failures = owned.reduce((count, row) => count + sum(row.failures.points), 0);
	const durationTotal = owned.reduce((count, row) => count + sum(row.durationTotal.points), 0);

	const byService: ServiceDeployShare[] = owned
		.map((row) => {
			const runs = sum(row.runs.points);
			const failed = sum(row.failures.points);

			return {
				service: row.service,
				total: runs,
				failures: failed,
				changeFailureRatePct: runs === 0 ? 0 : (failed / runs) * 100,
				frequency: row.runs
			};
		})
		.sort((a, b) => b.changeFailureRatePct - a.changeFailureRatePct || b.total - a.total);

	return {
		total,
		failures,
		changeFailureRatePct: total === 0 ? 0 : (failures / total) * 100,
		// Sum of durations over sum of runs, not the mean of the services' means.
		meanDurationSeconds: total === 0 ? 0 : Math.round(durationTotal / total),
		frequency: combine(owned.map((row) => row.runs)),
		byService
	};
}

/**
 * Add the services' series bucket by bucket.
 *
 * They share an axis because they were written against one set of buckets, so the labels
 * of the longest series are the domain's labels and a shorter one contributes what it has.
 */
function combine(series: TimeSeries[]): TimeSeries {
	const longest = series.reduce<TimeSeries | null>(
		(best, one) => (!best || one.points.length > best.points.length ? one : best),
		null
	);

	if (!longest) {
		return { id: 'frequency', label: 'Deployments', points: [], min: 0, max: 0 };
	}

	const points = longest.points.map((point, index) => ({
		label: point.label,
		value: series.reduce((total, one) => total + (one.points[index]?.value ?? 0), 0)
	}));

	return {
		id: 'frequency',
		label: 'Deployments',
		points,
		min: 0,
		max: Math.max(...points.map((one) => one.value), 0)
	};
}
```

- [ ] **Step 5: Run the tests**

Run: `bun test src/lib/platform/domain-deployments.test.ts`
Expected: PASS, all six.

- [ ] **Step 6: Commit**

```bash
git add src/lib/platform/domain-deployments.ts src/lib/platform/domain-deployments.test.ts src/lib/platform/types.ts
git commit -m "feat: roll a domain's deployment figures up from its services"
```

---

### Task 7: The shared header query

**Files:**

- Modify: `src/lib/server/platform/service.ts`
- Modify: `src/routes/domains.remote.ts`
- Modify: `src/routes/domains/[slug]/dependencies/+page.svelte`
- Test: `src/lib/server/platform/service.test.ts`

**Interfaces:**

- Produces: `readDomainHeader(scope, slug): Promise<Domain | null>` in the service; `getDomainHeader` remote query taking `scopedServiceSchema`.

Context: `readDomain(scope, slug)` already exists in `service.ts` and does exactly this — it calls `platformSource().findDomain`. The work is exposing it as a remote query and moving the dependencies page onto it, so that page stops fetching the Overview composite to draw one graph.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/platform/service.test.ts`:

```ts
test('the domain header is one catalog read, not the overview composite', async () => {
	// The dependencies tab used to call `readDomainView`, fetching the service table, the
	// deployment log and the incident list to draw a graph that uses none of them.
	const header = await readDomainHeader(scope, 'payment-domain');

	expect(header?.slug).toBe('payment-domain');
});

test('an unknown slug is null, which the page renders as not-found', async () => {
	expect(await readDomainHeader(scope, 'no-such-domain')).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/server/platform/service.test.ts`
Expected: FAIL — `readDomainHeader` is not exported.

- [ ] **Step 3: Export the service function**

In `src/lib/server/platform/service.ts`, beside `readDomain`:

```ts
/**
 * The domain a tab draws its header and breadcrumb from.
 *
 * Every tab needs it and nothing else about it changes between them, so it is its own
 * read — a tab that called the overview composite for a name would fetch the service
 * table, the deployment log and the incident list to print one heading.
 */
export function readDomainHeader(scope: PlatformScope, slug: string): Promise<Domain | null> {
	return platformSource().findDomain(scope, slug);
}
```

- [ ] **Step 4: Add the remote query**

In `src/routes/domains.remote.ts`:

```ts
/**
 * The domain header, shared by every tab.
 *
 * Its own query because it is identical on all of them and changes only with the scope,
 * so a reader moving between tabs refetches the tab's own payload and nothing else.
 */
export const getDomainHeader = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readDomainHeader(scope, slug)
);
```

Add `readDomainHeader` to the `$lib/server/platform/service` import.

- [ ] **Step 5: Move the dependencies page onto it**

In `src/routes/domains/[slug]/dependencies/+page.svelte`, the page currently awaits `getDomainView(args)` and reads `snapshot.domain` and `snapshot.dependencies`. Split it into two awaits — `getDomainHeader(args)` for the header and breadcrumb, and a `getDomainDependencies` call for the graph.

`readDomainDependencies` is already on `PlatformSource`. Add the service function and remote query alongside the header:

```ts
// service.ts
export function readDomainDependencyGraph(scope: PlatformScope, slug: string) {
	return platformSource().readDomainDependencies(scope, slug);
}

// domains.remote.ts
export const getDomainDependencies = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readDomainDependencyGraph(scope, slug)
);
```

- [ ] **Step 6: Verify the page in a browser**

Run the app and open `/domains/payment-domain/dependencies`. The graph must render exactly as before.

```bash
bun run build && PORT=4900 ORIGIN=http://localhost:4900 bun ./build/index.js
```

- [ ] **Step 7: Run the tests**

Run: `bun test src && bun run check && bun run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/platform/service.ts src/routes/domains.remote.ts src/routes/domains/[slug]/dependencies/+page.svelte src/lib/server/platform/service.test.ts
git commit -m "refactor: give every domain tab a header query of its own"
```

---

### Task 8: The Services tab

**Files:**

- Create: `src/routes/domains/[slug]/services/+page.svelte`
- Create: `src/lib/components/domains/DomainServicesTable.svelte`
- Modify: `src/routes/domains.remote.ts`
- Modify: `src/routes/domains/[slug]/[tab]/+page.ts`
- Modify: `e2e/harness.ts`
- Modify: `src/lib/server/platform/capability-gaps.test.ts`

**Interfaces:**

- Consumes: `getDomainHeader` (Task 7); `readDomainServices(scope, slug): Promise<ServiceVitals[] | null>` which already exists in `service.ts`.
- Produces: `getDomainServices` remote query; route `/domains/[slug]/services`.

`readDomainServices` already exists and already returns exactly `serviceCount` rows whose statuses sum to the header's split. No server work beyond the remote query.

- [ ] **Step 1: Write the failing test**

Append to `src/routes/domains/[slug]/[tab]/page.test.ts` — create the file if it does not exist, following the pattern of the service tabs' guard test:

```ts
import { describe, expect, test } from 'bun:test';
import { isDomainTab } from '$lib/platform/domains';

describe('the domain tab fallback', () => {
	test('a section with its own route is rejected here, so it has one URL', () => {
		// `overview` and `dependencies` were already rejected; `services` joins them the
		// moment it has a real route. A section with two URLs is one a link can disagree
		// about.
		for (const built of ['overview', 'dependencies', 'services']) {
			expect(BUILT_TABS.includes(built)).toBe(true);
		}
	});

	test('a section that is genuinely unbuilt still falls through to the placeholder', () => {
		expect(isDomainTab('alerts')).toBe(true);
		expect(BUILT_TABS.includes('alerts')).toBe(false);
	});
});
```

Export `BUILT_TABS` from `+page.ts` so the guard is asserted rather than restated.

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/routes/domains`
Expected: FAIL — `BUILT_TABS` is not exported.

- [ ] **Step 3: Replace the guard with a list**

`src/routes/domains/[slug]/[tab]/+page.ts`:

```ts
import { error } from '@sveltejs/kit';
import { isDomainTab } from '$lib/platform/domains';
import type { PageLoad } from './$types';

/**
 * Sections that have a route of their own, and are therefore not this one's business.
 *
 * A list rather than a chain of comparisons, because it grows with every tab that lands
 * and a forgotten `||` gives a section two URLs — which is a section a link can disagree
 * about.
 */
export const BUILT_TABS = ['overview', 'dependencies', 'services'];

export const load: PageLoad = ({ params }) => {
	if (BUILT_TABS.includes(params.tab) || !isDomainTab(params.tab)) {
		error(404, 'No such domain section');
	}

	return { tab: params.tab };
};
```

- [ ] **Step 4: Add the remote query**

In `src/routes/domains.remote.ts`:

```ts
/**
 * A domain's services, with the readings behind each one's health.
 *
 * Its own query rather than a slice of the overview composite: this tab redraws on the
 * refresh tick and the overview's incident list and deployment log do not need to.
 */
export const getDomainServices = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readDomainServices(scope, slug)
);
```

- [ ] **Step 5: Build the table component**

Create `src/lib/components/domains/DomainServicesTable.svelte`. Svelte 5 runes only. It takes `rows: ServiceVitals[]` and renders the columns Service / Status / RPS / Err / P95 / Instances / Trend, with each row linking to `/services/[slug]`.

No search box: domains average two to four services and a filter over four rows is a dead control. Columns sort, held in `$state`.

Formatting comes from `$lib/platform/format.ts` and the status colour from `$lib/components/tone.ts` — never a literal Tailwind colour.

- [ ] **Step 6: Build the page**

Create `src/routes/domains/[slug]/services/+page.svelte`, modelled on `dependencies/+page.svelte`: breadcrumb, `DomainHeader` from `getDomainHeader`, `DomainTabs`, then the table from `getDomainServices` inside a `<svelte:boundary>` with a `Skeleton` pending snippet.

Above the table, a summary line reading `N services · N healthy · N degraded · N down`, counted from the rows themselves so it cannot disagree with what is listed beneath it.

- [ ] **Step 7: Add the route to the sweeps**

In `e2e/harness.ts`, add `'/domains/payment-domain/services'` to `ROUTES`.

In `src/lib/server/platform/capability-gaps.test.ts`, the `SCREENS` array covers assemblers rather than routes; this tab's data comes from `readDomainServices`, which composes `findDomain`, `readDomainVitals` and `listServiceVitals`. Add a screen entry that calls it, so dropping `apm.domainVitals` is proven to cost the panel and not the page.

- [ ] **Step 8: Verify it renders**

```bash
bun run build && bun test e2e/render.test.ts
```

Expected: the new route renders clean — no four-decimal floats, no `undefined`, no `NaN`.

- [ ] **Step 9: Run everything**

Run: `bun test src && bun run check && bun run lint`

- [ ] **Step 10: Commit**

```bash
git add src/routes/domains src/lib/components/domains/DomainServicesTable.svelte e2e/harness.ts src/lib/server/platform/capability-gaps.test.ts
git commit -m "feat: a domain's Services tab, listing what the header counts"
```

---

### Task 8b (inserted)

Not in the original plan. Task 8's implementer noticed `capability-gaps.test.ts`'s
`SCREENS` array passed slugs the fixture catalog does not contain (`'payments'`,
`'payments-api'`), which sent `domain detail`, `service detail` and `service metrics`
down the not-found path on every run of the sweep regardless of which capability had
been dropped — three of the sweep's seven entries had been proving nothing since the
sweep was written. Inserted as its own task, between 8 and 9, rather than folded into
Task 8's fix loop or deferred, because Tasks 9 and 10 add entries to this same sweep and
those entries deserved a harness that actually exercises the assemblers it adds them to.
Corrected the slugs, then wrapped the twelve real gaps the correction exposed across the
three screens (three reads in `domain-view.ts`, five in `service-view.ts`, four in
`service-metrics-view.ts`). Brief: `.superpowers/sdd/2026-09-15-domain-tabs/task-8b-brief.md`.
Commits: `9bb69d2` (implementation), `b56de59` (fix round: an SLO-alone gap had been
collapsing four tiles the source did answer, not just the one it didn't).

---

### Task 9: The Deployments tab

**Files:**

- Create: `src/routes/domains/[slug]/deployments/+page.svelte`
- Create: `src/lib/components/domains/DomainDeployStats.svelte`
- Create: `src/lib/components/domains/DomainServiceDeploys.svelte`
- Create: `src/lib/server/platform/domain-tabs-view.ts`
- Create: `src/lib/server/platform/domain-tabs-view.test.ts`
- Modify: `src/lib/server/platform/service.ts`, `src/routes/domains.remote.ts`, `src/routes/domains/[slug]/[tab]/+page.ts`, `e2e/harness.ts`, `src/lib/server/platform/request-budget.test.ts`, `src/lib/server/platform/warm-budget.test.ts`

**Interfaces:**

- Consumes: `rollUpDeployments` (Task 6), `DeploymentSource.readServiceTrends` (Tasks 2/4), `readDomainServices` (exists).
- Produces: `buildDomainDeploymentsSnapshot(platform, services, deployments, scope, slug, now): Promise<DomainDeploymentsSnapshot | null>`; `getDomainDeployments` remote query.

**The snapshot type**, added to `types.ts`:

```ts
/** Everything the domain's Deployments tab renders. */
export interface DomainDeploymentsSnapshot {
	generatedAt: string;
	domain: Domain;
	/** The window the figures cover, stated because "34 deploys" means nothing without it. */
	windowLabel: string;
	stats: Panel<DomainDeploymentStats>;
	log: Panel<Deployment[]>;
}
```

- [ ] **Step 1: Write the failing test**

Create `src/lib/server/platform/domain-tabs-view.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { buildDomainDeploymentsSnapshot } from './domain-tabs-view';

describe('the domain deployments tab', () => {
	test('counts only the services this domain owns', async () => {
		const snapshot = await buildDomainDeploymentsSnapshot(
			platform,
			services,
			deployments,
			scope,
			'payment-domain',
			now
		);

		const stats = ok(snapshot!.stats);
		const owned = await services.listServiceVitals(/* … as the fixture needs */);

		expect(stats.byService.every((row) => owned.some((one) => one.slug === row.service))).toBe(
			true
		);
	});

	test('a source that accumulates nothing leaves a gap, not a row of zeros', async () => {
		// A zeroed chart reads as "nothing deployed here", which is a different and false
		// statement from "nothing is measuring this".
		const snapshot = await buildDomainDeploymentsSnapshot(
			platform,
			services,
			withoutCapability(deployments, 'deployment.serviceTrends'),
			scope,
			'payment-domain',
			now
		);

		expect(snapshot!.stats.status).not.toBe('ok');
		// The log is a different capability and still renders.
		expect(snapshot!.log.status).toBe('ok');
	});

	test('an unknown domain is null, which the page renders as not-found', async () => {
		expect(
			await buildDomainDeploymentsSnapshot(platform, services, deployments, scope, 'nope', now)
		).toBeNull();
	});

	test('the window it measured is stated, not implied', async () => {
		const snapshot = await buildDomainDeploymentsSnapshot(
			platform,
			services,
			deployments,
			scope,
			'payment-domain',
			now
		);

		expect(snapshot!.windowLabel.length).toBeGreaterThan(0);
	});
});
```

Build the fixture `platform`, `services` and `deployments` routers the way `capability-gaps.test.ts` does — registry, dispatcher, cache, `createRouters` over `FIXTURE_PROVIDERS`.

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/server/platform/domain-tabs-view.test.ts`
Expected: FAIL — cannot resolve `./domain-tabs-view`.

- [ ] **Step 3: Write the assembler**

Create `src/lib/server/platform/domain-tabs-view.ts`. Every source-backed read is wrapped in `panel()`; the catalog read (`findDomain`) is not, and returning `null` for an unknown slug is the honest answer.

```ts
/** The grain the tab draws, and the window it therefore covers. */
const TAB_GRAIN: TrendGrain = 'daily';
const TAB_WINDOW_LABEL = 'last 14 days';

export async function buildDomainDeploymentsSnapshot(
	platform: PlatformSource,
	services: ServiceSource,
	deployments: DeploymentSource,
	scope: PlatformScope,
	slug: string,
	now: Date = new Date()
): Promise<DomainDeploymentsSnapshot | null> {
	const domain = await platform.findDomain(scope, slug);
	if (!domain) return null;

	const vitals = await platform.readDomainVitals(scope, slug);
	const owned = vitals
		? await services.listServiceVitals(scope, domain.id, vitals, domain.serviceCount)
		: [];

	const [stats, log] = await Promise.all([
		panel('deployment.serviceTrends', async () => ({
			data: rollUpDeployments(
				await deployments.readServiceTrends(scope, TAB_GRAIN),
				owned.map((one) => one.slug)
			)
		})),
		panel('deployment.log', async () => ({
			data: (
				await deployments.queryDeployments(scope, {
					search: '',
					state: 'all',
					domain: domain.id,
					service: ALL_SERVICES,
					environment: ALL_ENVIRONMENTS,
					window: 'any',
					page: 1,
					pageSize: DOMAIN_DEPLOYMENT_PAGE
				})
			).deployments
		}))
	]);

	return {
		generatedAt: now.toISOString(),
		domain,
		windowLabel: TAB_WINDOW_LABEL,
		stats,
		log
	};
}
```

Export `const DOMAIN_DEPLOYMENT_PAGE = 20;` from the same file.

- [ ] **Step 4: Add the service function and remote query**

```ts
// service.ts
export function readDomainDeployments(scope: PlatformScope, slug: string) {
	return buildDomainDeploymentsSnapshot(
		platformSource(),
		serviceSource(),
		deploymentSource(),
		scope,
		slug
	);
}

// domains.remote.ts
export const getDomainDeployments = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readDomainDeployments(scope, slug)
);
```

- [ ] **Step 5: Build the components and the page**

`DomainDeployStats.svelte` renders the four tiles — Deploys (with the window label), Failure rate, Mean duration, Last deploy — from `DomainDeploymentStats` and the newest log row. It renders `PanelGap` when the panel is not `ok`.

`DomainServiceDeploys.svelte` renders the per-service table: service, total, failure rate, sparkline. Worst rate first, which `rollUpDeployments` already sorted. **This is the panel that earns the tab** — "payment-gateway fails 16.7% over six deploys" is actionable where the domain's 5.9% is not.

The page follows Task 8's structure: breadcrumb, header from `getDomainHeader`, tabs, then tiles, the frequency chart (`LineChart` or `BarChart` from `$lib/components`), the per-service table, and the log.

Add `'deployments'` to `BUILT_TABS`.

- [ ] **Step 6: Move the estate read onto a sum over entities**

This is the riskiest edit in the plan. `readTrends` on the deployment router currently reads `deployment.trends`; with per-service rows being written it must sum every entity instead, including the legacy `''` — the two are never written for the same period, so nothing double-counts.

Add to `serviceTrendsShape`'s module a companion used by the estate path, and change the router's `readTrends` to rebuild from all entities. Assert it:

```ts
test('the estate figure is the sum of the services, including legacy rows', async () => {
	const source = routedDeploymentSource();
	const [estate, perService] = await Promise.all([
		source.readTrends(scope, 'daily'),
		source.readServiceTrends(scope, 'daily')
	]);

	const estateRuns = estate.frequency.points.reduce((sum, one) => sum + one.value, 0);
	const splitRuns = perService.reduce(
		(sum, row) => sum + row.runs.points.reduce((inner, one) => inner + one.value, 0),
		0
	);

	expect(estateRuns).toBe(splitRuns);
});
```

- [ ] **Step 7: Measure the budget before and after**

Run `bun test src/lib/server/platform/request-budget.test.ts src/lib/server/platform/warm-budget.test.ts` **before** the Step 6 edit and record the deployments numbers, then again after.

The deployments screen has already had one silent regression — both trends fell through the tier _and_ the cache for the whole of this project's life and nothing reported it. If the numbers move, stop and find out why before continuing.

Add a row for the new tab to both files:

```ts
test('domain deployments', async () => {
	expect(
		await cost((h) =>
			buildDomainDeploymentsSnapshot(
				h.routers.platform,
				h.routers.service,
				h.routers.deployment,
				scope,
				'payment-domain',
				h.now
			)
		)
	).toBeLessThan(70);
});
```

Set the threshold from the measured number plus headroom — do not guess it, and do not leave the measured figure out of the comment.

- [ ] **Step 8: Add to the sweeps and verify**

Add `'/domains/payment-domain/deployments'` to `ROUTES` in `e2e/harness.ts` and a `SCREENS` entry in `capability-gaps.test.ts`.

```bash
bun run build && bun test e2e/render.test.ts
```

- [ ] **Step 9: Run everything**

Run: `bun test src && bun run check && bun run lint`

- [ ] **Step 10: Commit**

```bash
git add src/lib src/routes e2e/harness.ts
git commit -m "feat: a domain's Deployments tab, and the per-service breakdown that earns it"
```

---

### Task 10: The SLOs tab

**Files:**

- Create: `src/routes/domains/[slug]/slos/+page.svelte`
- Create: `src/lib/components/domains/DomainSloTable.svelte`
- Modify: `src/lib/server/platform/domain-tabs-view.ts`, `domain-tabs-view.test.ts`, `service.ts`, `domains.remote.ts`, `[tab]/+page.ts`, `e2e/harness.ts`, both budget tests, `capability-gaps.test.ts`
- Modify: `src/lib/platform/types.ts`

**Interfaces:**

- Consumes: `ServiceSource.readSloBudget` (per service, exists), `PlatformSource.readDomainVitals` (exists).
- Produces: `buildDomainSlosSnapshot(platform, services, scope, slug, now)`; `getDomainSlos` remote query.

**The snapshot type:**

```ts
/** One service's objective as the domain's SLO tab lists it. */
export interface ServiceSloRow {
	slug: string;
	name: string;
	budget: SloBudget;
}

/** Everything the domain's SLOs tab renders. */
export interface DomainSlosSnapshot {
	generatedAt: string;
	domain: Domain;
	/**
	 * The domain's stated compliance, taken from `DomainVitals` and never recomputed.
	 *
	 * A tab that derived its own figure from the services would make a reader switching
	 * tabs watch the number move for no reason.
	 */
	headline: Panel<{ compliancePct: number; windowLabel: string }>;
	services: Panel<ServiceSloRow[]>;
}
```

- [ ] **Step 1: Write the failing test**

Append to `src/lib/server/platform/domain-tabs-view.test.ts`:

```ts
describe('the domain SLOs tab', () => {
	test('the headline is the header’s figure, not one derived from the services', async () => {
		// A reader switching between tabs must not watch compliance move.
		const [snapshot, vitals] = await Promise.all([
			buildDomainSlosSnapshot(platform, services, scope, 'payment-domain', now),
			platform.readDomainVitals(scope, 'payment-domain')
		]);

		expect(ok(snapshot!.headline).compliancePct).toBe(vitals!.sloCompliancePct);
		expect(ok(snapshot!.headline).windowLabel).toBe(vitals!.sloWindowLabel);
	});

	test('one row per service the domain runs', async () => {
		const snapshot = await buildDomainSlosSnapshot(
			platform,
			services,
			scope,
			'payment-domain',
			now
		);
		const domain = await platform.findDomain(scope, 'payment-domain');

		expect(ok(snapshot!.services).length).toBe(domain!.serviceCount);
	});

	test('no SLO source leaves the table a gap while the headline stands', async () => {
		const snapshot = await buildDomainSlosSnapshot(
			platform,
			withoutCapability(services, 'apm.slo'),
			scope,
			'payment-domain',
			now
		);

		expect(snapshot!.services.status).not.toBe('ok');
		expect(snapshot!.headline.status).toBe('ok');
	});

	test('an unknown domain is null', async () => {
		expect(await buildDomainSlosSnapshot(platform, services, scope, 'nope', now)).toBeNull();
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/server/platform/domain-tabs-view.test.ts`
Expected: FAIL — `buildDomainSlosSnapshot` is not exported.

- [ ] **Step 3: Write the assembler**

Append to `src/lib/server/platform/domain-tabs-view.ts`:

```ts
export async function buildDomainSlosSnapshot(
	platform: PlatformSource,
	services: ServiceSource,
	scope: PlatformScope,
	slug: string,
	now: Date = new Date()
): Promise<DomainSlosSnapshot | null> {
	const domain = await platform.findDomain(scope, slug);
	if (!domain) return null;

	const headline = await panel('apm.domainVitals', async () => {
		const vitals = await platform.readDomainVitals(scope, slug);
		if (!vitals) return { data: null };

		// Taken whole, never recomputed. The header prints the same two fields.
		return {
			data: { compliancePct: vitals.sloCompliancePct, windowLabel: vitals.sloWindowLabel }
		};
	});

	const rows = await panel('apm.slo', async () => {
		const vitals = await platform.readDomainVitals(scope, slug);
		const owned = vitals
			? await services.listServiceVitals(scope, domain.id, vitals, domain.serviceCount)
			: [];

		return {
			data: await Promise.all(
				owned.map(async (one) => ({
					slug: one.slug,
					name: one.name,
					budget: await services.readSloBudget(scope, one.slug)
				}))
			)
		};
	});

	return { generatedAt: now.toISOString(), domain, headline, services: rows };
}
```

- [ ] **Step 4: Add the service function and remote query**

```ts
// service.ts
export function readDomainSlos(scope: PlatformScope, slug: string) {
	return buildDomainSlosSnapshot(platformSource(), serviceSource(), scope, slug);
}

// domains.remote.ts
export const getDomainSlos = query(scopedServiceSchema, async ({ slug, ...scope }) =>
	readDomainSlos(scope, slug)
);
```

- [ ] **Step 5: Build the table and the page**

`DomainSloTable.svelte` takes `ServiceSloRow[]` and renders Service / Achieved / Target / Remaining / Burn, with the burn bar drawn from `budget.remainingPct`. Remaining prints `budget.remainingLabel` — the label travels with the number precisely so the panel and the API cannot round the same figure two ways.

The page puts the headline card above the table: compliance, its window label, and the target. Add `'slos'` to `BUILT_TABS`.

- [ ] **Step 6: Measure the N-reads cost**

`readSloBudget` is per service, so a domain with four services is four reads. It is `reference` tier and the store caches it, but the cold figure is what the budget test records.

Add rows to both budget files as in Task 9 Step 7, with the measured number in the comment.

- [ ] **Step 7: Add to the sweeps and verify**

Add `'/domains/payment-domain/slos'` to `ROUTES` and a `SCREENS` entry to `capability-gaps.test.ts`.

```bash
bun run build && bun test e2e/render.test.ts
```

- [ ] **Step 8: Run everything**

Run: `bun test src && bun run check && bun run lint`

- [ ] **Step 9: Commit**

```bash
git add src/lib src/routes e2e/harness.ts
git commit -m "feat: a domain's SLOs tab, pinned to the compliance the header states"
```

---

### Task 11: The public resources

**Files:**

- Create: `src/routes/api/v1/domains/[slug]/deployments/+server.ts`
- Create: `src/routes/api/v1/domains/[slug]/slo/+server.ts`
- Modify: `src/lib/server/api/v1/dto.ts`
- Modify: `src/lib/server/api/v1/dto.test.ts`
- Modify: `src/lib/server/api/v1/components.yaml` (regenerated, never hand-edited)

**Interfaces:**

- Consumes: `readDomainDeployments` (Task 9), `readDomainSlos` (Task 10).
- Produces: `toDomainDeploymentStatsDto`, `toServiceSloRowDto`.

Every new screen owes `/api/v1` its resources. `domains/{slug}/services` already exists and is the pattern to copy — including the `NotFoundError` for an unknown slug and `parseScope(url.searchParams)`.

- [ ] **Step 1: Write the failing DTO test**

Append to `src/lib/server/api/v1/dto.test.ts`:

```ts
describe('domain deployment stats', () => {
	test('publishes counts and seconds, never a rendered string', () => {
		const dto = toDomainDeploymentStatsDto(stats);

		expect(typeof dto.meanDurationSeconds).toBe('number');
		expect(typeof dto.total).toBe('number');
		expect(typeof dto.failures).toBe('number');
		// "4m 12s" is how our UI draws it and means nothing to another client.
		expect(Object.values(dto).every((one) => typeof one !== 'string' || !one.includes('m '))).toBe(
			true
		);
	});

	test('the per-service rows carry both counts, so a caller can re-derive the rate', () => {
		const dto = toDomainDeploymentStatsDto(stats);

		for (const row of dto.byService) {
			expect(typeof row.total).toBe('number');
			expect(typeof row.failures).toBe('number');
		}
	});

	test('no sparkline bounds travel', () => {
		// Presentation. `min`/`max` are how our chart scales an axis.
		const dto = toDomainDeploymentStatsDto(stats);
		expect('frequency' in dto && 'min' in (dto.frequency as object)).toBe(false);
	});
});

describe('domain SLO rows', () => {
	test('publishes minutes, not "21m"', () => {
		const dto = toServiceSloRowDto(row);

		expect(typeof dto.remainingMinutes).toBe('number');
		expect('remainingLabel' in dto).toBe(false);
	});
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bun test src/lib/server/api/v1/dto.test.ts`
Expected: FAIL — the mappers are not exported.

- [ ] **Step 3: Write the mappers**

In `src/lib/server/api/v1/dto.ts`, following the existing mappers' shape. Strip `icon`, `accent`, series bounds and every pre-formatted string; keep `total`, `failures`, `changeFailureRatePct`, `meanDurationSeconds`, the frequency points as `{label, value}`, and the per-service rows.

For the SLO row keep `achievedPct`, `targetPct`, `remainingPct`, `remainingMinutes`, `burnPct` — and drop `remainingLabel` and `burnWindowLabel`, which are renderings.

- [ ] **Step 4: Write the two routes**

Copy the structure of `src/routes/api/v1/domains/[slug]/services/+server.ts` exactly, including the `@swagger` block. Watch the YAML rules: use `>-` folded scalars for any description with punctuation, because an unquoted colon ends the scalar and `swagger-jsdoc` skips a broken block **silently**.

`operationId`s: `readDomainDeployments` and `readDomainSlo`. Both must be unique across the document — `openapi.test.ts` asserts it.

- [ ] **Step 5: Regenerate the components**

```bash
bun run openapi:components
```

Never hand-edit `components.yaml`. `openapi.test.ts` regenerates it in memory and fails if the committed file disagrees.

- [ ] **Step 6: Run the tests**

Run: `bun test src/lib/server/api && bun run check && bun run lint`
Expected: PASS — including the annotation checks, which catch a route under `/api/v1` with no `@swagger` block and a `$ref` pointing at a component that does not exist.

- [ ] **Step 7: Commit**

```bash
git add src/routes/api/v1/domains src/lib/server/api/v1
git commit -m "feat: publish a domain's deployment figures and its SLO budgets"
```

---

### Task 12: Documentation and the stale sweep comment

**Files:**

- Modify: `CLAUDE.md`
- Modify: `src/lib/server/platform/capability-gaps.test.ts`
- Modify: `docs/todo/unbuilt-screen-sections.md`
- Delete: nothing

- [ ] **Step 1: Fix the sweep's own doc comment**

`capability-gaps.test.ts` still states the superseded rule in its header:

> A screen falls over only when the source kind it is _dedicated to_ cannot answer.

That exemption was removed — the test enforces "no screen falls over, full stop", and the paragraph beneath it still argues for the rule the code no longer applies. The same stale-comment family as the one just fixed in `CLAUDE.md`. Rewrite the header to describe what the test actually asserts, keeping the history of why it changed.

- [ ] **Step 2: Update the State section of CLAUDE.md**

Record the three new routes, the two new API paths (bringing the count from thirty-four to thirty-six), the new remote functions, and the measured test count from `bun test src`. Take every number from a command's output — the three stale counts fixed in `d91c5ab` got there by being written from memory.

- [ ] **Step 3: Add the accumulation note to CLAUDE.md**

Under "What the store buys, and what it cannot", record the per-service accumulation: why a domain is a sum of its services rather than a wider `readTrends`, that `failure_count` is stored because a rate cannot be re-aggregated from rates, and ~~that the estate read sums every entity including the legacy `''`~~ — SUPERSEDED by the Task 9 finding, see the note at this plan's Global Constraints above and `docs/superpowers/specs/2026-09-15-domain-tabs-design.md`'s "Corrections during implementation" section for what the estate read does instead.

Add the measured budget figures for the three new screens to the table.

- [ ] **Step 4: Update the todo file**

`docs/todo/unbuilt-screen-sections.md` states "Domain detail 2 of 8". It is now 5 of 8. Update the table and note that Alerts, Infrastructure and Logs each have their own spec pending.

- [ ] **Step 5: Run the full gate**

```bash
bun test src && bun run check && bun run lint && bun run build && bun test e2e
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/todo src/lib/server/platform/capability-gaps.test.ts
git commit -m "docs: record the domain tabs and the per-service accumulation"
```

---

## Self-review

**Spec coverage.** Every section of the spec maps to a task: the shared header query (7), real routes with one canonical URL (8, 9, 10 via `BUILT_TABS`), per-service accumulation (1–5), the `ServiceTrend` shape and `failure_count` (1, 3), attribution to `(unattributed)` (1), one accumulation per connection (5, noted as a temporary exception until 9), the estate summing every entity (9 Step 6), the three tab designs (8, 9, 10), the pinned SLO headline (10), the two API paths (11), `panel()` on every source-backed read (9, 10), and the full testing matrix (unit throughout, tiers in 2, sweep in 8/9/10, budgets in 9/10, e2e in 8/9/10).

**Risks the spec names are each carried by a step.** The pinned headline has its own test in Task 10 Step 1. The estate-path regression has a before-and-after measurement in Task 9 Step 7. Row volume is stated in the spec and needs no code.

**Known ordering constraint.** Task 2 leaves `bun run check` failing until Tasks 4 and 5 land — `DeploymentSource` gains a method every implementation must provide. This is called out in Task 2 Step 7 rather than left to surprise an implementer. Tasks 1–7 are strictly sequential; 8, 9 and 10 are independent of each other once 7 lands; 11 depends on 9 and 10; 12 is last.
