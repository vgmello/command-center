import { describe, expect, test } from 'bun:test';
import {
	DEFAULT_PAGE_SIZE,
	buildCountTiles,
	buildMetrics,
	buildOverview,
	buildSystemStatus,
	queryDomains
} from './snapshot';
import { listDomains } from './fixtures';
import { statusFromScore } from '$lib/platform/health';
import type { DomainQuery } from '$lib/platform/types';

const baseQuery: DomainQuery = {
	environment: 'production',
	timeRange: '15m',
	search: '',
	status: 'all',
	sort: 'health-score',
	page: 1,
	pageSize: DEFAULT_PAGE_SIZE
};

const domains = listDomains();

describe('listDomains', () => {
	test('derives status from score rather than storing it', () => {
		for (const domain of domains) {
			expect(domain.status).toBe(statusFromScore(domain.healthScore));
		}
	});

	test('gives every domain a unique slug', () => {
		expect(new Set(domains.map((d) => d.slug)).size).toBe(domains.length);
	});

	test('produces series the sparklines can scale', () => {
		for (const domain of domains) {
			expect(domain.healthTrend.values.length).toBeGreaterThan(1);
			expect(domain.healthTrend.max).toBeGreaterThanOrEqual(domain.healthTrend.min);
		}
	});

	test('is deterministic, so a refresh does not redraw a different history', () => {
		expect(listDomains()[0].healthTrend.values).toEqual(domains[0].healthTrend.values);
	});
});

describe('queryDomains', () => {
	test('pages without losing or duplicating rows', () => {
		const seen = new Set<string>();
		let page = 1;

		while (true) {
			const result = queryDomains(domains, { ...baseQuery, page });
			for (const domain of result.domains) seen.add(domain.id);
			if (page >= result.page.totalPages) break;
			page++;
		}

		expect(seen.size).toBe(domains.length);
	});

	test('reports the 1-based range the footer prints', () => {
		const result = queryDomains(domains, { ...baseQuery, page: 2 });
		expect(result.page.from).toBe(9);
		expect(result.page.to).toBe(16);
		expect(result.page.totalItems).toBe(domains.length);
	});

	test('clamps a page beyond the end instead of returning nothing', () => {
		const result = queryDomains(domains, { ...baseQuery, page: 999 });
		expect(result.page.page).toBe(result.page.totalPages);
		expect(result.domains.length).toBeGreaterThan(0);
	});

	test('filters by status', () => {
		const result = queryDomains(domains, { ...baseQuery, status: 'down', pageSize: 100 });
		expect(result.domains.length).toBeGreaterThan(0);
		expect(result.domains.every((d) => d.status === 'down')).toBe(true);
	});

	test('searches case-insensitively on name and slug', () => {
		expect(queryDomains(domains, { ...baseQuery, search: 'PAYMENT' }).domains[0].name).toBe(
			'Payment Domain'
		);
		expect(queryDomains(domains, { ...baseQuery, search: 'order-domain' }).domains[0].name).toBe(
			'Order Domain'
		);
	});

	test('an empty result set still reports a usable page', () => {
		const result = queryDomains(domains, { ...baseQuery, search: 'nothing-matches-this' });
		expect(result.domains).toEqual([]);
		expect(result.page.from).toBe(0);
		expect(result.page.to).toBe(0);
		expect(result.page.totalPages).toBe(1);
	});

	test('the default sort leads with criticality, then the worst score in the tier', () => {
		const result = queryDomains(domains, baseQuery);
		const names = result.domains.map((d) => d.name);

		expect(names[0]).toBe('Payment Domain');
		// Business-critical tier, worst first.
		expect(names.slice(1, 4)).toEqual(['Inventory Domain', 'Order Domain', 'User Domain']);
	});

	test('sorting by error rate puts the worst offender first', () => {
		const result = queryDomains(domains, { ...baseQuery, sort: 'error-rate' });
		expect(result.domains[0].errorRatePct).toBe(Math.max(...domains.map((d) => d.errorRatePct)));
	});

	test('sorting by name is alphabetical', () => {
		const result = queryDomains(domains, { ...baseQuery, sort: 'name', pageSize: 100 });
		const names = result.domains.map((d) => d.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
	});

	test('does not mutate the list it was given', () => {
		const order = domains.map((d) => d.id);
		queryDomains(domains, { ...baseQuery, sort: 'name' });
		expect(domains.map((d) => d.id)).toEqual(order);
	});
});

describe('buildCountTiles', () => {
	test('the status counts add up to the total', () => {
		const tiles = buildCountTiles(domains);
		const [total, ...statuses] = tiles;

		expect(total.value).toBe(domains.length);
		expect(statuses.reduce((sum, tile) => sum + tile.value, 0)).toBe(total.value);
	});

	test('the total tile has a caption instead of a percentage', () => {
		const [total] = buildCountTiles(domains);
		expect(total.percentage).toBeNull();
		expect(total.caption).toBe('Across platform');
	});
});

describe('buildSystemStatus', () => {
	test('an outage outranks a degradation', () => {
		expect(buildSystemStatus([{ status: 'down' }, { status: 'degraded' }] as never).status).toBe(
			'down'
		);
	});

	test('reports all clear only when nothing is wrong', () => {
		const status = buildSystemStatus([{ status: 'healthy' }] as never);
		expect(status.label).toBe('All Systems');
		expect(status.detail).toBe('Operational');
	});

	test('pluralises the detail line', () => {
		expect(buildSystemStatus([{ status: 'degraded' }] as never).detail).toBe('1 domain degraded');
		expect(
			buildSystemStatus([{ status: 'degraded' }, { status: 'degraded' }] as never).detail
		).toBe('2 domains degraded');
	});
});

describe('buildMetrics', () => {
	test('states polarity so the UI can colour the trend correctly', () => {
		const metrics = buildMetrics('15m');
		const byId = Object.fromEntries(metrics.map((metric) => [metric.id, metric]));

		expect(byId['error-rate'].polarity).toBe('lower-is-better');
		expect(byId['request-rate'].polarity).toBe('higher-is-better');
	});

	test('labels the comparison window from the selected time range', () => {
		expect(buildMetrics('1h')[0].comparedToLabel).toBe('vs 1h ago');
		expect(buildMetrics('15m')[0].comparedToLabel).toBe('vs 15m ago');
	});
});

describe('buildOverview', () => {
	test('assembles a snapshot whose distribution matches its count tiles', () => {
		const snapshot = buildOverview('production', '15m', new Date('2026-09-03T12:00:00.000Z'));
		const healthyTile = snapshot.counts.find((tile) => tile.id === 'healthy');
		const healthySlice = snapshot.distribution.slices.find((slice) => slice.status === 'healthy');

		expect(healthyTile?.value).toBe(healthySlice?.count);
		expect(snapshot.distribution.total).toBe(snapshot.counts[0].value);
	});

	test('timestamps incidents relative to the clock it was given', () => {
		const now = new Date('2026-09-03T12:00:00.000Z');
		const snapshot = buildOverview('production', '15m', now);

		expect(snapshot.generatedAt).toBe(now.toISOString());
		expect(new Date(snapshot.incidents[0].openedAt).getTime()).toBeLessThan(now.getTime());
	});

	test('carries the requested scope through', () => {
		const snapshot = buildOverview('staging', '6h');
		expect(snapshot.environment).toBe('staging');
		expect(snapshot.timeRange).toBe('6h');
	});
});
