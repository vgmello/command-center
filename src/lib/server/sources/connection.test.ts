import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { loadConnections, resolveSecrets } from './connection';
import { defineProvider } from './provider';
import type { ProviderDefinition } from './provider';
import { fixtureCloudProvider } from './fixtures';
import type { CloudProvider } from './contracts';

const azure = defineProvider<CloudProvider>({
	id: 'azure',
	kind: 'cloud',
	name: 'Microsoft Azure',
	icon: 'cloud',
	capabilities: ['cloud.regions'],
	settings: v.object({ subscriptionId: v.string(), clientSecret: v.string() }),
	connect: () => ({ resourceLink: () => null })
});

const providers = new Map([['azure', azure as never]]);
const env = { AZURE_SECRET: 'shhh' };

const file = {
	connections: [
		{
			id: 'azure-prod',
			provider: 'azure',
			label: 'Azure — Production',
			settings: { subscriptionId: 'sub-1', clientSecret: { $env: 'AZURE_SECRET' } }
		}
	]
};

describe('resolveSecrets', () => {
	test('reads a referenced value out of the environment', () => {
		expect(resolveSecrets({ a: { $env: 'AZURE_SECRET' } }, env)).toEqual({ a: 'shhh' });
	});

	test('leaves plain values alone', () => {
		expect(resolveSecrets({ a: 'literal', b: 3 }, env)).toEqual({ a: 'literal', b: 3 });
	});

	test('a reference to a variable that is not set fails loudly', () => {
		expect(() => resolveSecrets({ a: { $env: 'MISSING' } }, env)).toThrow(/MISSING/);
	});
});

describe('loadConnections', () => {
	test('validates settings against the provider schema and resolves its secrets', () => {
		const [connection] = loadConnections(file, providers, env);

		expect(connection.id).toBe('azure-prod');
		expect(connection.kind).toBe('cloud');
		expect(connection.icon).toBe('cloud');
		expect(connection.settings).toEqual({ subscriptionId: 'sub-1', clientSecret: 'shhh' });
	});

	test('an unknown provider fails at boot rather than on first read', () => {
		const bad = { connections: [{ id: 'x', provider: 'gcp', label: 'X', settings: {} }] };

		expect(() => loadConnections(bad, providers, env)).toThrow(/gcp/);
	});

	test('a connection missing a required setting fails at boot', () => {
		const bad = {
			connections: [
				{ id: 'x', provider: 'azure', label: 'X', settings: { subscriptionId: 'sub-1' } }
			]
		};

		expect(() => loadConnections(bad, providers, env)).toThrow(/invalid settings: clientSecret/);
	});

	test('an invalid settings error names the failing key, never the resolved secret value', () => {
		const guarded = defineProvider<CloudProvider>({
			id: 'guarded',
			kind: 'cloud',
			name: 'Guarded Cloud',
			icon: 'cloud',
			capabilities: ['cloud.regions'],
			settings: v.object({ apiKey: v.pipe(v.string(), v.regex(/^sk-/)) }),
			connect: () => ({ resourceLink: () => null })
		});

		const guardedProviders = new Map([['guarded', guarded as never]]);
		const guardedEnv = { GUARDED_KEY: 'super-secret-value' };
		const bad = {
			connections: [
				{
					id: 'guarded-1',
					provider: 'guarded',
					label: 'Guarded',
					settings: { apiKey: { $env: 'GUARDED_KEY' } }
				}
			]
		};

		let message = '';
		try {
			loadConnections(bad, guardedProviders, guardedEnv);
		} catch (error) {
			message = (error as Error).message;
		}

		expect(message).toContain('apiKey');
		expect(message).not.toContain('super-secret-value');
	});

	test('two connections may not share an id', () => {
		const bad = { connections: [file.connections[0], file.connections[0]] };

		expect(() => loadConnections(bad, providers, env)).toThrow(/azure-prod/);
	});
});

describe('a fixture beside a real source', () => {
	const providers = new Map<string, ProviderDefinition<unknown>>([
		['fixture-cloud', fixtureCloudProvider as ProviderDefinition<unknown>],
		['azure', azure as ProviderDefinition<unknown>]
	]);

	test('is refused, because the aggregate rule would merge invented rows into real ones', () => {
		// Two connections of a kind is a supported arrangement — two subscriptions, two
		// spaces — and `all()` concatenates them deliberately. That is exactly what makes
		// mixing a fixture in dangerous: every total on the page would be wrong, and
		// nothing on it would say so.
		expect(() =>
			loadConnections(
				{
					connections: [
						{ id: 'fx', provider: 'fixture-cloud', label: 'Fixture', settings: {} },
						{
							id: 'real',
							provider: 'azure',
							label: 'Azure',
							settings: { subscriptionId: 's', clientSecret: 'k' }
						}
					]
				},
				providers,
				{}
			)
		).toThrow(/must be the only cloud source/);
	});

	test('but a fixture alone is fine, which is what keeps local dev and the tests working', () => {
		const loaded = loadConnections(
			{ connections: [{ id: 'fx', provider: 'fixture-cloud', label: 'Fixture', settings: {} }] },
			providers,
			{}
		);

		expect(loaded).toHaveLength(1);
	});

	test('and two real sources of one kind are still allowed', () => {
		// The supported arrangement must not be caught by the guard: two subscriptions
		// really do merge, and that is the point of the aggregate rule.
		const loaded = loadConnections(
			{
				connections: [
					{
						id: 'a',
						provider: 'azure',
						label: 'A',
						settings: { subscriptionId: 'a', clientSecret: 'k' }
					},
					{
						id: 'b',
						provider: 'azure',
						label: 'B',
						settings: { subscriptionId: 'b', clientSecret: 'k' }
					}
				]
			},
			providers,
			{}
		);

		expect(loaded).toHaveLength(2);
	});
});
