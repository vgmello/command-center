import { describe, expect, test } from 'bun:test';
import {
	toActivitySummaryDto,
	toCostDto,
	toDomainDependenciesDto,
	toDomainVitalsDto,
	toResourceUsageDto,
	toServiceVitalsDto,
	toSloBudgetDto,
	toStorageDto,
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
const catalogSource = new FixtureServiceSource();

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

	test('an endpoint drops both bar widths and keeps the measurements', async () => {
		const endpoints = await catalog.listEndpoints(scope, 'payment-api', 5);
		const dto = toEndpointDto(endpoints[0]) as unknown as Record<string, unknown>;

		expect(endpoints[0].latencySharePct).toBeDefined();
		expect(dto.latencySharePct).toBeUndefined();
		expect(dto.requestSharePct).toBeUndefined();
		expect(Object.keys(dto).sort()).toEqual([
			'method',
			'p95LatencyMs',
			'path',
			'requestsPerSecond',
			'status'
		]);
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

describe('v1 domain detail shapes', () => {
	const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

	test('a domain vitals payload drops the precomputed chart bounds', async () => {
		const vitals = await source.readDomainVitals(scope, 'payment-domain');
		const dto = toDomainVitalsDto(vitals!);

		expect(vitals!.requestRate.min).toBeDefined();
		expect(Object.keys(dto.requestRate).sort()).toEqual(['id', 'label', 'points']);
		expect(Object.keys(dto).sort()).toEqual([
			'errorRate',
			'p95Latency',
			'requestRate',
			'services',
			'sloCompliancePct',
			'sloWindow'
		]);
	});

	test('the service split it reports is the one the domain row implies', async () => {
		const domain = await source.findDomain(scope, 'payment-domain');
		const dto = toDomainVitalsDto((await source.readDomainVitals(scope, 'payment-domain'))!);
		const counted = dto.services.healthy + dto.services.degraded + dto.services.down;

		expect(counted).toBe(domain!.serviceCount);
	});

	test('a service row drops the icon, the accent and the sparkline', async () => {
		const vitals = (await source.readDomainVitals(scope, 'payment-domain'))!;
		const domain = (await source.findDomain(scope, 'payment-domain'))!;
		const rows = await catalogSource.listServiceVitals(
			scope,
			domain.id,
			vitals,
			domain.serviceCount
		);
		const dto = toServiceVitalsDto(rows[0]) as unknown as Record<string, unknown>;

		expect(rows[0].icon).toBeDefined();
		for (const field of ['icon', 'accent', 'trend', 'slug']) {
			expect(dto[field]).toBeUndefined();
		}
	});

	test('the critical path travels as names, in order', async () => {
		const dto = toDomainDependenciesDto(
			await source.readDomainDependencies(scope, 'payment-domain')
		);

		expect(dto.criticalPath).toHaveLength(3);
		expect(dto.criticalPath[1]).toBe('Payment Domain');
	});
});

describe('v1 metric and estate shapes', () => {
	const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

	test('the error budget publishes minutes, not the string the panel prints', async () => {
		const slo = await catalogSource.readSloBudget(scope, 'payment-api');
		const dto = toSloBudgetDto(slo);

		// The same figure the label is built from, so the two surfaces cannot round it
		// two different ways.
		expect(dto.remainingMinutes).toBe(slo.remainingMinutes);
		expect(slo.remainingLabel).toContain(String(slo.remainingMinutes));
		expect((dto as unknown as Record<string, unknown>).burn).toBeUndefined();
	});

	test('a utilisation reading publishes a number in the unit its series uses', async () => {
		const usages = await estate.readUtilization(scope);
		const cpu = toResourceUsageDto(usages.find((one) => one.id === 'cpu')!);
		const network = toResourceUsageDto(usages.find((one) => one.id === 'network')!);
		const dto = cpu;

		expect(typeof dto.value).toBe('number');
		expect(cpu.unit).toBe('percent');
		expect(cpu.value).toBeLessThanOrEqual(100);
		// The tile prints "1.2 Gbps"; the series is bits per second, and that is what
		// travels — labelling 1.2e9 as gigabits would be off by a billion.
		expect(network.unit).toBe('bits_per_second');
		expect(network.value).toBeGreaterThan(1_000_000);
		// `formatted` and `axisMax` are how a tile draws it.
		for (const field of ['formatted', 'axisMax', 'changeFormatted']) {
			expect((dto as unknown as Record<string, unknown>)[field]).toBeUndefined();
		}
	});

	test('storage publishes bytes, and the parts still sum to the total', async () => {
		const dto = toStorageDto(await estate.readStorage(scope));
		const summed = dto.classes.reduce((sum, one) => sum + one.bytes, 0);

		expect(Math.abs(summed - dto.totalBytes)).toBeLessThan(2);
	});

	test('cost publishes figures rather than formatted money', async () => {
		const dto = toCostDto(await estate.readCost(scope));
		const summed = dto.categories.reduce((sum, one) => sum + one.amount, 0);

		expect(dto.total).toBeCloseTo(summed, 6);
		expect(dto.categories.every((one) => one.daily.length === dto.days.length)).toBe(true);
		expect((dto as unknown as Record<string, unknown>).totalFormatted).toBeUndefined();
	});
});
