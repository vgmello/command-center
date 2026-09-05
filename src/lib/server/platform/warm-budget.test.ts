import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { coralogixMockHandler } from '../sources/providers/coralogix/mock/server';
import { buildEstate as cxEstate } from '../sources/providers/coralogix/mock/data';
import { octopusMockHandler } from '../sources/providers/octopus/mock/server';
import { buildEstate as octEstate } from '../sources/providers/octopus/mock/data';
import { buildSources } from '../sources/boot';
import { FixturePlatformSource } from './fixture-source';
import { FixtureCatalogSource } from '../catalog/fixture-source';
import { PostgresSourceStore } from '../store/postgres-store';
import {
	dockerAvailable,
	startPostgres,
	type PostgresContainer
} from '../store/testing/postgres-container';
import { buildOverview } from './snapshot';
import { buildDomainsSnapshot } from './domains-view';
import { buildDomainSnapshot } from './domain-view';
import { buildDeploymentsSnapshot } from './deployments-view';
import { buildServiceSnapshot } from './service-view';
import { buildServiceMetricsSnapshot } from './service-metrics-view';
import { buildInfrastructureSnapshot } from './infrastructure-view';
import type { PlatformScope } from '$lib/platform/query';

/**
 * What a screen costs the *second* time.
 *
 * `request-budget.test.ts` measures a cold cache with no database, which is the worst
 * case and the only one that had ever been counted. It is not the normal one: a running
 * deployment has a store, and the question that actually decides whether this app fits
 * inside a low rate limit is what a second page view costs — the one served after a
 * redeploy, or by a second instance that never warmed its own memory.
 *
 * So the second read here gets fresh routers deliberately. Reusing them would measure the
 * memory tier, which is already known to answer in zero requests and is lost on every
 * restart. An empty memory tier over a warm store is the state a real instance spends
 * almost all of its life in.
 *
 * The reference and series tiers persist; the live tier does not, by design — a number
 * read back off disk is already stale. So the floor these budgets sit on is the live
 * capabilities each screen needs, and it is not zero.
 */

const available = await dockerAvailable();
const describeWarm = available ? describe : describe.skip;

if (!available) {
	console.warn('[warm-budget] Docker unavailable — warm cache budgets skipped.');
}

let container: PostgresContainer;
let store: PostgresSourceStore;

const scope: PlatformScope = { environment: 'production', timeRange: '1h' };

beforeAll(async () => {
	if (!available) return;

	container = await startPostgres();
	store = new PostgresSourceStore(container.url);
	await migrate(store.db, { migrationsFolder: './drizzle' });
}, 120_000);

afterAll(async () => {
	await store?.close();
	await container?.stop();
});

/**
 * One pair of counting mocks, and routers that can be rebuilt against them.
 *
 * The servers outlive the routers on purpose: the two reads have to be counted against
 * the same upstream for the comparison to mean anything.
 */
function harness() {
	const now = new Date();
	const counts = { n: 0 };

	const cx = coralogixMockHandler({
		estate: cxEstate({ now, points: 2000, stepSeconds: 60 }),
		apiKey: 'k'
	});
	const oct = octopusMockHandler({ estate: octEstate({ now, count: 400 }), apiKey: 'k' });

	const cxServer = Bun.serve({
		port: 0,
		fetch: (request) => (counts.n++, cx(request))
	});
	const octServer = Bun.serve({
		port: 0,
		fetch: (request) => (counts.n++, oct(request))
	});

	const build = () =>
		buildSources({
			config: {
				connections: [
					{
						id: 'cx',
						provider: 'coralogix',
						label: 'Coralogix',
						settings: { baseUrl: `http://localhost:${cxServer.port}`, apiKey: 'k' }
					},
					{
						id: 'oct',
						provider: 'octopus',
						label: 'Octopus',
						settings: {
							baseUrl: `http://localhost:${octServer.port}`,
							apiKey: 'k',
							spaceId: 'Spaces-1',
							windowSize: 400
						}
					},
					{ id: 'fc', provider: 'fixture-cloud', label: 'Fixture Cloud', settings: {} }
				]
			},
			env: { SOURCES_ALLOW_FIXTURES: 'true' },
			catalog: { platform: new FixturePlatformSource(), services: new FixtureCatalogSource() },
			store
		});

	return {
		build,
		now,
		count: () => counts.n,
		reset: () => (counts.n = 0),
		stop: () => {
			cxServer.stop(true);
			octServer.stop(true);
		}
	};
}

type Routers = ReturnType<ReturnType<typeof harness>['build']>;

/** Draw the screen twice, through two different sets of routers over one store. */
async function coldThenWarm(
	run: (routers: Routers, now: Date) => Promise<unknown>
): Promise<{ cold: number; warm: number }> {
	const h = harness();

	try {
		h.reset();
		await run(h.build(), h.now);
		const cold = h.count();

		h.reset();
		await run(h.build(), h.now);
		const warm = h.count();

		return { cold, warm };
	} finally {
		h.stop();
	}
}

const SCREENS: Array<{ name: string; run: (r: Routers, now: Date) => Promise<unknown> }> = [
	{
		name: 'overview',
		run: (r, now) => buildOverview(r.platform, r.deployment, r.infrastructure, scope, now)
	},
	{ name: 'domains', run: (r, now) => buildDomainsSnapshot(r.platform, r.deployment, scope, now) },
	{
		name: 'domain detail',
		run: (r, now) =>
			buildDomainSnapshot(r.platform, r.service, r.deployment, scope, 'payment-domain', now)
	},
	{
		name: 'deployments',
		run: (r, now) => buildDeploymentsSnapshot(r.deployment, scope, 'daily', now)
	},
	{
		name: 'service detail',
		run: (r, now) => buildServiceSnapshot(r.service, r.deployment, scope, 'payment-api', now)
	},
	{
		name: 'service metrics',
		run: (r, now) => buildServiceMetricsSnapshot(r.service, scope, 'payment-api', now)
	},
	{
		name: 'infrastructure',
		run: (r, now) => buildInfrastructureSnapshot(r.infrastructure, scope, now)
	}
];

/** Measured, not estimated. A ceiling with headroom, for the reasons the cold budgets give. */
const WARM_CEILING: Record<string, number> = {
	overview: 22,
	domains: 18,
	'domain detail': 14,
	// Not a typo, and the number this file exists to explain — see the test below.
	deployments: 50,
	'service detail': 33,
	'service metrics': 18,
	infrastructure: 5
};

describeWarm('what a screen costs the second time', () => {
	for (const screen of SCREENS) {
		test(`${screen.name} stays within its warm budget`, async () => {
			const { cold, warm } = await coldThenWarm(screen.run);

			// The store must never make a screen more expensive. Less obvious than it
			// sounds: a gap fetch that asked for the wrong window, or a cache key that
			// varied between reads, would surface here as a warm count above the cold one.
			expect(warm).toBeLessThanOrEqual(cold);
			expect(warm).toBeLessThanOrEqual(WARM_CEILING[screen.name]);
		});
	}
});

describeWarm('what the store actually buys', () => {
	test('a warm instance serves the persisted aggregates without asking anyone', async () => {
		// The sharp assertion in this file. The three deployment aggregates are `reference`
		// tier, so a second instance must answer all three from Postgres having never
		// spoken to Octopus. A tier reclassified, a cache key that varied per instance, or
		// a store write silently swallowed would all show up here as a non-zero count —
		// and nowhere else, because the whole-page numbers are dominated by the window.
		const h = harness();

		try {
			await h.build().deployment.readSummary(scope);
			// The write is fire-and-forget, so let it land before a fresh instance looks.
			await Bun.sleep(400);

			const warm = h.build();
			h.reset();

			await warm.deployment.readSummary(scope);
			await warm.deployment.readDomainBreakdown(scope);
			await warm.deployment.listDeployingDomains(scope);

			expect(h.count()).toBe(0);
		} finally {
			h.stop();
		}
	});

	test('and cannot help the live log, which is why the deployments page does not improve', async () => {
		// The finding this file was written to record. The deployments page costs one
		// window of four hundred rows, and the window sits behind `deployment.log` — a
		// `live` capability, deliberately never persisted, because a deployment feed read
		// back off disk is a feed that has stopped reporting.
		//
		// Everything else on that page is computed from the window in memory, so the store
		// saves nothing there: the aggregates it holds were already free once the window
		// existed. Making that page cheaper means fetching the log incrementally against a
		// high-water mark, the way the series path already does — settled history never
		// changes, so only entries newer than the last one need fetching. That is its own
		// increment; this test is here so the reason is not rediscovered from scratch.
		const h = harness();

		try {
			await h.build().deployment.listDeployments(scope, 8);
			await Bun.sleep(400);

			const warm = h.build();
			h.reset();
			await warm.deployment.listDeployments(scope, 8);

			expect(h.count()).toBeGreaterThan(0);
		} finally {
			h.stop();
		}
	});
});
