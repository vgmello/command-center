import { describe, expect, test } from 'bun:test';
import { SERVICE_ENDPOINT_LIMIT, buildServiceSnapshot } from './service-view';
import { FixtureDeploymentSource, FixtureServiceSource } from './fixture-source';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const services = new FixtureServiceSource();
const deployments = new FixtureDeploymentSource();

const build = (slug: string) => buildServiceSnapshot(services, deployments, scope, slug);

describe('buildServiceSnapshot', () => {
	test('an unknown slug is null, not a throw — an edited URL is not an outage', async () => {
		expect(await build('no-such-service')).toBeNull();
	});

	test('carries the scope it was assembled for', async () => {
		const snapshot = await buildServiceSnapshot(
			services,
			deployments,
			scope,
			'payment-api',
			new Date(0)
		);

		expect(snapshot?.environment).toBe('production');
		expect(snapshot?.generatedAt).toBe(new Date(0).toISOString());
	});

	test('the deployment history is the deployment log, narrowed to this service', async () => {
		const snapshot = await build('payment-api');

		expect(snapshot!.deployments.length).toBeGreaterThan(1);
		expect(snapshot!.deployments.every((one) => one.service === 'payment-api')).toBe(true);
	});

	test('the match is exact, so a sibling service is not counted as this one', async () => {
		// `payment-gateway` contains no substring collision, but `payment-api` is a
		// prefix of nothing else only by luck — the filter must not depend on that.
		const gateway = await build('payment-gateway');

		expect(gateway!.deployments.every((one) => one.service === 'payment-gateway')).toBe(true);
		expect(gateway!.deployments.some((one) => one.service === 'payment-api')).toBe(false);
	});

	test('honours the endpoint limit rather than trusting the source to slice', async () => {
		const snapshot = await build('payment-api');

		expect(snapshot?.endpoints.length).toBeLessThanOrEqual(SERVICE_ENDPOINT_LIMIT);
	});

	test('every stat tile is one of the four known kinds', async () => {
		const snapshot = await build('payment-api');
		const kinds = new Set(snapshot?.stats.map((stat) => stat.kind));

		expect([...kinds].every((kind) => ['trend', 'gauge', 'ratio', 'link'].includes(kind))).toBe(
			true
		);
	});

	test('the alerts tile offers a link only when there is something to look at', async () => {
		const busy = await build('payment-api');
		const quiet = await build('order-service');

		const alertTile = (
			stats: typeof busy extends null ? never : NonNullable<typeof busy>['stats']
		) => stats.find((stat) => stat.id === 'alerts');

		const busyTile = alertTile(busy!.stats);
		const quietTile = alertTile(quiet!.stats);

		expect(busyTile?.kind === 'link' && busyTile.action).not.toBeNull();
		expect(quietTile?.kind === 'link' && quietTile.action).toBeNull();
	});

	test('the instance tile agrees with the service it describes', async () => {
		const snapshot = await build('inventory-service');
		const tile = snapshot!.stats.find((stat) => stat.id === 'instances');

		expect(tile?.kind).toBe('ratio');
		if (tile?.kind !== 'ratio') throw new Error('unreachable');
		expect(tile.value).toBe(snapshot!.service.instancesHealthy);
		expect(tile.total).toBe(snapshot!.service.instancesTotal);
	});

	test('a service inherits its domain identity rather than inventing one', async () => {
		const snapshot = await build('payment-api');

		expect(snapshot?.service.domainName).toBe('Payment Domain');
		expect(snapshot?.service.accent).toBe('blue');
	});

	test('dependencies stay one hop each way', async () => {
		const snapshot = await build('payment-api');
		const panel = snapshot!.dependencies;

		// A `Panel`, because a source may have no service map at all. Against the fixture
		// it always answers, and asserting that is what would catch it silently becoming
		// a gap.
		expect(panel.status).toBe('ok');
		const graph = (panel as Extract<typeof panel, { status: 'ok' }>).data;

		expect(graph.upstream.length).toBeGreaterThan(0);
		expect(graph.downstream.length).toBeGreaterThan(0);
		// Every node names the protocol, because a name does not imply one.
		const all = [...graph.upstream, ...graph.downstream];
		expect(all.every((node) => node.protocol.length > 0)).toBe(true);
	});

	test('endpoint bars are shares of the slowest, so the worst one fills the bar', async () => {
		const snapshot = await build('payment-api');
		const [slowest] = snapshot!.endpoints;

		expect(slowest.latencySharePct).toBe(100);
		expect(
			snapshot!.endpoints.every((one) => one.latencySharePct <= 100 && one.latencySharePct >= 0)
		).toBe(true);
		// Ranked, so the table needs no sort of its own.
		const latencies = snapshot!.endpoints.map((one) => one.p95LatencyMs);
		expect(latencies).toEqual([...latencies].sort((a, b) => b - a));
	});
});
