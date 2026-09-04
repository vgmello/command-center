import { describe, expect, test } from 'bun:test';
import * as v from 'valibot';
import { loadConnections, resolveSecrets } from './connection';
import { defineProvider } from './provider';
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

		expect(() => loadConnections(bad, providers, env)).toThrow();
	});

	test('two connections may not share an id', () => {
		const bad = { connections: [file.connections[0], file.connections[0]] };

		expect(() => loadConnections(bad, providers, env)).toThrow(/azure-prod/);
	});
});
