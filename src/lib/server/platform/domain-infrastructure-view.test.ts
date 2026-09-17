import { describe, expect, test } from 'bun:test';
import { buildDomainInfrastructureSnapshot } from './domain-infrastructure-view';
import { toInfraSummaryView } from '$lib/platform/infrastructure';
import { routersWithout } from '../testing/routers-without';

const scope = { environment: 'production' as const, timeRange: '1h' as const };
const now = new Date('2026-09-16T12:00:00Z');
const ok = <T>(p: { status: string; data?: T }): T => {
	if (p.status !== 'ok') throw new Error(p.status);
	return p.data as T;
};

describe('the domain infrastructure tab', () => {
	test('a bound domain gets its own panels, a composed strip, and unbound false', async () => {
		const r = routersWithout([]);
		const snap = (await buildDomainInfrastructureSnapshot(
			r.platform,
			r.infrastructure,
			scope,
			'payment-domain',
			now
		))!;
		expect(snap.unbound).toBe(false);
		expect(ok(snap.regions).map((x) => x.id)).toEqual(['eu-west-1']);
		expect(
			ok(snap.clusters)
				.map((x) => x.id)
				.sort()
		).toEqual(['prod-eu-west-1-a', 'prod-eu-west-1-b']);
		const summary = ok(snap.summary);
		expect(summary.nodes).toEqual({ healthy: 11, warning: 1, down: 0 }); // floor(12·96/100) = 11
		expect(summary.clusters).toEqual({ count: 2, atLimit: false });
		expect(summary.databases).toEqual({ count: 1, atLimit: false }); // payment-db
		expect(summary.storageBytes).toBeGreaterThan(0);
	});
	test('an unbound domain: every panel no-binding, unbound true, and the strip is the nodes gap', async () => {
		const r = routersWithout([]);
		const snap = (await buildDomainInfrastructureSnapshot(
			r.platform,
			r.infrastructure,
			scope,
			'tax-domain',
			now
		))!;
		expect(snap.unbound).toBe(true);
		for (const p of [
			snap.summary,
			snap.nodes,
			snap.regions,
			snap.clusters,
			snap.databases,
			snap.utilization,
			snap.cost
		]) {
			expect(p.status).toBe('unavailable');
			expect((p as { reason?: string }).reason).toBe('no-binding');
		}
	});
	test('a bound domain missing cloud.storage alone: storageBytes null, unbound false', async () => {
		const r = routersWithout(['cloud.storage']);
		const snap = (await buildDomainInfrastructureSnapshot(
			r.platform,
			r.infrastructure,
			scope,
			'payment-domain',
			now
		))!;
		expect(snap.unbound).toBe(false);
		expect(ok(snap.summary).storageBytes).toBeNull();
		expect(ok(snap.summary).clusters).toEqual({ count: 2, atLimit: false });
	});
	test('a bound domain missing cloud.nodes: the strip is that gap, the other panels are ok', async () => {
		const r = routersWithout(['cloud.nodes']);
		const snap = (await buildDomainInfrastructureSnapshot(
			r.platform,
			r.infrastructure,
			scope,
			'payment-domain',
			now
		))!;
		expect(snap.unbound).toBe(false);
		expect(snap.summary.status).toBe('unavailable');
		expect((snap.summary as { reason?: string }).reason).toBe('no-capability');
		expect(snap.regions.status).toBe('ok');
	});
	test('unknown slug → null', async () => {
		const r = routersWithout([]);
		expect(
			await buildDomainInfrastructureSnapshot(
				r.platform,
				r.infrastructure,
				scope,
				'no-such-domain',
				now
			)
		).toBeNull();
	});
	test('toInfraSummaryView prints 100+ at the limit and a dash for a null cell', () => {
		const view = toInfraSummaryView({
			nodes: { healthy: 1, warning: 0, down: 0 },
			clusters: { count: 100, atLimit: true },
			databases: null,
			storageBytes: null
		});
		expect(view.clustersLabel).toBe('100+');
		expect(view.databasesLabel).toBe('—');
		expect(view.storageLabel).toBe('—');
	});
});
// `InfraSummary` is never published — the seven API paths carry the resources, not the strip — so
// `count`/`atLimit` are asserted on `toInfraSummaryView` only (Task 13 corrects the spec's testing row).
