import { describe, expect, test } from 'bun:test';
import { coralogixMockHandler } from '../sources/providers/coralogix/mock/server';
import { buildEstate as cxEstate } from '../sources/providers/coralogix/mock/data';
import { octopusMockHandler } from '../sources/providers/octopus/mock/server';
import { buildEstate as octEstate } from '../sources/providers/octopus/mock/data';
import { buildSources } from '../sources/boot';
import { FixturePlatformSource } from './fixture-source';
import { FixtureCatalogSource } from '../catalog/fixture-source';
import { buildOverview } from './snapshot';
import { buildDomainsSnapshot } from './domains-view';
import { buildDomainSnapshot } from './domain-view';
import { buildDeploymentsSnapshot } from './deployments-view';
import { buildServiceSnapshot } from './service-view';
import { buildServiceMetricsSnapshot } from './service-metrics-view';
import { buildInfrastructureSnapshot } from './infrastructure-view';
import type { PlatformScope } from '$lib/platform/query';

/**
 * What each screen costs upstream, on a cold cache.
 *
 * Counted rather than reasoned about, because reasoning got it wrong twice: the
 * deployments page cost 216 requests and one service page cost 45, and nobody suspected
 * either until they were measured. These budgets exist so a change that quietly
 * multiplies the traffic to a rate-limited API fails here rather than in production.
 *
 * The numbers are ceilings with headroom, not exact counts — an exact count would break
 * the moment a page size or a batch changed, and that is noise rather than signal.
 */

const scope: PlatformScope = { environment: 'production', timeRange: '1h' };

function harness() {
	const now = new Date();
	const counts = { coralogix: 0, octopus: 0 };

	const cx = coralogixMockHandler({
		estate: cxEstate({ now, points: 2000, stepSeconds: 60 }),
		apiKey: 'k'
	});
	const oct = octopusMockHandler({ estate: octEstate({ now, count: 400 }), apiKey: 'k' });

	const cxServer = Bun.serve({
		port: 0,
		fetch: (request) => {
			counts.coralogix++;
			return cx(request);
		}
	});

	const octServer = Bun.serve({
		port: 0,
		fetch: (request) => {
			counts.octopus++;
			return oct(request);
		}
	});

	// A fresh set of routers per screen: an empty cache is what a deploy produces, and a
	// budget measured against a warm one would measure nothing.
	const routers = buildSources({
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
		catalog: { platform: new FixturePlatformSource(), services: new FixtureCatalogSource() }
	});

	return {
		routers,
		now,
		total: () => counts.coralogix + counts.octopus,
		stop: () => {
			cxServer.stop(true);
			octServer.stop(true);
		}
	};
}

/** Run one screen and report what it cost. */
async function cost(run: (h: ReturnType<typeof harness>) => Promise<unknown>): Promise<number> {
	const h = harness();

	try {
		await run(h);
		return h.total();
	} finally {
		h.stop();
	}
}

describe('what a screen costs upstream', () => {
	test('overview', async () => {
		expect(
			await cost((h) =>
				buildOverview(
					h.routers.platform,
					h.routers.deployment,
					h.routers.infrastructure,
					scope,
					h.now
				)
			)
		).toBeLessThan(40);
	});

	test('domains', async () => {
		// Its one deployment figure is a bounded window, so it must not walk the estate's
		// whole history to count today.
		expect(
			await cost((h) =>
				buildDomainsSnapshot(h.routers.platform, h.routers.deployment, scope, h.now)
			)
		).toBeLessThan(30);
	});

	test('domain detail', async () => {
		expect(
			await cost((h) =>
				buildDomainSnapshot(
					h.routers.platform,
					h.routers.service,
					h.routers.deployment,
					scope,
					'payment-domain',
					h.now
				)
			)
		).toBeLessThan(25);
	});

	test('deployments', async () => {
		// Six capabilities computed from one window. It was 216 before they shared it.
		expect(
			await cost((h) => buildDeploymentsSnapshot(h.routers.deployment, scope, 'daily', h.now))
		).toBeLessThan(80);
	});

	test('service detail', async () => {
		// One service's deployment history is pushed down as a project filter. It was 66
		// when the whole window was loaded to show five rows.
		expect(
			await cost((h) =>
				buildServiceSnapshot(h.routers.service, h.routers.deployment, scope, 'payment-api', h.now)
			)
		).toBeLessThan(45);
	});

	test('service metrics', async () => {
		expect(
			await cost((h) => buildServiceMetricsSnapshot(h.routers.service, scope, 'payment-api', h.now))
		).toBeLessThan(35);
	});

	test('infrastructure', async () => {
		// Served entirely by the fixture cloud provider, which is in-process.
		expect(
			await cost((h) => buildInfrastructureSnapshot(h.routers.infrastructure, scope, h.now))
		).toBeLessThan(20);
	});
});

describe('every screen renders, not merely cheaply', () => {
	test('each one produces the snapshot it promises', async () => {
		const h = harness();

		try {
			const [overview, domains, deployments] = await Promise.all([
				buildOverview(
					h.routers.platform,
					h.routers.deployment,
					h.routers.infrastructure,
					scope,
					h.now
				),
				buildDomainsSnapshot(h.routers.platform, h.routers.deployment, scope, h.now),
				buildDeploymentsSnapshot(h.routers.deployment, scope, 'daily', h.now)
			]);

			expect(overview.counts.length).toBeGreaterThan(0);
			expect(domains.counts.length).toBeGreaterThan(0);
			expect(deployments.summary.total).toBeGreaterThan(0);
		} finally {
			h.stop();
		}
	});
});
