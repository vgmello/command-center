import { describe, expect, test } from 'bun:test';
import {
	RECENT_DEPLOYMENT_LIMIT,
	buildDeploymentTiles,
	buildDeploymentsSnapshot,
	buildRateTiles
} from './deployments-view';
import { FixtureDeploymentSource, FixturePlatformSource } from './fixture-source';
import { matchesDeploymentState } from '$lib/platform/deployments';
import type { DeploymentSummary } from '$lib/platform/types';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const source = new FixtureDeploymentSource();

const summary = (overrides: Partial<DeploymentSummary> = {}): DeploymentSummary => ({
	total: 29,
	domainCount: 6,
	successful: 24,
	inProgress: 3,
	failed: 2,
	meanDurationSeconds: 402,
	changeFailureRatePct: 6.9,
	meanDurationChangePct: -18,
	changeFailureRateChangePct: -0.6,
	totalChangePct: 26,
	...overrides
});

describe('buildDeploymentTiles', () => {
	test('the status counts add up to the total', () => {
		const [total, ...statuses] = buildDeploymentTiles(summary());

		expect(total.value).toBe(29);
		expect(statuses.reduce((sum, tile) => sum + tile.value, 0)).toBe(29);
	});

	test('a run in flight is tinted as in flight, not as an outcome it has not reached', () => {
		const inProgress = buildDeploymentTiles(summary()).find((tile) => tile.id === 'in-progress');

		expect(inProgress?.tone).toBe('info');
	});

	test('the failure tile goes quiet when nothing failed', () => {
		const failed = buildDeploymentTiles(summary({ failed: 0 })).find(
			(tile) => tile.id === 'failed'
		);

		expect(failed?.tone).toBe('healthy');
	});

	test('an empty day divides by nothing rather than by zero', () => {
		const tiles = buildDeploymentTiles(
			summary({ total: 0, successful: 0, inProgress: 0, failed: 0, domainCount: 0 })
		);

		expect(tiles.every((tile) => Number.isFinite(tile.percentage ?? 0))).toBe(true);
	});
});

describe('buildRateTiles', () => {
	test('a falling mean duration reads as an improvement', () => {
		const [duration] = buildRateTiles(summary());

		expect(duration.formatted).toBe('6m 42s');
		expect(duration.direction).toBe('down');
		expect(duration.polarity).toBe('lower-is-better');
	});

	test('the failure rate prints one decimal, which is what distinguishes 6.9 from 7', () => {
		const [, failure] = buildRateTiles(summary());

		expect(failure.formatted).toBe('6.9%');
	});
});

describe('buildDeploymentsSnapshot', () => {
	test('carries the scope it was assembled for', async () => {
		const snapshot = await buildDeploymentsSnapshot(source, scope, 'daily', new Date(0));

		expect(snapshot.environment).toBe('production');
		expect(snapshot.generatedAt).toBe(new Date(0).toISOString());
	});

	test('the donut total and the first tile agree', async () => {
		const snapshot = await buildDeploymentsSnapshot(source, scope);
		const total = snapshot.counts.find((tile) => tile.id === 'total');

		expect(total).toBeDefined();
		expect(snapshot.byDomain.total).toBe(total!.value);
	});

	test('the donut slices account for every run', async () => {
		const snapshot = await buildDeploymentsSnapshot(source, scope);
		const counted = snapshot.byDomain.slices.reduce((sum, slice) => sum + slice.count, 0);

		expect(counted).toBe(snapshot.byDomain.total);
	});

	test('both trend charts bucket the same periods, so they can be read side by side', async () => {
		const snapshot = await buildDeploymentsSnapshot(source, scope);

		expect(snapshot.frequency.points.map((point) => point.label)).toEqual(
			snapshot.meanDuration.points.map((point) => point.label)
		);
	});

	test('the newest frequency bucket matches the day the tiles report', async () => {
		const snapshot = await buildDeploymentsSnapshot(source, scope);
		const last = snapshot.frequency.points.at(-1);

		expect(last?.value).toBe(snapshot.summary.total);
	});

	test('honours the recent limit rather than trusting the source to slice', async () => {
		const snapshot = await buildDeploymentsSnapshot(source, scope);

		expect(snapshot.recent.length).toBeLessThanOrEqual(RECENT_DEPLOYMENT_LIMIT);
	});

	test('sends the domain options, so the filter is not declared by the client', async () => {
		const snapshot = await buildDeploymentsSnapshot(source, scope);

		expect(snapshot.domains.length).toBeGreaterThan(0);
		expect(snapshot.domains.every((domain) => domain.count > 0)).toBe(true);
	});
});

describe('the deployment log', () => {
	test('every tab admits only the statuses it names', async () => {
		const { deployments } = await source.queryDeployments(scope, {
			search: '',
			state: 'completed',
			domain: 'all',
			service: 'all',
			environment: 'all',
			window: 'any',
			page: 1,
			pageSize: 100
		});

		expect(deployments.length).toBeGreaterThan(0);
		expect(deployments.every((one) => matchesDeploymentState(one.status, 'completed'))).toBe(true);
		// `completed` is not a status: a rollback finished too.
		expect(deployments.every((one) => one.status !== 'in-progress')).toBe(true);
	});

	test('a filter that empties the result lands on page one, not on nothing', async () => {
		const page = await source.queryDeployments(scope, {
			search: 'no-such-service',
			state: 'all',
			domain: 'all',
			service: 'all',
			environment: 'all',
			window: 'any',
			page: 5,
			pageSize: 8
		});

		expect(page.deployments).toEqual([]);
		expect(page.page.page).toBe(1);
		expect(page.page.from).toBe(0);
	});

	test('environment narrows without the scope having to change', async () => {
		const page = await source.queryDeployments(scope, {
			search: '',
			state: 'all',
			domain: 'all',
			service: 'all',
			environment: 'staging',
			window: 'any',
			page: 1,
			pageSize: 100
		});

		expect(page.deployments.length).toBeGreaterThan(0);
		expect(page.deployments.every((one) => one.environment === 'staging')).toBe(true);
	});
});

describe('the two activity totals', () => {
	test('the deployment count agrees with the deployment summary', async () => {
		const platform = new FixturePlatformSource();
		const [activity, summary] = await Promise.all([
			platform.readActivitySummary(scope),
			source.readSummary(scope)
		]);

		// Two endpoints publish these separately; a caller comparing them must not find
		// two different totals for one day.
		expect(activity.deploymentsToday).toBe(summary.total);
		expect(activity.deploymentDomains).toBe(summary.domainCount);
	});
});
