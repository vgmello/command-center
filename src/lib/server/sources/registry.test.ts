import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { SourceRegistry } from './registry';
import { defineProvider } from './provider';
import type { ApmProvider, CloudProvider } from './contracts';

const cloud = defineProvider<CloudProvider>({
	id: 'stub-cloud',
	kind: 'cloud',
	name: 'Stub Cloud',
	icon: 'cloud',
	capabilities: ['cloud.regions', 'cloud.nodes'],
	settings: v.object({ region: v.string() }),
	connect: () => ({ resourceLink: () => null })
});

const apm = defineProvider<ApmProvider>({
	id: 'stub-apm',
	kind: 'apm',
	name: 'Stub APM',
	icon: 'chart-column',
	capabilities: ['apm.slo'],
	settings: v.object({}),
	connect: () => ({ resourceLink: () => null })
});

const file = {
	connections: [
		{ id: 'cloud-a', provider: 'stub-cloud', label: 'Cloud A', settings: { region: 'eu' } },
		{ id: 'cloud-b', provider: 'stub-cloud', label: 'Cloud B', settings: { region: 'us' } },
		{ id: 'apm-a', provider: 'stub-apm', label: 'APM A', settings: {} }
	]
};

function loaded() {
	const registry = new SourceRegistry();
	registry.register(cloud as never);
	registry.register(apm as never);
	registry.load(file, {});
	return registry;
}

describe('SourceRegistry', () => {
	test('indexes connections by kind', () => {
		expect(
			loaded()
				.connections('cloud')
				.map((one) => one.ref.id)
		).toEqual(['cloud-a', 'cloud-b']);
		expect(
			loaded()
				.connections('apm')
				.map((one) => one.ref.id)
		).toEqual(['apm-a']);
	});

	test('several connections of one kind coexist, which is the point', () => {
		expect(loaded().connections('cloud')).toHaveLength(2);
	});

	test('indexes by capability, so a router asks for who can answer rather than who exists', () => {
		expect(
			loaded()
				.supporting('cloud.regions')
				.map((one) => one.ref.id)
		).toEqual(['cloud-a', 'cloud-b']);
		expect(loaded().supporting('cloud.cost')).toEqual([]);
	});

	test('a client is built once per connection and reused', () => {
		const registry = loaded();

		expect(registry.connection('cloud-a')?.client).toBe(registry.connection('cloud-a')?.client);
	});

	test('two connections of one provider get their own clients', () => {
		const registry = loaded();

		expect(registry.connection('cloud-a')?.client).not.toBe(registry.connection('cloud-b')?.client);
	});

	test('registering the same provider id twice is a mistake, not a silent overwrite', () => {
		const registry = new SourceRegistry();
		registry.register(cloud as never);

		expect(() => registry.register(cloud as never)).toThrow(/stub-cloud/);
	});

	test('an unknown connection id is null, not a throw', () => {
		expect(loaded().connection('nope')).toBeNull();
	});

	test('a source ref carries the connection identity a panel prints', () => {
		const ref = loaded().connection('cloud-a')!.sourceRef(null);

		expect(ref).toEqual({
			connectionId: 'cloud-a',
			providerId: 'stub-cloud',
			kind: 'cloud',
			name: 'Cloud A',
			icon: 'cloud',
			link: null
		});
	});

	test('providers() returns a copy, not the live map', () => {
		const registry = loaded();
		const map1 = registry.providers() as Map<string, never>;

		expect(map1.size).toBe(2);

		map1.delete('stub-cloud');
		expect(map1.size).toBe(1);
		expect(registry.providers().size).toBe(2);

		const map2 = registry.providers();
		expect(map2.has('stub-cloud')).toBe(true);
		expect(map2.has('stub-apm')).toBe(true);
	});
});
