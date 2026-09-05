import { describe, expect, test } from 'bun:test';
import { DOMAIN_DEPLOYMENT_LIMIT, DOMAIN_ISSUE_LIMIT, buildDomainSnapshot } from './domain-view';
import {
	FixtureDeploymentSource,
	FixturePlatformSource,
	FixtureServiceSource
} from './fixture-source';
import { describeHiddenServices } from '$lib/platform/domains';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const platform = new FixturePlatformSource();
const services = new FixtureServiceSource();
const deployments = new FixtureDeploymentSource();

const build = (slug: string) => buildDomainSnapshot(platform, services, deployments, scope, slug);

describe('buildDomainSnapshot', () => {
	test('an unknown slug is null, so the route can answer 404', async () => {
		expect(await build('no-such-domain')).toBeNull();
	});

	test('carries the scope it was assembled for', async () => {
		const snapshot = await buildDomainSnapshot(
			platform,
			services,
			deployments,
			scope,
			'payment-domain',
			new Date(0)
		);

		expect(snapshot?.environment).toBe('production');
		expect(snapshot?.generatedAt).toBe(new Date(0).toISOString());
	});

	test('the service split adds up to the service count the header states', async () => {
		const snapshot = (await build('payment-domain'))!;
		const tile = snapshot.stats.find((stat) => stat.id === 'services');

		expect(tile?.kind).toBe('breakdown');
		if (tile?.kind !== 'breakdown') throw new Error('unreachable');
		expect(tile.parts.reduce((sum, part) => sum + part.count, 0)).toBe(tile.total);
		expect(tile.total).toBe(snapshot.domain.serviceCount);
	});

	test('the health ring shows the same score the domains table lists', async () => {
		const snapshot = (await build('payment-domain'))!;
		const tile = snapshot.stats.find((stat) => stat.id === 'health');

		expect(tile?.kind).toBe('ring');
		if (tile?.kind !== 'ring') throw new Error('unreachable');
		expect(tile.score).toBe(snapshot.domain.healthScore);
		expect(tile.status).toBe(snapshot.domain.status);
	});

	test('the readings match the domain row they were assembled from', async () => {
		const snapshot = (await build('payment-domain'))!;
		const errorTile = snapshot.stats.find((stat) => stat.id === 'error-rate');

		expect(errorTile?.kind).toBe('trend');
		if (errorTile?.kind !== 'trend') throw new Error('unreachable');
		// The series is pinned to the stated reading, so the header and the table agree.
		expect(errorTile.series.values.at(-1)).toBe(snapshot.domain.errorRatePct);
	});

	test('a healthy domain reports no services in trouble', async () => {
		const snapshot = (await build('user-domain'))!;
		const tile = snapshot.stats.find((stat) => stat.id === 'services');

		if (tile?.kind !== 'breakdown') throw new Error('unreachable');
		expect(tile.parts.find((part) => part.status === 'degraded')?.count).toBe(0);
		expect(tile.parts.find((part) => part.status === 'down')?.count).toBe(0);
	});

	test('the table lists exactly as many services as the domain claims', async () => {
		const snapshot = (await build('payment-domain'))!;

		// The header tile and this table are two renderings of one number; a catalog
		// that covered only the hand-written services would make them contradict.
		expect(snapshot.services).toHaveLength(snapshot.domain.serviceCount);
		expect(new Set(snapshot.services.map((one) => one.slug)).size).toBe(snapshot.services.length);
	});

	test('and their states add up to the split the header reports', async () => {
		const snapshot = (await build('payment-domain'))!;
		const tile = snapshot.stats.find((stat) => stat.id === 'services');

		if (tile?.kind !== 'breakdown') throw new Error('unreachable');
		for (const part of tile.parts) {
			const counted = snapshot.services.filter((one) => one.status === part.status).length;
			expect(counted, part.label).toBe(part.count);
		}
	});

	test('the catalogued services are all present, with their own readings', async () => {
		const snapshot = (await build('payment-domain'))!;
		const catalog = await services.listServices(scope, snapshot.domain.id);

		for (const service of catalog) {
			const row = snapshot.services.find((one) => one.slug === service.slug);
			expect(row, service.slug).toBeDefined();
			expect(row!.status).toBe(service.status);
		}
	});

	test('every deployment and issue belongs to this domain', async () => {
		const snapshot = (await build('payment-domain'))!;

		expect(snapshot.deployments.every((one) => one.domainId === snapshot.domain.id)).toBe(true);
		expect(snapshot.issues.every((one) => one.domainId === snapshot.domain.id)).toBe(true);
		expect(snapshot.deployments.length).toBeLessThanOrEqual(DOMAIN_DEPLOYMENT_LIMIT);
		expect(snapshot.issues.length).toBeLessThanOrEqual(DOMAIN_ISSUE_LIMIT);
	});

	test('the dependency graph names only domains that exist', async () => {
		const snapshot = (await build('payment-domain'))!;
		const { upstream, downstream, criticalPath } = snapshot.dependencies;

		expect(upstream.length).toBeGreaterThan(0);
		expect(downstream.length).toBeGreaterThan(0);
		for (const node of [...upstream, ...downstream]) {
			expect(await platform.findDomain(scope, node.id)).not.toBeNull();
		}

		// The path is built from the neighbours, so it cannot name one they do not show.
		expect(criticalPath).toEqual([upstream[0].name, snapshot.domain.name, downstream[0].name]);
	});

	test('a domain does not depend on itself', async () => {
		const snapshot = (await build('payment-domain'))!;
		const { upstream, downstream } = snapshot.dependencies;

		expect([...upstream, ...downstream].some((one) => one.id === snapshot.domain.id)).toBe(false);
	});
});

describe('describeHiddenServices', () => {
	test('says how many are hidden, in the plural it needs', () => {
		expect(describeHiddenServices(14, 5)).toBe('Show 9 more services');
		expect(describeHiddenServices(6, 5)).toBe('Show 1 more service');
	});

	test('offers nothing when nothing is hidden', () => {
		expect(describeHiddenServices(5, 5)).toBeNull();
		expect(describeHiddenServices(3, 5)).toBeNull();
	});
});
