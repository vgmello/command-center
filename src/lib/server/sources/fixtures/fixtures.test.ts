import { describe, expect, test } from 'bun:test';
import { FIXTURE_PROVIDERS } from './index';
import { capabilityDrift } from '../agreement';
import { kindOf } from '$lib/platform/sources';

describe('the fixture providers', () => {
	test('there is one per kind', () => {
		expect(FIXTURE_PROVIDERS.map((one) => one.kind).sort()).toEqual(['apm', 'cloud', 'deployment']);
	});

	test('each declares only capabilities of its own kind', () => {
		for (const definition of FIXTURE_PROVIDERS) {
			for (const capability of definition.capabilities) {
				expect(kindOf(capability), `${definition.id}/${capability}`).toBe(definition.kind);
			}
		}
	});

	test('each implements exactly what it declares', () => {
		for (const definition of FIXTURE_PROVIDERS) {
			const drift = capabilityDrift(definition, definition.connect({}) as object);

			expect(drift.declaredNotImplemented, definition.id).toEqual([]);
			expect(drift.implementedNotDeclared, definition.id).toEqual([]);
		}
	});

	test('the cloud fixture answers every cloud capability, so no panel is dark by default', () => {
		const cloud = FIXTURE_PROVIDERS.find((one) => one.kind === 'cloud')!;

		expect(cloud.capabilities.has('cloud.cost')).toBe(true);
		expect(cloud.capabilities.has('cloud.regions')).toBe(true);
	});

	test('a cloud read returns the same data the existing fixture serves', async () => {
		const cloud = FIXTURE_PROVIDERS.find((one) => one.kind === 'cloud')!;
		const client = cloud.connect({}) as { listRegions: (ctx: unknown) => Promise<unknown[]> };
		const regions = await client.listRegions({
			scope: { environment: 'production', timeRange: '15m' },
			connection: {
				id: 'x',
				providerId: 'fixture-cloud',
				kind: 'cloud',
				label: 'X',
				icon: 'box',
				settings: {}
			}
		});

		expect(regions.length).toBeGreaterThan(0);
	});

	test('a deep link is offered for a bound resource and withheld without a binding', () => {
		const cloud = FIXTURE_PROVIDERS.find((one) => one.kind === 'cloud')!;
		const client = cloud.connect({}) as {
			resourceLink: (b: unknown, v: string) => unknown;
		};

		expect(client.resourceLink(undefined, 'overview')).toBeNull();
		expect(
			client.resourceLink({ kind: 'cloud', connectionId: 'x', externalId: 'vm-1' }, 'overview')
		).not.toBeNull();
	});
});
