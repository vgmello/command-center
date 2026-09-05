import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { defineProvider } from './provider';
import type { CloudProvider } from './contracts';

describe('defineProvider', () => {
	test('freezes the capability set so a definition cannot be mutated after registration', () => {
		const definition = defineProvider<CloudProvider>({
			id: 'stub',
			kind: 'cloud',
			name: 'Stub Cloud',
			icon: 'cloud',
			capabilities: ['cloud.regions'],
			settings: v.object({}),
			connect: () => ({ resourceLink: () => null })
		});

		expect(definition.capabilities.has('cloud.regions')).toBe(true);
		expect(() => (definition.capabilities as Set<string>).add('cloud.cost')).toThrow();
	});

	test('rejects a capability that does not belong to the provider kind', () => {
		expect(() =>
			defineProvider<CloudProvider>({
				id: 'stub',
				kind: 'cloud',
				name: 'Stub Cloud',
				icon: 'cloud',
				// `apm.slo` is not a cloud capability; a router would never dispatch it here.
				capabilities: ['apm.slo'] as never,
				settings: v.object({}),
				connect: () => ({ resourceLink: () => null })
			})
		).toThrow(/cloud/);
	});
});
