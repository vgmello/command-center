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
import { buildDomainSnapshot, listDomainServiceVitals } from './domain-view';
import { buildDomainDeploymentsSnapshot, buildDomainSlosSnapshot } from './domain-tabs-view';
import { buildDeploymentsSnapshot } from './deployments-view';
import { buildServiceSnapshot } from './service-view';
import { buildServiceMetricsSnapshot } from './service-metrics-view';
import { buildInfrastructureSnapshot } from './infrastructure-view';
import { kindOf, type Capability } from '$lib/platform/sources';
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
 * result. The rule it enforces, and the only one it enforces:
 *
 *   No screen falls over. Full stop.
 *
 * That is stronger than it first sounds, and it used to say less. The infrastructure and
 * deployments screens were once excused when their *dedicated* source kind — cloud,
 * deployment — was absent entirely, on the theory that a view of a cloud account with no
 * cloud account has nothing to draw. That theory was true of the data and false of the
 * page: the chrome, the headings and a stated gap are worth more than an error boundary,
 * and once every read on those two screens was wrapped they render without the exemption.
 * Worse, "dedicated" was read too broadly the first time it was written — it excused those
 * two screens not just when their kind was wholly absent but whenever *any single*
 * capability of that kind was missing, which is a different and much weaker claim. An
 * ARM-only Azure adapter that serves regions, nodes and spend but leaves utilisation to a
 * separate Monitor API found that gap immediately: the infrastructure page died on one
 * missing `cloud.utilization`, which the old exemption waved through as "expected" for a
 * screen dedicated to `cloud`. There is no exemption of either kind now, single-capability
 * or whole-kind: every screen renders under every drop this sweep tries.
 *
 * Read this test's assertions literally, not its title. `no screen falls over, not even
 * its own` runs every entry in `SCREENS` against every dropped capability — including
 * capabilities that screen never reads — which is deliberate: a screen must survive a gap
 * in a part of the platform it does not use, not just a gap in the part it does.
 *
 * A slug that resolves to nothing is not a gap it caught.
 *
 * Three of the seven original entries passed a slug the fixture catalog does not
 * contain — `'payments'` for the domain, `'payments-api'` for both service screens. Their
 * assemblers call `findDomain`/`findService` first and return `null` for an unknown slug,
 * before touching any source, so these three exercised the not-found path on every run and
 * passed regardless of which capability was dropped. The sweep still asserted "no screen
 * falls over" and was still correct about every other entry — the assertion was never
 * wrong, only vacuous for three of its seven cases, which is a harder thing to notice than
 * a red test. Correcting the slugs (`'payment-domain'`, `'payment-api'`) turned up five
 * real failures in the domain assembler and, once those were fixed, four more in both
 * service assemblers, none of which any previous run of this file had ever exercised. The
 * lesson for the next screen this file grows a case for: assert the slug resolves before
 * trusting a green run to mean the assembler was tested, not just called.
 */

const scope: PlatformScope = { environment: 'production', timeRange: '1h' };

const SCREENS: Array<{
	name: string;
	run: (routers: Routers) => Promise<unknown>;
}> = [
	{
		name: 'overview',
		run: (r) => buildOverview(r.platform, r.deployment, r.infrastructure, scope, new Date())
	},
	{
		name: 'domains',
		run: (r) => buildDomainsSnapshot(r.platform, r.deployment, scope, new Date())
	},
	{
		name: 'domain detail',
		run: (r) =>
			buildDomainSnapshot(r.platform, r.service, r.deployment, scope, 'payment-domain', new Date())
	},
	{
		name: 'domain services',
		run: (r) => listDomainServiceVitals(r.platform, r.service, scope, 'payment-domain')
	},
	{
		name: 'domain deployments',
		run: (r) =>
			buildDomainDeploymentsSnapshot(
				r.platform,
				r.service,
				r.deployment,
				scope,
				'payment-domain',
				new Date()
			)
	},
	{
		name: 'domain slos',
		run: (r) => buildDomainSlosSnapshot(r.platform, r.service, scope, 'payment-domain', new Date())
	},
	{
		name: 'service detail',
		run: (r) => buildServiceSnapshot(r.service, r.deployment, scope, 'payment-api', new Date())
	},
	{
		name: 'service metrics',
		run: (r) => buildServiceMetricsSnapshot(r.service, scope, 'payment-api', new Date())
	},
	{
		name: 'deployments',
		run: (r) => buildDeploymentsSnapshot(r.deployment, scope, 'daily', new Date())
	},
	{
		name: 'infrastructure',
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
		test(`${capability}: no screen falls over, not even its own`, async () => {
			/*
			 * No exemption here, and that is the correction.
			 *
			 * This used to skip the assertion when the screen was dedicated to the
			 * capability's kind, which sounded reasonable and hid a real bug: the
			 * infrastructure page is dedicated to `cloud`, so a *single* missing cloud
			 * capability was allowed to take it down. The first real cloud provider found
			 * it immediately — an ARM-only Azure adapter serves regions, nodes and spend
			 * and leaves utilisation to Monitor, and the page died on `cloud.utilization`.
			 *
			 * There is no dedicated-kind exemption left, in either direction. This block
			 * proves a screen survives one missing capability of its own kind; the next
			 * block ("a whole kind missing") proves the same screens survive that kind
			 * being absent entirely too. Being "dedicated to" a kind buys a screen nothing
			 * here — see the header above for why that theory was wrong.
			 */
			for (const screen of SCREENS) {
				const result = await outcome(screen, [capability]);

				expect(`${screen.name}: ${result}`).toBe(`${screen.name}: rendered`);
			}
		});
	}
});

describe('a whole kind missing', () => {
	for (const kind of ['cloud', 'apm', 'deployment'] as const) {
		const dropped = ALL_CAPABILITIES.filter((one) => kindOf(one) === kind);

		test(`no ${kind} source: every screen still renders`, async () => {
			/*
			 * No exemption here either, which is the stronger rule this ended at.
			 *
			 * The infrastructure and deployments screens used to be excused on the grounds
			 * that a view of a cloud account with no cloud account has nothing to draw.
			 * That was true of the data and false of the page: the chrome, the headings and
			 * the stated gaps are worth more than an error boundary, and once every read on
			 * those two screens was wrapped they render without the exemption.
			 */
			for (const screen of SCREENS) {
				const result = await outcome(screen, dropped);

				expect(`${screen.name}: ${result}`).toBe(`${screen.name}: rendered`);
			}
		});
	}
});

describe('the rule is worth something', () => {
	test('the sweep really does remove capabilities, so the rule is not vacuous', async () => {
		// Every assertion above is that something renders, which a suite dropping nothing
		// would also satisfy. This checks the mechanism itself.
		const routers = routersWithout(['cloud.regions']);

		expect(
			routers.infrastructure.listRegions({ environment: 'production', timeRange: '1h' })
		).rejects.toThrow(CapabilityUnavailableError);
	});

	test('with everything declared, every screen renders', async () => {
		for (const screen of SCREENS) {
			expect(await outcome(screen, [])).toBe('rendered');
		}
	});
});
