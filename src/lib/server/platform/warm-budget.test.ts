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
import { buildDomainDeploymentsSnapshot } from './domain-tabs-view';
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
		name: 'domain deployments',
		run: (r, now) =>
			buildDomainDeploymentsSnapshot(
				r.platform,
				r.service,
				r.deployment,
				scope,
				'payment-domain',
				now
			)
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
	// Was 14 while the page 404'd on absent vitals; it renders now. See request-budget.
	'domain detail': 60,
	// Was 45 warm, which is why any of this file exists — then 6 once the trends became
	// documents, then 12 once they became accumulated series. Higher than 6 and better
	// than it: a document served the whole answer back, while a day-bucketed series keeps
	// the newest day provisional and asks for one page of it, in exchange for the three
	// grains sharing rows at all. Unmoved at 48 cold / 12 warm by the estate read being
	// rewired onto the per-service rows, which is the point: it is the same window, read
	// once, under one capability instead of two.
	deployments: 16,
	// Measured at 50 cold and 50 warm, and the two being equal is the honest answer rather
	// than a regression: the tab's cost is its *log*, which is `live` tier and deliberately
	// never persisted — a deployment feed read back off disk is a feed that has stopped
	// reporting. Octopus cannot filter by domain, so that read walks the window. The
	// per-service trends accumulate and are all but free warm; they are simply not what this
	// number is made of. Same profile as `domain detail` above, for the same reason.
	'domain deployments': 60,
	'service detail': 33,
	'service metrics': 16,
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

	test('the store costs three requests cold, and the reason is not the store', async () => {
		// Cold went 45 to 48 when the two trend capabilities became documents, which looks
		// like the store charging for itself. It is not. Counted by endpoint, the extra is
		// one more page of the deployment window — fifteen instead of fourteen, at three
		// requests each — and the catalogue is unchanged at three.
		//
		// The deployments page makes six reads that need the whole window and one bounded
		// read for the eight recent rows. The provider keeps bounded reads bounded, which
		// is right for the overview (it wants eight and nothing else) and redundant here
		// (the window is loading regardless). Whether the bounded read reuses the window
		// depends on which starts first, and the store's Postgres round trip changes that
		// order.
		//
		// Left alone deliberately. Making the bounded read join the window would cost the
		// overview four hundred rows to show eight, and awaiting an aggregate first would
		// add a round trip to every load, warm included. Three cold requests once per
		// deploy against thirty-nine saved on every view after it is the better side of
		// that trade — but it should be understood rather than mysterious.
		// A scope no earlier test in this file has touched. The store is shared across the
		// whole file, so `production` is already warm by the time this runs and a "cold"
		// read of it would not be cold at all.
		const fresh: PlatformScope = { environment: 'staging', timeRange: '1h' };
		const { cold, warm } = await coldThenWarm((routers, now) =>
			buildDeploymentsSnapshot(routers.deployment, fresh, 'daily', now)
		);

		expect(cold - warm).toBeGreaterThan(30);
		expect(cold).toBeLessThan(55);
	});

	test('the live log stays cheap, so it is not what the page is paying for', async () => {
		// Worth pinning because it is the obvious suspect and it is the wrong one. The log
		// is `live` tier and deliberately never persisted — a deployment feed read back off
		// disk is a feed that has stopped reporting — so it does cost requests warm. It
		// costs few: one page of rows plus the provider's catalogue.
		const h = harness();

		try {
			await h.build().deployment.listDeployments(scope, 8);
			await Bun.sleep(400);

			const warm = h.build();
			h.reset();
			await warm.deployment.listDeployments(scope, 8);

			expect(h.count()).toBeGreaterThan(0);
			expect(h.count()).toBeLessThan(12);
		} finally {
			h.stop();
		}
	});

	test('the two deployment series accumulate, so a warm read asks for almost nothing', async () => {
		// They used to cost 45 each. Both were declared `series` while `fanOutSeries` was
		// called for neither, so they fell through the cache and the accumulator alike and
		// re-fetched a four-hundred-row window every time.
		const h = harness();

		try {
			await h.build().deployment.readTrends(scope, 'daily');
			await h.build().deployment.readStatusTrend(scope);
			await Bun.sleep(400);

			const warm = h.build();
			h.reset();

			await warm.deployment.readTrends(scope, 'daily');
			await warm.deployment.readStatusTrend(scope);

			// Not zero: a day-bucketed series keeps the newest day provisional, so a warm
			// read still asks for the gap. It asks for one page of it, not fourteen.
			expect(h.count()).toBeLessThan(10);
		} finally {
			h.stop();
		}
	});

	test('a different grain reads the same stored rows, which is the point of accumulating', async () => {
		// The property this increment exists to create, and the one a whole-answer cache
		// cannot fake. `grain=daily` used to be part of the cache key, so asking for weekly
		// was a different question and paid the full 48 again — even though both are the
		// same runs counted differently.
		const h = harness();

		try {
			await h.build().deployment.readTrends(scope, 'daily');
			await Bun.sleep(400);

			const warm = h.build();
			h.reset();
			await warm.deployment.readTrends(scope, 'weekly');

			// Weekly looks back further than daily, so some of its window is genuinely new;
			// what it must not do is re-read the fortnight daily already stored.
			expect(h.count()).toBeLessThan(48);
		} finally {
			h.stop();
		}
	});
});
