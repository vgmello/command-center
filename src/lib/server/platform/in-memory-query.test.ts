import { describe, expect, test } from 'bun:test';
import { queryDomainsInMemory } from './in-memory-query';
import { listDomains } from './fixtures';
import { DEFAULT_PAGE_SIZE } from './snapshot';
import { ALL_OWNERS, type DomainQuery } from '$lib/platform/query';

const baseQuery: DomainQuery = {
	search: '',
	status: 'all',
	owner: ALL_OWNERS,
	sort: 'health-score',
	page: 1,
	pageSize: DEFAULT_PAGE_SIZE
};

const domains = listDomains();

describe('queryDomainsInMemory owner filtering', () => {
	test('an owner filter narrows to exactly that team', () => {
		const owner = domains[0].owner;
		const result = queryDomainsInMemory(domains, { ...baseQuery, owner, pageSize: 100 });

		expect(result.domains.length).toBeGreaterThan(0);
		expect(result.domains.every((domain) => domain.owner === owner)).toBe(true);
		expect(result.page.totalItems).toBe(domains.filter((d) => d.owner === owner).length);
	});

	test('`all` is a sentinel, not a team — it filters nothing out', () => {
		const result = queryDomainsInMemory(domains, { ...baseQuery, pageSize: 100 });

		expect(result.page.totalItems).toBe(domains.length);
	});

	test('an owner nobody matches returns an empty page, not every domain', () => {
		const result = queryDomainsInMemory(domains, { ...baseQuery, owner: '@nobody' });

		expect(result.domains).toEqual([]);
		expect(result.page.totalItems).toBe(0);
		expect(result.page.from).toBe(0);
	});

	test('owner and status compose rather than override each other', () => {
		const owner = domains.find((domain) => domain.status !== 'healthy')?.owner ?? '';
		const result = queryDomainsInMemory(domains, {
			...baseQuery,
			owner,
			status: 'healthy',
			pageSize: 100
		});

		expect(
			result.domains.every((domain) => domain.owner === owner && domain.status === 'healthy')
		).toBe(true);
	});

	test('search reaches the owner handle, so typing a team name finds its domains', () => {
		const owner = domains[0].owner;
		const result = queryDomainsInMemory(domains, {
			...baseQuery,
			search: owner.slice(1),
			pageSize: 100
		});

		expect(result.domains.some((domain) => domain.owner === owner)).toBe(true);
	});
});

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
