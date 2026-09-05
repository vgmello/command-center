import { describe, expect, test } from 'bun:test';
import { CAPABILITIES } from '$lib/platform/sources';
import { CAPABILITY_TIER, isDocument, isPersisted } from './tiers';

describe('CAPABILITY_TIER', () => {
	test('every capability is classified, so none inherits a fallback', () => {
		for (const capability of CAPABILITIES) {
			expect(CAPABILITY_TIER[capability], capability).toBeDefined();
		}
	});

	test('a live reading is never persisted', () => {
		// Read back off disk it is already stale, and a row written every thirty seconds
		// for a number nobody will read again is cost without benefit.
		expect(isPersisted('apm.serviceHealth')).toBe(false);
		expect(isPersisted('cloud.utilization')).toBe(false);
		expect(isPersisted('deployment.log')).toBe(false);
	});

	test('inventory is persisted, because those are the expensive calls', () => {
		expect(isDocument('cloud.regions')).toBe(true);
		expect(isDocument('cloud.databases')).toBe(true);
		expect(isDocument('apm.dependencies')).toBe(true);
	});

	test('series are persisted but not as documents', () => {
		// A window's whole answer would key on the window, so a 15-minute view and a
		// 24-hour view would share nothing — which is the entire point of accumulating.
		expect(isPersisted('apm.metricSeries')).toBe(true);
		expect(isDocument('apm.metricSeries')).toBe(false);
		expect(isDocument('deployment.trends')).toBe(false);
	});

	test('every tier is actually used', () => {
		const used = new Set(Object.values(CAPABILITY_TIER));
		expect(used).toEqual(new Set(['live', 'reference', 'series']));
	});
});
