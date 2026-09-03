import { describe, expect, test } from 'bun:test';
import { queryDomainsInMemory } from './in-memory-query';
import { listDomains } from './fixtures';
import { DEFAULT_PAGE_SIZE } from './snapshot';
import type { DomainQuery } from '$lib/platform/query';

const baseQuery: DomainQuery = {
	search: '',
	status: 'all',
	sort: 'health-score',
	page: 1,
	pageSize: DEFAULT_PAGE_SIZE
};

const domains = listDomains();

describe('queryDomainsInMemory', () => {
	test('pages without losing or duplicating rows', () => {
		const seen = new Set<string>();
		let page = 1;

		for (;;) {
			const result = queryDomainsInMemory(domains, { ...baseQuery, page });
			for (const domain of result.domains) seen.add(domain.id);
			if (page >= result.page.totalPages) break;
			page++;
		}

		expect(seen.size).toBe(domains.length);
	});

	test('reports the 1-based range the footer prints', () => {
		const result = queryDomainsInMemory(domains, { ...baseQuery, page: 2 });
		expect(result.page.from).toBe(9);
		expect(result.page.to).toBe(16);
		expect(result.page.totalItems).toBe(domains.length);
	});

	test('clamps a page beyond the end instead of returning nothing', () => {
		const result = queryDomainsInMemory(domains, { ...baseQuery, page: 999 });
		expect(result.page.page).toBe(result.page.totalPages);
		expect(result.domains.length).toBeGreaterThan(0);
	});

	test('filters by status', () => {
		const result = queryDomainsInMemory(domains, { ...baseQuery, status: 'down', pageSize: 100 });
		expect(result.domains.length).toBeGreaterThan(0);
		expect(result.domains.every((domain) => domain.status === 'down')).toBe(true);
	});

	test('searches case-insensitively on name and slug', () => {
		expect(queryDomainsInMemory(domains, { ...baseQuery, search: 'PAYMENT' }).domains[0].name).toBe(
			'Payment Domain'
		);
		expect(
			queryDomainsInMemory(domains, { ...baseQuery, search: 'order-domain' }).domains[0].name
		).toBe('Order Domain');
	});

	test('an empty result set still reports a usable page', () => {
		const result = queryDomainsInMemory(domains, { ...baseQuery, search: 'nothing-matches-this' });
		expect(result.domains).toEqual([]);
		expect(result.page.from).toBe(0);
		expect(result.page.to).toBe(0);
		expect(result.page.totalPages).toBe(1);
	});

	test('the default sort leads with criticality, then the worst score in the tier', () => {
		const names = queryDomainsInMemory(domains, baseQuery).domains.map((domain) => domain.name);

		expect(names[0]).toBe('Payment Domain');
		// Business-critical tier, worst first.
		expect(names.slice(1, 4)).toEqual(['Inventory Domain', 'Order Domain', 'User Domain']);
	});

	test('sorting by error rate puts the worst offender first', () => {
		const result = queryDomainsInMemory(domains, { ...baseQuery, sort: 'error-rate' });
		expect(result.domains[0].errorRatePct).toBe(
			Math.max(...domains.map((domain) => domain.errorRatePct))
		);
	});

	test('sorting by name is alphabetical', () => {
		const result = queryDomainsInMemory(domains, { ...baseQuery, sort: 'name', pageSize: 100 });
		const names = result.domains.map((domain) => domain.name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
	});

	test('does not mutate the list it was given', () => {
		const order = domains.map((domain) => domain.id);
		queryDomainsInMemory(domains, { ...baseQuery, sort: 'name' });
		expect(domains.map((domain) => domain.id)).toEqual(order);
	});
});
