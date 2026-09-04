import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { createDispatcher } from './dispatch';
import { SourceRegistry } from './registry';
import { defineProvider } from './provider';
import { CapabilityUnavailableError, SourceFailedError } from './errors';
import type { CloudProvider } from './contracts';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

function registryWith(regions: (id: string) => Promise<unknown[]>, ids = ['a', 'b']) {
	const registry = new SourceRegistry();
	registry.register(
		defineProvider<CloudProvider>({
			id: 'p',
			kind: 'cloud',
			name: 'P',
			icon: 'cloud',
			capabilities: ['cloud.regions'],
			settings: v.object({ id: v.string() }),
			connect: (settings) => ({
				listRegions: async () => regions((settings as { id: string }).id) as never,
				resourceLink: () => ({
					label: 'open',
					href: `https://x.invalid/${(settings as { id: string }).id}`
				})
			})
		}) as never
	);
	registry.load(
		{ connections: ids.map((id) => ({ id, provider: 'p', label: id, settings: { id } })) },
		{}
	);
	return registry;
}

describe('dispatch.all — the aggregate rule', () => {
	test('fans out across every connection of the kind and concatenates', async () => {
		const dispatcher = createDispatcher(registryWith(async (id) => [`${id}-1`, `${id}-2`]));
		const { data } = await dispatcher.all<string>({
			capability: 'cloud.regions',
			scope,
			call: (client) => (client as CloudProvider).listRegions!({} as never) as never
		});

		expect(data).toEqual(['a-1', 'a-2', 'b-1', 'b-2']);
	});

	test('with no connection of that kind it is unavailable, not empty', async () => {
		const dispatcher = createDispatcher(new SourceRegistry());

		expect(
			dispatcher.all({ capability: 'cloud.regions', scope, call: async () => [] })
		).rejects.toThrow(CapabilityUnavailableError);
	});
});

describe('dispatch.one — the resource rule', () => {
	test('routes to the connection the binding names', async () => {
		const dispatcher = createDispatcher(registryWith(async (id) => [id]));
		const { data, source } = await dispatcher.one<string[]>({
			capability: 'cloud.regions',
			scope,
			binding: { kind: 'cloud', connectionId: 'b', externalId: 'r-9' },
			call: (client) => (client as CloudProvider).listRegions!({} as never) as never
		});

		expect(data).toEqual(['b']);
		expect(source.connectionId).toBe('b');
	});

	test('an unbound resource is unavailable with the reason that says so', async () => {
		const dispatcher = createDispatcher(registryWith(async () => []));

		expect(
			dispatcher.one({
				capability: 'cloud.regions',
				scope,
				binding: undefined,
				call: async () => []
			})
		).rejects.toMatchObject({ reason: 'no-binding' });
	});

	test('a binding naming a connection that is gone is unavailable, not a crash', async () => {
		const dispatcher = createDispatcher(registryWith(async () => []));

		expect(
			dispatcher.one({
				capability: 'cloud.regions',
				scope,
				binding: { kind: 'cloud', connectionId: 'removed', externalId: 'r-9' },
				call: async () => []
			})
		).rejects.toMatchObject({ reason: 'no-connection' });
	});

	test('a connection that does not implement the capability is unavailable', async () => {
		const registry = new SourceRegistry();
		registry.register(
			defineProvider<CloudProvider>({
				id: 'p',
				kind: 'cloud',
				name: 'P',
				icon: 'cloud',
				capabilities: [],
				settings: v.object({}),
				connect: () => ({ resourceLink: () => null })
			}) as never
		);
		registry.load({ connections: [{ id: 'a', provider: 'p', label: 'A', settings: {} }] }, {});

		expect(
			createDispatcher(registry).one({
				capability: 'cloud.regions',
				scope,
				binding: { kind: 'cloud', connectionId: 'a', externalId: 'r' },
				call: async () => []
			})
		).rejects.toMatchObject({ reason: 'no-capability' });
	});

	test('a provider that throws becomes a source failure carrying who failed', async () => {
		const dispatcher = createDispatcher(
			registryWith(async () => {
				throw new Error('upstream 503');
			})
		);

		const failure = dispatcher.one({
			capability: 'cloud.regions',
			scope,
			binding: { kind: 'cloud', connectionId: 'a', externalId: 'r' },
			call: (client) => (client as CloudProvider).listRegions!({} as never) as never
		});

		expect(failure).rejects.toThrow(SourceFailedError);
		expect(failure).rejects.toMatchObject({ source: { connectionId: 'a' } });
	});

	test('one failing connection does not lose the others in a fan-out', async () => {
		const dispatcher = createDispatcher(
			registryWith(async (id) => {
				if (id === 'a') throw new Error('down');
				return [id];
			})
		);
		const { data } = await dispatcher.all<string>({
			capability: 'cloud.regions',
			scope,
			call: (client) => (client as CloudProvider).listRegions!({} as never) as never
		});

		// A partial estate is more useful than none; the failure is not silent because the
		// panel's source ref names the connections that did answer.
		expect(data).toEqual(['b']);
	});

	test('a fan-out where every connection fails is a failure, not an empty list', async () => {
		const dispatcher = createDispatcher(
			registryWith(async () => {
				throw new Error('down');
			})
		);

		expect(
			dispatcher.all({
				capability: 'cloud.regions',
				scope,
				call: (client) => (client as CloudProvider).listRegions!({} as never) as never
			})
		).rejects.toThrow(SourceFailedError);
	});
});
