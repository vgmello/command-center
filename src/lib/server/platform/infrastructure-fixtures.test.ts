import { describe, expect, test } from 'bun:test';
import { boundDomains } from '$lib/platform/ownership';
import type { NodeCounts } from '$lib/platform/types';
import {
	listClusters,
	listDatabases,
	listRegions,
	readNodeCounts,
	readStorage
} from './infrastructure-fixtures';

describe('owner-scoped fixtures', () => {
	const total = (c: NodeCounts) => c.healthy + c.warning + c.down;

	test('the estate figures do not move', () => {
		// The estate donut, the node tile's Degraded status, e2e text and the DTO tests all encode these.
		expect(readNodeCounts()).toEqual({ healthy: 42, warning: 4, down: 2 });
		expect(listRegions().map((r) => r.id)).toEqual([
			'eu-west-1',
			'eu-central-1',
			'us-east-1',
			'us-west-2',
			'ap-southeast-1'
		]);
	});
	test('regions: payment-domain runs in eu-west-1 only', () => {
		expect(listRegions('payment-domain').map((r) => r.id)).toEqual(['eu-west-1']);
	});
	test('clusters inherit the region: exactly the two in eu-west-1', () => {
		expect(
			listClusters(100, 'payment-domain')
				.map((c) => c.id)
				.sort()
		).toEqual(['prod-eu-west-1-a', 'prod-eu-west-1-b']);
	});
	test("an owner's node count is derived from its regions, and the owners sum to the estate total", () => {
		const mine = readNodeCounts('payment-domain');
		expect(total(mine)).toBe(12); // eu-west-1 nodeCount
		expect(mine.healthy).toBe(Math.floor((12 * 96) / 100)); // region score 96 → 11
		expect(mine.down).toBe(0);
		const owned = boundDomains('fixture').map((s) => total(readNodeCounts(s)));
		expect(owned.reduce((t, n) => t + n, 0)).toBe(48); // the five regions' nodeCounts = the estate total
	});
	test('databases: analytics-domain owns analytics-db only', () => {
		expect(listDatabases(100, 'analytics-domain').map((d) => d.id)).toEqual(['analytics-db']);
	});
	test("storage: a domain's classes come from FIXTURE_STORAGE_BYTES, and owners sum to the estate", () => {
		const estate = readStorage();
		const mine = readStorage('payment-domain');
		expect(mine.classes.map((c) => c.id)).toEqual(estate.classes.map((c) => c.id));
		const owned = boundDomains('fixture').map((s) => readStorage(s).totalBytes);
		expect(owned.reduce((t, b) => t + b, 0)).toBeCloseTo(estate.totalBytes, -6);
	});
	test('an unbound owner gets empty lists — the router will have thrown first, but the fixture is honest too', () => {
		expect(listRegions('tax-domain')).toEqual([]);
		expect(total(readNodeCounts('tax-domain'))).toBe(0);
	});
});
