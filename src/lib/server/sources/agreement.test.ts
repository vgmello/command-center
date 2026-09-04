import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { CAPABILITY_METHODS, capabilityDrift } from './agreement';
import { CAPABILITIES } from '$lib/platform/sources';
import { defineProvider } from './provider';
import type { CloudProvider } from './contracts';

describe('CAPABILITY_METHODS', () => {
	test('every capability names the method that answers it', () => {
		for (const capability of CAPABILITIES) {
			expect(CAPABILITY_METHODS[capability], capability).toBeTruthy();
		}
	});
});

describe('capabilityDrift', () => {
	const build = (capabilities: readonly string[], client: Partial<CloudProvider>) =>
		capabilityDrift(
			defineProvider<CloudProvider>({
				id: 'stub',
				kind: 'cloud',
				name: 'Stub',
				icon: 'cloud',
				capabilities: capabilities as never,
				settings: v.object({}),
				connect: () => ({ resourceLink: () => null, ...client })
			}) as never,
			{ resourceLink: () => null, ...client }
		);

	test('an agreeing provider drifts in neither direction', () => {
		const drift = build(['cloud.regions'], { listRegions: async () => [] });

		expect(drift).toEqual({ declaredNotImplemented: [], implementedNotDeclared: [] });
	});

	test('declaring a capability without implementing it is caught', () => {
		expect(build(['cloud.cost'], {}).declaredNotImplemented).toEqual(['cloud.cost']);
	});

	test('implementing a capability without declaring it is caught too', () => {
		// Undeclared means unrouted: the method exists and nothing will ever call it.
		expect(build([], { listRegions: async () => [] }).implementedNotDeclared).toEqual([
			'cloud.regions'
		]);
	});
});
