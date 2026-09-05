import { describe, expect, test } from 'bun:test';
import { CAPABILITIES, type Capability } from '$lib/platform/sources';
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
	});

	test('only capabilities a router actually accumulates are classified series', () => {
		// The defect this guards against was silent and expensive. `deployment.trends`,
		// `deployment.statusTrend` and `apm.latencyHeatmap` were all declared `series`
		// while `fanOutSeries` was called for none of them, so they fell through both
		// strategies: not documents, so the cache never persisted them, and not
		// accumulated, so they never reached `source_series` either. Every read fetched a
		// four-hundred-row window, forever, with nothing anywhere reporting a problem.
		//
		// `series` is a promise that something accumulates the capability. Until a router
		// reads one through `fanOutSeries`, it does not belong in this tier — and adding
		// it here without that wiring must fail rather than go quiet.
		const accumulated = new Set<Capability>(['apm.metricSeries']);
		const declared = CAPABILITIES.filter((one) => CAPABILITY_TIER[one] === 'series');

		expect(new Set(declared)).toEqual(accumulated);
	});

	test('every tier is actually used', () => {
		const used = new Set(Object.values(CAPABILITY_TIER));
		expect(used).toEqual(new Set(['live', 'reference', 'series']));
	});
});
