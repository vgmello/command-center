import { describe, expect, test } from 'bun:test';
import { octopusMockHandler } from './mock/server';
import { buildEstate } from './mock/data';
import { buildSources } from '../../boot';
import { FixturePlatformSource } from '../../../platform/fixture-source';
import { FixtureCatalogSource } from '../../../catalog/fixture-source';
import { buildDeploymentsSnapshot } from '../../../platform/deployments-view';
import type { PlatformScope } from '$lib/platform/query';

/**
 * How many upstream requests one screen costs.
 *
 * Six deployment capabilities are computed from one window of deployments, and each is a
 * separate capability with its own cache entry — so each was independently paging the same
 * four hundred rows. Drawing the deployments page cost 216 requests against an API with a
 * low rate limit.
 *
 * The cache above cannot fix that: it keys on capability, and these are six different
 * capabilities that happen to share an origin. Only the provider knows they do.
 */

const scope: PlatformScope = { environment: 'production', timeRange: '24h' };

/** A mock that counts, and the routers pointed at it. */
function build() {
	const estate = buildEstate({ now: new Date(), count: 400 });
	const inner = octopusMockHandler({ estate, apiKey: 'k' });

	let calls = 0;
	const server = Bun.serve({
		port: 0,
		fetch: (request) => {
			calls++;
			return inner(request);
		}
	});

	const routers = buildSources({
		config: {
			connections: [
				{
					id: 'oct',
					provider: 'octopus',
					label: 'Octopus',
					settings: {
						baseUrl: `http://localhost:${server.port}`,
						apiKey: 'k',
						spaceId: 'Spaces-1',
						windowSize: 400
					}
				}
			]
		},
		env: {},
		catalog: { platform: new FixturePlatformSource(), services: new FixtureCatalogSource() }
	});

	return { routers, count: () => calls, reset: () => (calls = 0), stop: () => server.stop(true) };
}

describe('one window, many capabilities', () => {
	test('a whole deployments page costs far fewer requests than it did', async () => {
		const harness = build();

		try {
			harness.reset();
			await buildDeploymentsSnapshot(harness.routers.deployment, scope, 'daily', new Date());

			// It was 216 before the window was shared. The bound is generous on purpose:
			// this pins the order of magnitude, not an exact count that would break the
			// moment a page size or a batch changed.
			expect(harness.count()).toBeLessThan(80);
		} finally {
			harness.stop();
		}
	});

	test('the six aggregates read one window rather than six', async () => {
		const harness = build();

		try {
			// Warm it once so the comparison is about sharing, not about a cold start.
			await harness.routers.deployment.readSummary(scope);
			harness.reset();

			await Promise.all([
				harness.routers.deployment.readDomainBreakdown(scope),
				harness.routers.deployment.readStatusTrend(scope),
				harness.routers.deployment.readTrends(scope, 'daily'),
				harness.routers.deployment.listDeployingDomains(scope)
			]);

			// Every one of them is computed from the window the first read already paid for.
			expect(harness.count()).toBe(0);
		} finally {
			harness.stop();
		}
	});

	test('a small read on a cold connection stays small', async () => {
		// The overview wants eight recent deployments and nothing else. Fetching four
		// hundred to show eight would be a worse trade than the one sharing exists to make.
		const harness = build();

		try {
			harness.reset();
			await harness.routers.deployment.listDeployments(scope, 8);

			expect(harness.count()).toBeLessThan(15);
		} finally {
			harness.stop();
		}
	});

	test('the answers are still right, not merely cheap', async () => {
		const harness = build();

		try {
			const snapshot = await buildDeploymentsSnapshot(
				harness.routers.deployment,
				scope,
				'daily',
				new Date()
			);

			expect(snapshot.summary.total).toBeGreaterThan(0);
			expect(snapshot.recent.length).toBeGreaterThan(0);
			expect(snapshot.byDomain.slices.length).toBeGreaterThan(0);
			// The parts still add up to the whole they are drawn from.
			expect(
				snapshot.summary.successful + snapshot.summary.failed + snapshot.summary.inProgress
			).toBe(snapshot.summary.total);
		} finally {
			harness.stop();
		}
	});
});
