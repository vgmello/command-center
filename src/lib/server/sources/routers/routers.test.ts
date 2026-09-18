import { describe, expect, test } from 'bun:test';
import { FixtureCatalogSource } from '../../catalog/fixture-source';
import { createRouters } from './index';
import { createDispatcher } from '../dispatch';
import { SourceCache } from '../cache';
import { SourceRegistry } from '../registry';
import { CapabilityUnavailableError } from '../errors';
import { routeOne } from './shared';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../fixtures';
import { FixturePlatformSource } from '../../platform/fixture-source';
import type { PlatformScope } from '$lib/platform/query';
import type { ProviderDefinition } from '../provider';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };

function build(connections: unknown = FIXTURE_CONNECTIONS) {
	const registry = new SourceRegistry();
	for (const provider of FIXTURE_PROVIDERS) registry.register(provider);
	registry.load(connections, {});

	return createRouters(
		{
			registry,
			dispatcher: createDispatcher(registry),
			cache: new SourceCache()
		},
		{
			platform: new FixturePlatformSource(),
			services: new FixtureCatalogSource()
		}
	);
}

describe('the platform router', () => {
	test('serves catalog methods locally, with no source connected at all', async () => {
		const { platform } = build({ connections: [] });

		// The domain catalog is app-owned: it must not depend on an APM connection.
		expect(
			(
				await platform.queryDomains(scope, {
					search: '',
					status: 'all',
					owner: 'all',
					sort: 'health-score',
					page: 1,
					pageSize: 5
				})
			).domains
		).toHaveLength(5);
		expect(await platform.findDomain(scope, 'payment-domain')).not.toBeNull();

		// Declared, but nothing is watching them — so every domain is `unknown` rather
		// than healthy. Those are different statements, and reporting the second would be
		// the catalog claiming a health it has no way to know.
		const counts = await platform.readDomainStatusCounts(scope);
		expect(counts.healthy).toBe(0);
		expect(counts.unknown).toBeGreaterThan(0);
	});

	test('with an APM source connected, the domains are actually scored', async () => {
		const { platform } = build();
		const counts = await platform.readDomainStatusCounts(scope);

		expect(counts.healthy + counts.degraded + counts.down).toBeGreaterThan(0);
	});

	test('dispatches the APM-backed methods', async () => {
		const { platform } = build();

		expect(await platform.readRates(scope)).toHaveLength(3);
		expect(await platform.listIncidents(scope, 2)).toHaveLength(2);
		expect(await platform.readDomainVitals(scope, 'payment-domain')).not.toBeNull();
	});

	test('without an APM connection the APM-backed methods are unavailable', async () => {
		const { platform } = build({ connections: [] });

		await expect(platform.readRates(scope)).rejects.toThrow(CapabilityUnavailableError);
		await expect(platform.listIncidents(scope, 2)).rejects.toThrow(CapabilityUnavailableError);
	});
});

describe('the service router', () => {
	test('serves the catalog locally and the readings from APM', async () => {
		const { service } = build();

		expect((await service.listServices(scope)).length).toBeGreaterThan(0);
		expect(await service.findService(scope, 'payment-api')).not.toBeNull();
		expect((await service.readStats(scope, 'payment-api')).length).toBeGreaterThan(0);
		expect((await service.readSloBudget(scope, 'payment-api')).targetPct).toBe(99.9);
	});

	test('listServiceVitals returns the services the catalog declares, and no others', async () => {
		// It used to generate rows to reach a count the domain claimed separately, which
		// is how a header said 24 over a table listing 2. The count is the catalog's now,
		// so the two cannot disagree — and a domain with two declared services has two
		// rows, however many it once claimed.
		const { service } = build({ connections: [] });
		const catalog = new FixtureCatalogSource();
		const platform = new FixturePlatformSource();
		const vitals = (await platform.readDomainVitals(scope, 'payment-domain'))!;

		const declared = await catalog.listServices('payment-domain');
		const rows = await service.listServiceVitals(scope, 'payment-domain', vitals, declared.length);

		expect(rows).toHaveLength(declared.length);
		expect(rows.map((one) => one.slug)).toEqual(declared.map((one) => one.slug));
	});
});

describe('the deployment router', () => {
	test('dispatches every method', async () => {
		const { deployment } = build();

		expect(await deployment.listDeployments(scope, 3)).toHaveLength(3);
		expect((await deployment.readSummary(scope)).total).toBeGreaterThan(0);
		expect(await deployment.readStatusTrend(scope)).toHaveLength(3);
		expect((await deployment.readTrends(scope, 'daily')).frequency.points.length).toBeGreaterThan(
			0
		);
		expect((await deployment.listInsights(scope)).length).toBeGreaterThan(0);
		expect((await deployment.listDeployingDomains(scope)).length).toBeGreaterThan(0);
		expect((await deployment.readDomainBreakdown(scope)).total).toBeGreaterThan(0);
	});

	test('the estate figure is the sum of the services', async () => {
		// The property the estate read was rewired for. It used to be its own accumulation —
		// a second window fetch, stored against the single entity `''`, describing exactly
		// the runs the per-service rows describe — and under the fixtures the two disagreed
		// outright: 186 synthesised runs against 32 real ones.
		//
		// Now `readTrends` reads `readServiceTrends` and collapses it with `estateTrendsOf`,
		// so estate == sum(services) holds by construction. `source_series` is partitioned
		// by capability, so a legacy `''` row written under `deployment.trends` and a
		// per-service row written under `deployment.serviceTrends` live in different
		// partitions and are never read — let alone summed — together: a provider that can
		// only collapse falls back to its own `''` accumulation as an *alternative* path
		// (`fanOutSeries(deps, 'deployment.trends', …)`), taken only when no connection
		// declares `deployment.serviceTrends`, not merged with the per-service rows this test
		// exercises.
		const { deployment } = build();
		const [estate, perService] = await Promise.all([
			deployment.readTrends(scope, 'daily'),
			deployment.readServiceTrends(scope, 'daily')
		]);

		const estateRuns = estate.frequency.points.reduce((sum, one) => sum + one.value, 0);
		const splitRuns = perService.reduce(
			(sum, row) => sum + row.runs.points.reduce((inner, one) => inner + one.value, 0),
			0
		);

		expect(estateRuns).toBe(splitRuns);
		expect(estateRuns).toBeGreaterThan(0);
	});

	test('a filtered query still reaches the source and narrows', async () => {
		const { deployment } = build();
		const page = await deployment.queryDeployments(scope, {
			search: '',
			state: 'failed',
			domain: 'all',
			service: 'all',
			environment: 'all',
			window: 'any',
			page: 1,
			pageSize: 50
		});

		expect(page.deployments.every((one) => one.status === 'failed')).toBe(true);
	});

	test('without a deployment connection every method is unavailable', async () => {
		const { deployment } = build({ connections: [] });

		await expect(deployment.readSummary(scope)).rejects.toThrow(CapabilityUnavailableError);
	});

	test('a capability nobody accumulates throws rather than answering empty', async () => {
		// With no deployment connection at all, this is unavailable regardless of which
		// providers declare the capability — and that is the point: an empty array here
		// would read as "nothing deployed", not "nothing is measuring this", which is the
		// opposite statement.
		const { deployment } = build({ connections: [] });

		await expect(deployment.readServiceTrends(scope, 'daily')).rejects.toThrow(
			CapabilityUnavailableError
		);
	});

	test('per-service trends come back grouped by service', async () => {
		const { deployment } = build();
		const rows = await deployment.readServiceTrends(scope, 'daily');

		expect(rows.length).toBeGreaterThan(0);
		// The actual claim in this test's name: more than one distinct service comes
		// back, so a single merged row could not slip through.
		expect(new Set(rows.map((one) => one.service)).size).toBeGreaterThan(1);

		for (const row of rows) {
			expect(row.service.length).toBeGreaterThan(0);
			// One axis per row, so a domain can be summed bucket by bucket later.
			expect(row.runs.points.length).toBe(row.failures.points.length);
			expect(row.runs.points.length).toBe(row.durationTotal.points.length);
		}
	});
});

describe('a fan-out cache entry belongs to the connections that answered it', () => {
	/**
	 * The bug this pins shut was visible on a running page.
	 *
	 * Every aggregate read was cached under the literal key `fan-out`, so the key could
	 * not tell one set of connections from another. Swapping a fixture cloud for a real
	 * Azure left the previous answers matching, and the infrastructure page served storage,
	 * database and queue readings from a source that was no longer connected — for
	 * capabilities the new provider does not declare.
	 */
	test('a different set of connections does not inherit the previous answers', async () => {
		const store = new Map<string, unknown>();

		const build = (providerId: 'fixture-cloud' | 'other-cloud') => {
			const registry = new SourceRegistry();

			for (const provider of FIXTURE_PROVIDERS) {
				registry.register(
					provider.id === 'fixture-cloud'
						? ({ ...provider, id: providerId } as ProviderDefinition<unknown>)
						: provider
				);
			}

			registry.load(
				{
					connections: [
						{ id: providerId, provider: providerId, label: providerId, settings: {} },
						{ id: 'fixture-apm', provider: 'fixture-apm', label: 'APM', settings: {} },
						{
							id: 'fixture-deployment',
							provider: 'fixture-deployment',
							label: 'Deployments',
							settings: {}
						}
					]
				},
				{}
			);

			return {
				registry,
				dispatcher: createDispatcher(registry),
				cache: new SourceCache(),
				store: null
			};
		};

		const keys = new Set<string>();
		const cache = {
			read: async (key: { connectionId: string }, load: () => Promise<unknown>) => {
				keys.add(key.connectionId);
				store.set(key.connectionId, await load());
				return { data: store.get(key.connectionId) };
			}
		};

		const first = build('fixture-cloud');
		const second = build('other-cloud');

		await createRouters(
			{ ...first, cache: cache as unknown as SourceCache },
			{ platform: new FixturePlatformSource(), services: new FixtureCatalogSource() }
		).infrastructure.listRegions(scope);

		await createRouters(
			{ ...second, cache: cache as unknown as SourceCache },
			{ platform: new FixturePlatformSource(), services: new FixtureCatalogSource() }
		).infrastructure.listRegions(scope);

		// Two different connections, two different keys. One key would mean the second
		// read was served the first connection's answer.
		expect(keys.size).toBe(2);
		for (const key of keys) expect(key.startsWith('fan-out:')).toBe(true);
	});
});

describe('routeOne', () => {
	const ownerScope: PlatformScope = { environment: 'production', timeRange: '1h' };
	const binding = { kind: 'cloud' as const, connectionId: '', externalId: 'payment-domain' };

	function depsWith(connections: unknown) {
		const registry = new SourceRegistry();
		for (const p of FIXTURE_PROVIDERS) registry.register(p);
		registry.load(connections, {});
		return { registry, dispatcher: createDispatcher(registry), cache: new SourceCache() };
	}

	test('an empty connectionId resolves to the one connection of that kind', async () => {
		const deps = depsWith(FIXTURE_CONNECTIONS);
		let seen: string | undefined;
		await routeOne(
			deps,
			'cloud.nodes',
			ownerScope,
			binding,
			'owner=payment-domain',
			async (_c, ctx) => {
				seen = ctx.connection.id;
				return 1;
			}
		);
		expect(seen).toBe(deps.registry.supporting('cloud.nodes')[0].ref.id);
	});

	test('no connection of the kind → no-connection', async () => {
		await expect(
			routeOne(depsWith({ connections: [] }), 'cloud.nodes', ownerScope, binding, '', async () => 1)
		).rejects.toMatchObject({ reason: 'no-connection' });
	});

	test('kind present but none declaring the capability → no-capability', async () => {
		const withoutNodes = FIXTURE_PROVIDERS.map((provider) =>
			provider.id === 'fixture-cloud'
				? ({
						...provider,
						capabilities: new Set([...provider.capabilities].filter((c) => c !== 'cloud.nodes'))
					} as ProviderDefinition<unknown>)
				: provider
		);
		const registry = new SourceRegistry();
		for (const p of withoutNodes) registry.register(p);
		registry.load(FIXTURE_CONNECTIONS, {});
		const deps = { registry, dispatcher: createDispatcher(registry), cache: new SourceCache() };

		await expect(
			routeOne(deps, 'cloud.nodes', ownerScope, binding, '', async () => 1)
		).rejects.toMatchObject({ reason: 'no-capability' });
	});

	test('two connections of the kind → ambiguous-connection', async () => {
		// Two connections of one *synthetic* provider are refused at load
		// (`refuseMixedFixtures`) — a fixture beside another copy of itself would
		// merge invented rows into invented rows, which is exactly what that guard
		// exists to catch. Two real cloud providers connected at once (two Azure
		// subscriptions, say) is the legitimate case `resolveConnection` must handle,
		// so the second connection here is registered under a non-synthetic copy of
		// the fixture-cloud provider.
		const cloudProvider = FIXTURE_PROVIDERS.find((p) => p.id === 'fixture-cloud')!;
		const secondProvider = {
			...cloudProvider,
			id: 'fixture-cloud-2',
			synthetic: false
		} as ProviderDefinition<unknown>;

		const registry = new SourceRegistry();
		for (const p of FIXTURE_PROVIDERS) {
			registry.register(p.id === 'fixture-cloud' ? { ...p, synthetic: false } : p);
		}
		registry.register(secondProvider);
		registry.load(
			{
				connections: [
					...FIXTURE_CONNECTIONS.connections,
					{
						...FIXTURE_CONNECTIONS.connections.find(
							(c: { provider: string }) => c.provider === 'fixture-cloud'
						),
						id: 'cloud-2',
						provider: 'fixture-cloud-2'
					}
				]
			},
			{}
		);
		const deps = { registry, dispatcher: createDispatcher(registry), cache: new SourceCache() };

		await expect(
			routeOne(deps, 'cloud.nodes', ownerScope, binding, '', async () => 1)
		).rejects.toMatchObject({ reason: 'ambiguous-connection' });
	});

	test("a named binding is cached for its own connection's TTL, not the first connection's", async () => {
		// Same two-cloud registry as the ambiguous-connection test above, except the second
		// provider overrides the `cloud.nodes` TTL to one second. A binding that names it
		// must expire on that second, and a binding naming the first cloud must not — the
		// bug was `ttlFor` reading the first supporting connection's TTL for both.
		const cloudProvider = FIXTURE_PROVIDERS.find((p) => p.id === 'fixture-cloud')!;
		const secondProvider = {
			...cloudProvider,
			id: 'fixture-cloud-2',
			synthetic: false,
			ttl: { 'cloud.nodes': 1 }
		} as ProviderDefinition<unknown>;

		const registry = new SourceRegistry();
		for (const p of FIXTURE_PROVIDERS) {
			registry.register(p.id === 'fixture-cloud' ? { ...p, synthetic: false } : p);
		}
		registry.register(secondProvider);
		registry.load(
			{
				connections: [
					...FIXTURE_CONNECTIONS.connections,
					{
						...FIXTURE_CONNECTIONS.connections.find(
							(c: { provider: string }) => c.provider === 'fixture-cloud'
						),
						id: 'cloud-2',
						provider: 'fixture-cloud-2'
					}
				]
			},
			{}
		);

		let now = 1_700_000_000_000;
		const cache = new SourceCache({ now: () => now });
		const deps = { registry, dispatcher: createDispatcher(registry), cache };

		const calls = { first: 0, second: 0 };
		const first = { ...binding, connectionId: 'fixture-cloud' };
		const second = { ...binding, connectionId: 'cloud-2' };
		const countFirst = async () => ++calls.first;
		const countSecond = async () => ++calls.second;

		await routeOne(deps, 'cloud.nodes', ownerScope, first, 'owner=payment-domain', countFirst);
		await routeOne(deps, 'cloud.nodes', ownerScope, second, 'owner=payment-domain', countSecond);
		expect(calls).toEqual({ first: 1, second: 1 });

		// Inside both TTLs: neither re-calls.
		now += 500;
		await routeOne(deps, 'cloud.nodes', ownerScope, first, 'owner=payment-domain', countFirst);
		await routeOne(deps, 'cloud.nodes', ownerScope, second, 'owner=payment-domain', countSecond);
		expect(calls).toEqual({ first: 1, second: 1 });

		// Past the second cloud's one-second TTL, well inside the first's sixty: only the
		// binding naming the second connection goes back upstream.
		now += 1_000;
		await routeOne(deps, 'cloud.nodes', ownerScope, first, 'owner=payment-domain', countFirst);
		await routeOne(deps, 'cloud.nodes', ownerScope, second, 'owner=payment-domain', countSecond);
		expect(calls).toEqual({ first: 1, second: 2 });
	});

	test('a second read inside TTL issues no upstream call, and owners/environments key separately', async () => {
		const deps = depsWith(FIXTURE_CONNECTIONS);
		let calls = 0;
		const call = async () => {
			calls++;
			return calls;
		};
		await routeOne(deps, 'cloud.nodes', ownerScope, binding, 'owner=payment-domain', call);
		await routeOne(deps, 'cloud.nodes', ownerScope, binding, 'owner=payment-domain', call);
		expect(calls).toBe(1);

		await routeOne(
			deps,
			'cloud.nodes',
			ownerScope,
			{ ...binding, externalId: 'order-domain' },
			'owner=order-domain',
			call
		);
		expect(calls).toBe(2);

		await routeOne(
			deps,
			'cloud.nodes',
			{ ...ownerScope, environment: 'staging' },
			binding,
			'owner=payment-domain',
			call
		);
		expect(calls).toBe(3);
	});
});
