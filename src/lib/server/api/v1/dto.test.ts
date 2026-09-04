import { describe, expect, test } from 'bun:test';
import {
	toDeploymentDto,
	toDomainDto,
	toDomainPageDto,
	toDomainSummaryDto,
	toIncidentDto,
	toInfrastructureDto,
	toMetricDto,
	toSystemStatusDto
} from './dto';
import { listDomains } from '$lib/server/platform/fixtures';
import { FixturePlatformSource } from '$lib/server/platform/fixture-source';
import { ALL_OWNERS } from '$lib/platform/query';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const source = new FixturePlatformSource();

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

	test('incidents and deployments nest the domain as a reference', async () => {
		const [incident] = await source.listIncidents(scope, 1);
		const [deployment] = await source.listDeployments(scope, 1);

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
		const [group] = await source.listInfrastructure(scope);

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
