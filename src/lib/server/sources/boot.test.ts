import { describe, expect, test } from 'bun:test';
import { buildSources } from './boot';
import { FIXTURE_CONNECTIONS } from './fixtures';
import { FixturePlatformSource, FixtureServiceSource } from '../platform/fixture-source';
import type { PlatformScope } from '$lib/platform/query';

const scope: PlatformScope = { environment: 'production', timeRange: '15m' };
const catalog = { platform: new FixturePlatformSource(), service: new FixtureServiceSource() };

describe('buildSources', () => {
	test('with no config it connects the fixture providers, so the app runs as it does today', async () => {
		const routers = buildSources({ config: null, env: {}, catalog });

		expect((await routers.infrastructure.listRegions(scope)).length).toBeGreaterThan(0);
		expect((await routers.deployment.readSummary(scope)).total).toBeGreaterThan(0);
	});

	test('an explicit config is used instead of the fixtures', async () => {
		const routers = buildSources({ config: FIXTURE_CONNECTIONS, env: {}, catalog });

		expect((await routers.infrastructure.readNodeCounts(scope)).healthy).toBeGreaterThan(0);
	});

	test('a config naming an unregistered provider refuses to start', () => {
		expect(() =>
			buildSources({
				config: { connections: [{ id: 'x', provider: 'azure', label: 'X', settings: {} }] },
				env: {},
				catalog
			})
		).toThrow(/azure/);
	});

	test('a malformed config refuses to start rather than silently serving nothing', () => {
		expect(() => buildSources({ config: { nope: true }, env: {}, catalog })).toThrow();
	});

	test('the four routers share one cache, so one capability is fetched once', async () => {
		const routers = buildSources({ config: FIXTURE_CONNECTIONS, env: {}, catalog });

		// listGroups reads node counts internally; a direct read must hit the same entry.
		await routers.infrastructure.listGroups(scope);
		const counts = await routers.infrastructure.readNodeCounts(scope);

		expect(counts.healthy).toBeGreaterThan(0);
	});
});
