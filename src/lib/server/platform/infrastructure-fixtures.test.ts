import { describe, expect, test } from 'bun:test';
import { boundDomains } from '$lib/platform/ownership';
import type { NodeCounts } from '$lib/platform/types';
import {
	listClusters,
	listDatabases,
	listRegions,
	readCost,
	readNodeCounts,
	readStorage,
	readUtilization
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
	test("an owner's node split is its regions' split, and the owners sum to the estate field by field", () => {
		const mine = readNodeCounts('payment-domain');
		expect(total(mine)).toBe(12); // eu-west-1 nodeCount
		const owned = boundDomains('fixture').map((s) => readNodeCounts(s));
		const summed = owned.reduce(
			(acc, c) => ({
				healthy: acc.healthy + c.healthy,
				warning: acc.warning + c.warning,
				down: acc.down + c.down
			}),
			{ healthy: 0, warning: 0, down: 0 }
		);
		// The estate's two down nodes must be findable on some domain's tab — a per-owner
		// read that could never say `down` was the bug.
		expect(summed).toEqual(readNodeCounts());
		expect(owned.some((c) => c.down > 0)).toBe(true);
	});
	test("a region's nodeCount is the sum of its split", () => {
		for (const region of listRegions()) {
			const [owner] = boundDomains('fixture').filter((s) =>
				listRegions(s).some((r) => r.id === region.id)
			);
			const split = readNodeCounts(owner);
			// Every fixture region is owned by exactly one domain, and no domain owns two
			// regions, so the owner's split is the region's.
			expect(total(split)).toBe(region.nodeCount);
		}
		expect(listRegions().reduce((t, r) => t + r.nodeCount, 0)).toBe(48);
	});
	test("an owner's cost share follows its nodes, and the owners' spend sums to the estate", () => {
		const now = new Date('2026-09-18T12:00:00Z');
		const estate = readCost(now);
		const owned = boundDomains('fixture').map((s) => readCost(now, s).total);
		expect(owned.reduce((t, n) => t + n, 0)).toBeCloseTo(estate.total, 6);
	});
	test('utilisation: an owner with no nodes has no machines to read, so it gets no series', () => {
		const now = new Date('2026-09-18T12:00:00Z');
		// analytics-domain is bound (analytics-db) but owns no region, so its strip says
		// Nodes 0 — four live series beside that would describe machines the page denies.
		expect(total(readNodeCounts('analytics-domain'))).toBe(0);
		expect(readUtilization(now, 'analytics-domain')).toEqual([]);
	});
	test('utilisation: an owner with nodes reads the same four panels as the estate', () => {
		const now = new Date('2026-09-18T12:00:00Z');
		expect(total(readNodeCounts('payment-domain'))).toBeGreaterThan(0);
		expect(readUtilization(now, 'payment-domain').map((r) => r.id)).toEqual(
			readUtilization(now).map((r) => r.id)
		);
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
