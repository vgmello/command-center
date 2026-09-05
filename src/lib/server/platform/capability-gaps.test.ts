import { describe, expect, test } from 'bun:test';
import { SourceRegistry } from '../sources/registry';
import { createDispatcher } from '../sources/dispatch';
import { SourceCache } from '../sources/cache';
import { createRouters } from '../sources/routers';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../sources/fixtures';
import { FixturePlatformSource } from './fixture-source';
import { FixtureCatalogSource } from '../catalog/fixture-source';
import { CapabilityUnavailableError } from '../sources/errors';
import { CAPABILITY_TIER } from '../sources/tiers';
import { buildOverview } from './snapshot';
import { buildDomainsSnapshot } from './domains-view';
import { buildDomainSnapshot } from './domain-view';
import { buildDeploymentsSnapshot } from './deployments-view';
import { buildServiceSnapshot } from './service-view';
import { buildServiceMetricsSnapshot } from './service-metrics-view';
import { buildInfrastructureSnapshot } from './infrastructure-view';
import { kindOf, type Capability, type SourceKind } from '$lib/platform/sources';
import type { ProviderDefinition } from '../sources/provider';
import type { PlatformScope } from '$lib/platform/query';

/**
 * Which screens survive a source that cannot answer everything.
 *
 * A real provider declares only the capabilities it can serve, and an assembler that
 * calls an undeclared one takes its whole page down. That happened four times — deployment
 * insights, metric insights, service dependencies, the activity summary — and every one
 * was found by a person loading a page. Each was then wrapped in a `panel` individually,
 * which is a fix for the case that broke and no defence against the next one.
 *
 * This is the sweep that replaces waiting. It drops one capability at a time from the
 * fixture providers, and again a whole kind at a time, and runs every screen against the
 * result. The rule it enforces:
 *
 *   A screen falls over only when the source kind it is *dedicated to* cannot answer.
 *
 * The infrastructure page is a view of a cloud account and the deployments page is a view
 * of a CI/CD system; with those absent there is no page left to draw, and failing is the
 * honest outcome. Every other screen composes several kinds, so a gap in one must cost the
 * reader that panel and nothing else. A missing queue metric taking down the dashboard is
 * the specific bug this pins shut.
 */

const scope: PlatformScope = { environment: 'production', timeRange: '1h' };

/** The kind a screen cannot be drawn without. `null` means it composes several. */
const SCREENS: Array<{
	name: string;
	dedicatedTo: SourceKind | null;
	run: (routers: Routers) => Promise<unknown>;
}> = [
	{
		name: 'overview',
		dedicatedTo: null,
		run: (r) => buildOverview(r.platform, r.deployment, r.infrastructure, scope, new Date())
	},
	{
		name: 'domains',
		dedicatedTo: null,
		run: (r) => buildDomainsSnapshot(r.platform, r.deployment, scope, new Date())
	},
	{
		name: 'domain detail',
		dedicatedTo: null,
		run: (r) =>
			buildDomainSnapshot(r.platform, r.service, r.deployment, scope, 'payments', new Date())
	},
	{
		name: 'service detail',
		dedicatedTo: null,
		run: (r) => buildServiceSnapshot(r.service, r.deployment, scope, 'payments-api', new Date())
	},
	{
		name: 'service metrics',
		dedicatedTo: null,
		run: (r) => buildServiceMetricsSnapshot(r.service, scope, 'payments-api', new Date())
	},
	{
		name: 'deployments',
		dedicatedTo: 'deployment',
		run: (r) => buildDeploymentsSnapshot(r.deployment, scope, 'daily', new Date())
	},
	{
		name: 'infrastructure',
		dedicatedTo: 'cloud',
		run: (r) => buildInfrastructureSnapshot(r.infrastructure, scope, new Date())
	}
];

type Routers = ReturnType<typeof routersWithout>;

/**
 * The fixture providers, minus some capabilities.
 *
 * Dropping from the declaration rather than making the client throw is what makes this a
 * test of the *gap* path: an undeclared capability is a `CapabilityUnavailableError` from
 * the dispatcher, which is exactly what a partially-capable real provider produces.
 */
function routersWithout(dropped: readonly Capability[]) {
	const registry = new SourceRegistry();

	for (const provider of FIXTURE_PROVIDERS) {
		const capabilities = new Set(provider.capabilities);
		for (const one of dropped) capabilities.delete(one);
		registry.register({ ...provider, capabilities } as ProviderDefinition<unknown>);
	}

	registry.load(FIXTURE_CONNECTIONS, {});

	return createRouters(
		{ registry, dispatcher: createDispatcher(registry), cache: new SourceCache(), store: null },
		{ platform: new FixturePlatformSource(), services: new FixtureCatalogSource() }
	);
}

const ALL_CAPABILITIES = Object.keys(CAPABILITY_TIER) as Capability[];

/**
 * Run a screen and say how it ended.
 *
 * A gap is a legitimate outcome to weigh against the rule. Anything else is a bug of a
 * worse kind — a `TypeError` from a mapper handed `undefined` is not degradation, it is a
 * crash wearing a 500, and it must fail the test wherever it happens.
 */
async function outcome(
	screen: (typeof SCREENS)[number],
	dropped: readonly Capability[]
): Promise<'rendered' | 'gap'> {
	try {
		await screen.run(routersWithout(dropped));
		return 'rendered';
	} catch (cause) {
		if (cause instanceof CapabilityUnavailableError) return 'gap';
		throw cause;
	}
}

describe('one capability missing', () => {
	for (const capability of ALL_CAPABILITIES) {
		test(`${capability}: only its own dedicated screen may fall over`, async () => {
			for (const screen of SCREENS) {
				const result = await outcome(screen, [capability]);

				if (screen.dedicatedTo === kindOf(capability)) continue;

				expect(`${screen.name}: ${result}`).toBe(`${screen.name}: rendered`);
			}
		});
	}
});

describe('a whole kind missing', () => {
	for (const kind of ['cloud', 'apm', 'deployment'] as const) {
		const dropped = ALL_CAPABILITIES.filter((one) => kindOf(one) === kind);

		test(`no ${kind} source: every screen but its own still renders`, async () => {
			for (const screen of SCREENS) {
				const result = await outcome(screen, dropped);

				if (screen.dedicatedTo === kind) continue;

				expect(`${screen.name}: ${result}`).toBe(`${screen.name}: rendered`);
			}
		});
	}
});

describe('the rule is worth something', () => {
	test('a dedicated screen does fall over without its kind, so the exemption is real', async () => {
		// Without this the rule above would be satisfied by a suite that never exercises a
		// gap at all — the exemptions have to be load-bearing to mean anything.
		for (const screen of SCREENS) {
			if (!screen.dedicatedTo) continue;

			const dropped = ALL_CAPABILITIES.filter((one) => kindOf(one) === screen.dedicatedTo);
			expect(await outcome(screen, dropped)).toBe('gap');
		}
	});

	test('with everything declared, every screen renders', async () => {
		for (const screen of SCREENS) {
			expect(await outcome(screen, [])).toBe('rendered');
		}
	});
});
