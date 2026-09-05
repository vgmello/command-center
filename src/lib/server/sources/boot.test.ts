import { describe, expect, test } from 'bun:test';
import { FixtureCatalogSource } from '../catalog/fixture-source';
import * as v from 'valibot';
import { buildSources } from './boot';
import { SourceCache } from './cache';
import type { CloudProvider } from './contracts';
import { createDispatcher } from './dispatch';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from './fixtures';
import { defineProvider } from './provider';
import { SourceRegistry } from './registry';
import { createInfrastructureRouter, createRouters } from './routers';
import { FixturePlatformSource } from '../platform/fixture-source';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const catalog = { platform: new FixturePlatformSource(), services: new FixtureCatalogSource() };

describe('buildSources', () => {
	test('with no config it connects the fixture providers, so the app runs as it does today', async () => {
		const routers = buildSources({ config: null, env: {}, catalog });

		expect((await routers.infrastructure.listRegions(scope)).length).toBeGreaterThan(0);
		expect((await routers.deployment.readSummary(scope)).total).toBeGreaterThan(0);
	});

	test('an explicit config is used instead of the fixtures', async () => {
		const routers = buildSources({
			config: FIXTURE_CONNECTIONS,
			providers: FIXTURE_PROVIDERS,
			env: {},
			catalog
		});

		expect((await routers.infrastructure.readNodeCounts(scope)).healthy).toBeGreaterThan(0);
	});

	test('a config naming an unregistered provider refuses to start', () => {
		expect(() =>
			buildSources({
				config: { connections: [{ id: 'x', provider: 'azure', label: 'X', settings: {} }] },
				providers: FIXTURE_PROVIDERS,
				env: {},
				catalog
			})
		).toThrow(/azure/);
	});

	test('a malformed config refuses to start rather than silently serving nothing', () => {
		expect(() =>
			buildSources({
				config: { nope: true },
				providers: FIXTURE_PROVIDERS,
				env: {},
				catalog
			})
		).toThrow();
	});

	test('a real config naming a fixture provider refuses to start, rather than serving seeded numbers', () => {
		expect(() =>
			buildSources({
				config: {
					connections: [{ id: 'x', provider: 'fixture-cloud', label: 'X', settings: {} }]
				},
				env: {},
				catalog
			})
		).toThrow(/fixture-cloud/);
	});

	test('the four routers share one cache, so one capability is fetched once', async () => {
		// A provider that counts its own invocations, rather than asserting on a value
		// that would be the same whether or not the cache is shared.
		let calls = 0;
		const countingCloud = defineProvider<CloudProvider>({
			id: 'counting-cloud',
			kind: 'cloud',
			name: 'Counting Cloud',
			icon: 'cloud',
			capabilities: ['cloud.nodes'],
			settings: v.object({}),
			connect: () => ({
				async readNodeCounts() {
					calls += 1;
					return { healthy: 10, warning: 0, down: 0 };
				},
				resourceLink: () => null
			})
		});

		const registry = new SourceRegistry();
		registry.register(countingCloud);
		registry.load(
			{ connections: [{ id: 'c', provider: 'counting-cloud', label: 'C', settings: {} }] },
			{}
		);

		// One `deps`, holding one cache — exactly what buildSources() builds and hands to
		// createRouters(). `routers.infrastructure` is one InfrastructureSource built from
		// it; `anotherInfrastructureRouter` is a second, independently constructed one,
		// standing in for a different port that happened to ask for the same capability.
		// If createRouters() gave either of them a private cache instead of passing this
		// `deps` straight through, they would stop sharing an entry.
		const deps = { registry, dispatcher: createDispatcher(registry), cache: new SourceCache() };
		const routers = createRouters(deps, catalog);
		const anotherInfrastructureRouter = createInfrastructureRouter(deps);

		await routers.infrastructure.readNodeCounts(scope);
		await anotherInfrastructureRouter.readNodeCounts(scope);

		expect(calls).toBe(1);
	});
});

describe('fixtures in a real configuration', () => {
	const namingFixture = {
		connections: [{ id: 'f', provider: 'fixture-cloud', label: 'Fixture Cloud', settings: {} }]
	};

	test('a config naming a fixture provider is refused by default', () => {
		expect(() => buildSources({ config: namingFixture, env: {}, catalog })).toThrow(
			/fixture-cloud/
		);
	});

	test('SOURCES_ALLOW_FIXTURES re-admits them, because saying so is the point', () => {
		const routers = buildSources({
			config: namingFixture,
			env: { SOURCES_ALLOW_FIXTURES: 'true' },
			catalog
		});

		expect(routers.infrastructure).toBeDefined();
	});

	test('any other value is not consent', () => {
		for (const value of ['1', 'yes', 'TRUE', '']) {
			expect(() =>
				buildSources({ config: namingFixture, env: { SOURCES_ALLOW_FIXTURES: value }, catalog })
			).toThrow(/fixture-cloud/);
		}
	});
});
