import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { octopusProvider } from './index';
import { buildEstate } from './mock/data';
import { startOctopusMock } from './mock/server';
import { capabilityDrift } from '../../agreement';
import { CAPABILITIES } from '$lib/platform/sources';
import type { DeploymentProvider } from '../../contracts';
import type { SourceContext } from '../../provider';
import type { DeploymentQuery } from '$lib/platform/deployments';
import { ALL_DOMAINS, ALL_ENVIRONMENTS, ALL_SERVICES } from '$lib/platform/deployments';

const KEY = 'API-TESTTESTTESTTESTTESTTEST';
const NOW = new Date('2026-09-04T12:00:00.000Z');
const estate = buildEstate({ now: NOW, count: 200 });

let mock: ReturnType<typeof startOctopusMock>;
let client: DeploymentProvider;

const ctx = {
	scope: { environment: 'production', timeRange: '15m' },
	connection: {
		id: 'octopus-test',
		providerId: 'octopus',
		kind: 'deployment',
		label: 'Octopus',
		icon: 'rocket',
		settings: {}
	}
} as unknown as SourceContext;

beforeAll(() => {
	mock = startOctopusMock({ estate, apiKey: KEY });
	client = octopusProvider.connect({
		baseUrl: mock.url,
		apiKey: KEY,
		spaceId: estate.spaceId,
		environments: {},
		windowSize: 200
	});
});

afterAll(() => {
	mock.stop();
});

describe('the provider definition', () => {
	test('declares only deployment capabilities, all of them real', () => {
		for (const capability of octopusProvider.capabilities) {
			expect(CAPABILITIES).toContain(capability);
			expect(capability.startsWith('deployment.')).toBe(true);
		}
	});

	test('agrees with its own client — every declared capability has its method', () => {
		expect(capabilityDrift(octopusProvider, client)).toEqual({
			declaredNotImplemented: [],
			implementedNotDeclared: []
		});
	});

	test('does not declare insights, which Octopus has no opinion to give', () => {
		expect([...octopusProvider.capabilities]).not.toContain('deployment.insights');
	});

	test('refuses settings without a base URL, rather than defaulting to somewhere', () => {
		expect(() => octopusProvider.connect({ apiKey: 'x' })).toThrow();
	});
});

describe('listDeployments against a server speaking the real contract', () => {
	test('maps Octopus rows onto our shape', async () => {
		const rows = await client.listDeployments!(ctx, 10);

		expect(rows.length).toBe(10);
		for (const row of rows) {
			expect(row.id).toMatch(/^Deployments-\d+$/);
			expect(row.reference).toMatch(/^#\d+$/);
			expect(['production', 'staging', 'development']).toContain(row.environment);
			expect(['success', 'failed', 'in-progress']).toContain(row.status);
			expect(['ci-cd', 'manual']).toContain(row.trigger);
			expect(row.version).toMatch(/^\d+\.\d+\.\d+$/);
			expect(row.service.length).toBeGreaterThan(0);
			expect(row.domainName.length).toBeGreaterThan(0);
		}
	});

	test('joins the task, which is where status and duration actually live', async () => {
		const rows = await client.listDeployments!(ctx, 60);

		// A deployment resource carries neither, so a row with a duration proves the join.
		expect(rows.some((one) => one.durationSeconds !== null)).toBe(true);
		expect(rows.some((one) => one.status === 'success')).toBe(true);
	});

	test('a running deployment has no duration', async () => {
		const rows = await client.listDeployments!(ctx, 200);
		const running = rows.filter((one) => one.status === 'in-progress');

		expect(running.length).toBeGreaterThan(0);
		for (const row of running) expect(row.durationSeconds).toBeNull();
	});

	test('drops deployments whose environment maps to nothing rather than guessing', async () => {
		const rows = await client.listDeployments!(ctx, 200);
		const sandbox = estate.environments.find((one) => one.Name === 'Sandbox')!;
		const sandboxIds = new Set(
			estate.deployments.filter((one) => one.EnvironmentId === sandbox.Id).map((one) => one.Id)
		);

		expect(sandboxIds.size).toBeGreaterThan(0);
		expect(rows.some((one) => sandboxIds.has(one.id))).toBe(false);
	});

	test('an override brings the unmappable environment back', async () => {
		const sandbox = estate.environments.find((one) => one.Name === 'Sandbox')!;
		const mapped = octopusProvider.connect({
			baseUrl: mock.url,
			apiKey: KEY,
			spaceId: estate.spaceId,
			environments: { [sandbox.Id]: 'staging' },
			windowSize: 200
		});

		const rows = await mapped.listDeployments!(ctx, 200);
		const sandboxIds = new Set(
			estate.deployments.filter((one) => one.EnvironmentId === sandbox.Id).map((one) => one.Id)
		);

		expect(rows.some((one) => sandboxIds.has(one.id))).toBe(true);
	});

	test('uses the project group as the domain, which is what groups are for', async () => {
		const rows = await client.listDeployments!(ctx, 50);
		const groupNames = new Set(estate.projectGroups.map((one) => one.Name));

		for (const row of rows) expect(groupNames).toContain(row.domainName);
	});
});

describe('the aggregates', () => {
	test('the summary counts agree with each other', async () => {
		const summary = await client.readSummary!(ctx);

		expect(summary.total).toBeGreaterThan(0);
		expect(summary.successful + summary.failed + summary.inProgress).toBe(summary.total);
		expect(summary.changeFailureRatePct).toBeGreaterThanOrEqual(0);
		expect(summary.changeFailureRatePct).toBeLessThanOrEqual(100);
	});

	test('the breakdown shares sum to its own total', async () => {
		const breakdown = await client.readDomainBreakdown!(ctx);

		expect(breakdown.slices.reduce((sum, one) => sum + one.count, 0)).toBe(breakdown.total);
	});

	test('the status trend series share one x-axis, so they can be stacked', async () => {
		const series = await client.readStatusTrend!(ctx);
		const labels = series.map((one) => one.points.map((p) => p.label).join('|'));

		expect(series.length).toBe(3);
		expect(new Set(labels).size).toBe(1);
	});

	test('trends honour the grain they were asked for', async () => {
		const daily = await client.readTrends!(ctx, 'daily');
		const monthly = await client.readTrends!(ctx, 'monthly');

		expect(daily.frequency.points.length).toBeGreaterThan(monthly.frequency.points.length);
		expect(daily.frequency.points.length).toEqual(daily.meanDuration.points.length);
	});

	test('the deploying domains are the ones the breakdown names', async () => {
		const [domains, breakdown] = await Promise.all([
			client.listDeployingDomains!(ctx),
			client.readDomainBreakdown!(ctx)
		]);

		expect(domains.map((one) => one.id).sort()).toEqual(
			breakdown.slices.map((one) => one.domainId).sort()
		);
	});
});

describe('queryDeployments', () => {
	const query: DeploymentQuery = {
		search: '',
		state: 'all',
		domain: ALL_DOMAINS,
		service: ALL_SERVICES,
		environment: ALL_ENVIRONMENTS,
		window: 'any',
		page: 1,
		pageSize: 10
	};

	test('pages the mapped rows', async () => {
		const page = await client.queryDeployments!(ctx, query);

		expect(page.deployments.length).toBe(10);
		expect(page.page.totalItems).toBeGreaterThan(10);
	});

	test('a state filter actually filters', async () => {
		const page = await client.queryDeployments!(ctx, { ...query, state: 'failed' });

		expect(page.deployments.length).toBeGreaterThan(0);
		for (const row of page.deployments) expect(row.status).toBe('failed');
	});
});

describe('resourceLink', () => {
	test('points at the configured server, so the mock and a real one both work', () => {
		const link = octopusProvider
			.connect({
				baseUrl: 'https://octopus.example.com',
				apiKey: KEY,
				spaceId: 'Spaces-1',
				environments: {},
				windowSize: 10
			})
			.resourceLink({ kind: 'deployment', connectionId: 'c', externalId: 'ServerTasks-9' }, 'logs');

		expect(link?.href).toBe('https://octopus.example.com/app#/Spaces-1/tasks/ServerTasks-9');
		expect(link?.label).toBe('Show in Octopus');
	});

	test('no binding means no link, rather than a link to nothing', () => {
		expect(client.resourceLink(undefined, 'overview')).toBeNull();
	});
});
