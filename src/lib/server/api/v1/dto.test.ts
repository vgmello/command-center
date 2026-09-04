import { describe, expect, test } from 'bun:test';
import {
	toActivitySummaryDto,
	toDependenciesDto,
	toDeploymentDto,
	toDeploymentSummaryDto,
	toDomainChangeDto,
	toEndpointDto,
	toFacetDto,
	toHealthCheckDto,
	toServiceDto,
	toDomainDto,
	toDomainPageDto,
	toDomainSummaryDto,
	toIncidentDto,
	toInfrastructureDto,
	toMetricDto,
	toSystemStatusDto
} from './dto';
import { listDomains } from '$lib/server/platform/fixtures';
import {
	FixtureDeploymentSource,
	FixtureInfrastructureSource,
	FixturePlatformSource,
	FixtureServiceSource
} from '$lib/server/platform/fixture-source';
import { ALL_OWNERS } from '$lib/platform/query';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const source = new FixturePlatformSource();
const deployments = new FixtureDeploymentSource();
const estate = new FixtureInfrastructureSource();

/**
 * These assert the wire shape *literally*, key by key.
 *
 * That is the point: v1 is a promise to whoever integrates against it, and the only
 * way an internal rename gets caught before a customer notices is a test that fails
 * when the payload changes. A test that just checked "has an id" would pass through
 * exactly the breakage it exists to catch.
 */
describe('v1 domain shape', () => {
	const domain = listDomains()[0];

	test('exposes the facts and nothing about how we draw them', () => {
		expect(Object.keys(toDomainDto(domain)).sort()).toEqual([
			'activeIncidents',
			'availability7dPct',
			'criticality',
			'errorRatePct',
			'healthScore',
			'id',
			'name',
			'owner',
			'p95LatencyMs',
			'serviceCount',
			'status'
		]);
	});

	test('drops presentation fields the internal type carries', () => {
		// Through `unknown` on purpose: the DTO type already forbids these fields, so
		// TypeScript objects to the cast. The runtime check is what catches a future
		// mapper that spreads the internal object instead of listing fields.
		const dto = toDomainDto(domain) as unknown as Record<string, unknown>;

		// Present internally, deliberately absent from the contract.
		expect(domain.icon).toBeDefined();
		expect(domain.accent).toBeDefined();
		// `shortName` is how our table abbreviates a domain to fit eleven columns, not a
		// fact another client needs — it already has `name`.
		for (const field of [
			'icon',
			'accent',
			'slug',
			'shortName',
			'favorite',
			'healthTrend',
			'errorTrend'
		]) {
			expect(dto[field]).toBeUndefined();
		}
	});
});

describe('v1 collection shapes', () => {
	test('a page separates the rows from the paging metadata', async () => {
		const page = await source.queryDomains(scope, {
			search: '',
			status: 'all',
			owner: ALL_OWNERS,
			sort: 'health-score',
			page: 1,
			pageSize: 2
		});
		const dto = toDomainPageDto(page);

		expect(Object.keys(dto).sort()).toEqual(['data', 'page']);
		expect(Object.keys(dto.page).sort()).toEqual(['page', 'pageSize', 'totalItems', 'totalPages']);
		expect(dto.data).toHaveLength(2);
		// `from`/`to` are footer arithmetic for our table, not part of the contract.
		expect((dto.page as unknown as Record<string, unknown>).from).toBeUndefined();
	});

	test('summary counts include the total so a caller need not add them up', () => {
		const dto = toDomainSummaryDto({ healthy: 18, degraded: 4, down: 3, unknown: 0 });
		expect(dto).toEqual({ total: 25, healthy: 18, degraded: 4, down: 3, unknown: 0 });
	});

	test('metrics are raw values, not formatted strings', async () => {
		const [rate] = await source.readRates(scope);
		const dto = toMetricDto(rate);

		expect(Object.keys(dto).sort()).toEqual([
			'change',
			'id',
			'kind',
			'label',
			'polarity',
			'unit',
			'value'
		]);
		expect(typeof dto.value).toBe('number');
		expect(typeof dto.change).toBe('number');
	});

	test('a percentage metric reports its unit rather than leaving it blank', async () => {
		const rates = await source.readRates(scope);
		const percent = rates.find((rate) => rate.kind === 'percent');
		expect(toMetricDto(percent!).unit).toBe('%');
	});

	test('a deployment publishes its whole shape, key by key', async () => {
		const [deployment] = await deployments.listDeployments(scope, 1);

		expect(Object.keys(toDeploymentDto(deployment)).sort()).toEqual([
			'deployedAt',
			'deployedBy',
			'domain',
			'durationSeconds',
			'environment',
			'id',
			'reference',
			'service',
			'status',
			'trigger',
			'version'
		]);
	});

	test('a running deployment reports no duration rather than a zero one', async () => {
		const log = await deployments.listDeployments(scope, 50);
		const running = log.find((one) => one.status === 'in-progress');

		expect(running).toBeDefined();
		expect(toDeploymentDto(running!).durationSeconds).toBeNull();
	});

	test('incidents and deployments nest the domain as a reference', async () => {
		const [incident] = await source.listIncidents(scope, 1);
		const [deployment] = await deployments.listDeployments(scope, 1);

		expect(toIncidentDto(incident).domain).toEqual({
			id: incident.domainId,
			name: incident.domainName
		});
		expect(Object.keys(toDeploymentDto(deployment).domain).sort()).toEqual(['id', 'name']);
		// The icon the deployment row draws is ours, not the caller's business.
		expect(
			(toDeploymentDto(deployment) as unknown as Record<string, unknown>).icon
		).toBeUndefined();
	});

	test('infrastructure and status expose the state, not its label styling', async () => {
		const [group] = await estate.listGroups(scope);

		expect(Object.keys(toInfrastructureDto(group)).sort()).toEqual([
			'count',
			'id',
			'label',
			'status'
		]);
		expect(
			Object.keys(toSystemStatusDto({ status: 'down', label: 'L', detail: 'D' })).sort()
		).toEqual(['detail', 'label', 'status']);
	});
});

describe('v1 service shapes', () => {
	const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
	const catalog = new FixtureServiceSource();

	test('a service publishes its whole shape, key by key', async () => {
		const service = await catalog.findService(scope, 'payment-api');

		expect(Object.keys(toServiceDto(service!)).sort()).toEqual([
			'activeAlerts',
			'chatChannel',
			'dashboard',
			'description',
			'domain',
			'id',
			'instancesHealthy',
			'instancesTotal',
			'language',
			'name',
			'owner',
			'repository',
			'runbook',
			'runtime',
			'serviceType',
			'status'
		]);
	});

	test('drops the presentation fields the catalog carries internally', async () => {
		const service = await catalog.findService(scope, 'payment-api');
		const dto = toServiceDto(service!) as unknown as Record<string, unknown>;

		expect(service!.icon).toBeDefined();
		expect(service!.accent).toBeDefined();
		for (const field of ['icon', 'accent', 'slug', 'domainId', 'domainName']) {
			expect(dto[field]).toBeUndefined();
		}
	});

	test('a health check publishes a number and its unit, not a rendered string', async () => {
		const checks = await catalog.listHealthChecks(scope, 'payment-api');
		const dtos = checks.map(toHealthCheckDto);

		expect(dtos.every((one) => typeof one.value === 'number')).toBe(true);
		expect(new Set(dtos.map((one) => one.unit))).toEqual(new Set(['percent', 'milliseconds']));
		// The sparkline is how we draw a check; it is not part of the contract.
		expect((dtos[0] as unknown as Record<string, unknown>).series).toBeUndefined();
	});

	test('an endpoint drops the bar width, which is a fact about our table', async () => {
		const endpoints = await catalog.listEndpoints(scope, 'payment-api', 5);
		const dto = toEndpointDto(endpoints[0]) as unknown as Record<string, unknown>;

		expect(endpoints[0].sharePct).toBeDefined();
		expect(dto.sharePct).toBeUndefined();
		expect(Object.keys(dto).sort()).toEqual(['method', 'p95LatencyMs', 'path', 'status']);
	});

	test('dependencies keep both directions and every protocol', async () => {
		const dto = toDependenciesDto(await catalog.readDependencies(scope, 'payment-api'));

		expect(Object.keys(dto).sort()).toEqual(['downstream', 'upstream']);
		expect([...dto.upstream, ...dto.downstream].every((one) => one.protocol.length > 0)).toBe(true);
	});
});

describe('v1 aggregate shapes', () => {
	const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

	test('the deployment summary omits the comparisons the dashboard chose to draw', async () => {
		const summary = await deployments.readSummary(scope);
		const dto = toDeploymentSummaryDto(summary) as unknown as Record<string, unknown>;

		expect(summary.meanDurationChangePct).toBeDefined();
		for (const field of ['meanDurationChangePct', 'changeFailureRateChangePct', 'totalChangePct']) {
			expect(dto[field]).toBeUndefined();
		}
	});

	test('a facet publishes id, label and count', () => {
		expect(Object.keys(toFacetDto({ id: 'a', label: 'A', count: 2 })).sort()).toEqual([
			'count',
			'id',
			'label'
		]);
	});

	test('a domain change nests the domain and keeps both scores', () => {
		const dto = toDomainChangeDto({
			id: 'x',
			domainId: 'billing-domain',
			name: 'Billing Domain',
			icon: 'receipt',
			accent: 'blue',
			healthScore: 83,
			previousScore: 58,
			direction: 'up',
			changedAt: '2026-09-04T00:00:00.000Z'
		});

		expect(dto.domain).toEqual({ id: 'billing-domain', name: 'Billing Domain' });
		expect(dto.previousScore).toBe(58);
		// Icon and accent are how our feed draws a row.
		expect((dto as unknown as Record<string, unknown>).icon).toBeUndefined();
	});

	test('the activity summary publishes four counts and nothing else', () => {
		const dto = toActivitySummaryDto({
			activeIncidents: 7,
			incidentDomains: 5,
			deploymentsToday: 29,
			deploymentDomains: 6
		});

		expect(Object.keys(dto).sort()).toEqual([
			'activeIncidents',
			'deploymentDomains',
			'deploymentsToday',
			'incidentDomains'
		]);
	});
});
