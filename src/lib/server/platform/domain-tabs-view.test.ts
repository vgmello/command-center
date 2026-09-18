import { describe, expect, test } from 'bun:test';
import {
	buildDomainDeploymentsSnapshot,
	buildDomainSlosSnapshot,
	DOMAIN_DEPLOYMENT_PAGE
} from './domain-tabs-view';
import { SourceRegistry } from '../sources/registry';
import { createDispatcher } from '../sources/dispatch';
import { SourceCache } from '../sources/cache';
import { createRouters } from '../sources/routers';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../sources/fixtures';
import { FixturePlatformSource } from './fixture-source';
import { FixtureCatalogSource } from '../catalog/fixture-source';
import type { ProviderDefinition } from '../sources/provider';
import type { Capability, Panel } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';

/**
 * The domain tabs, against routed fixtures rather than a hand-written double.
 *
 * Built the way `capability-gaps.test.ts` builds them — registry, dispatcher, cache,
 * `createRouters` over `FIXTURE_PROVIDERS` — because that is the only path the app has,
 * and a stub of the ports would not exercise the dispatcher's throw, which is the whole
 * subject of the second test below.
 */

const scope: PlatformScope = { environment: 'production', timeRange: '1h' };
const now = new Date();

/** The fixture providers, minus some capabilities — the sweep's `routersWithout`. */
function routers(dropped: readonly Capability[] = []) {
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

function ok<T>(panel: Panel<T>): T {
	if (panel.status !== 'ok') throw new Error(`expected a resolved panel, got ${panel.status}`);
	return panel.data;
}

function build(dropped: readonly Capability[] = [], slug = 'payment-domain') {
	const r = routers(dropped);
	return buildDomainDeploymentsSnapshot(r.platform, r.service, r.deployment, scope, slug, now);
}

describe('the domain deployments tab', () => {
	test('counts only the services this domain owns', async () => {
		const r = routers();
		const snapshot = await buildDomainDeploymentsSnapshot(
			r.platform,
			r.service,
			r.deployment,
			scope,
			'payment-domain',
			now
		);

		const stats = ok(snapshot!.stats);
		const owned = await r.service.listServices(scope, snapshot!.domain.id);

		expect(owned.length).toBeGreaterThan(0);
		expect(stats.byService.length).toBeGreaterThan(0);
		expect(stats.byService.every((row) => owned.some((one) => one.slug === row.service))).toBe(
			true
		);
	});

	test('the figures are the sum of the rows beneath them', async () => {
		// Two renderings of one quantity on one screen: the tiles and the table. A header
		// that does not add up to its own table is the commonest way a dashboard lies.
		const stats = ok((await build())!.stats);
		const summed = stats.byService.reduce((total, row) => total + row.total, 0);

		expect(summed).toBe(stats.total);
		expect(stats.byService.reduce((total, row) => total + row.failures, 0)).toBe(stats.failures);
	});

	test('the worst failure rate is the first row, which is what earns the tab', async () => {
		// "payment-gateway fails over its six deploys" is actionable; the domain's blended
		// rate is not. The order is the panel's whole argument, so it is asserted.
		const stats = ok((await build())!.stats);
		const rates = stats.byService.map((row) => row.changeFailureRatePct);

		expect(rates).toEqual([...rates].sort((a, b) => b - a));
	});

	test('a source that accumulates nothing leaves a gap, not a row of zeros', async () => {
		// A zeroed chart reads as "nothing deployed here", which is a different and false
		// statement from "nothing is measuring this". The router throws for exactly this
		// reason, and `panel()` is what turns the throw into a stated gap.
		const snapshot = await build(['deployment.serviceTrends']);

		expect(snapshot!.stats.status).toBe('unavailable');
		// The log is a different capability and still renders.
		expect(snapshot!.log.status).toBe('ok');
	});

	test('a gap in the log costs the log, not the figures', async () => {
		const snapshot = await build(['deployment.log']);

		expect(snapshot!.log.status).toBe('unavailable');
		expect(snapshot!.stats.status).toBe('ok');
	});

	test('an unknown domain is null, which the page renders as not-found', async () => {
		expect(await build([], 'nope')).toBeNull();
	});

	test('the window it measured is stated, not implied', async () => {
		// The trends look back a fortnight whatever range the top bar is set to, so the
		// label has to come from the grain rather than from the scope.
		expect((await build())!.windowLabel).toBe('Last 14 days');
	});

	test('the log is a page, and the source does the slicing', async () => {
		const rows = ok((await build())!.log);

		expect(rows.length).toBeLessThanOrEqual(DOMAIN_DEPLOYMENT_PAGE);
		expect(rows.every((row) => row.domainId === 'payment-domain')).toBe(true);
	});
});

/** `buildDomainSlosSnapshot` takes no `DeploymentSource`, so its own tiny builder. */
function buildSlos(dropped: readonly Capability[] = [], slug = 'payment-domain') {
	const r = routers(dropped);
	return buildDomainSlosSnapshot(r.platform, r.service, scope, slug, now);
}

describe('the domain SLOs tab', () => {
	test('the headline is the header’s figure, not one derived from the services', async () => {
		// A reader switching between tabs must not watch compliance move.
		const [snapshot, vitals] = await Promise.all([
			buildSlos(),
			routers().platform.readDomainVitals(scope, 'payment-domain')
		]);

		expect(ok(snapshot!.headline).compliancePct).toBe(vitals!.sloCompliancePct);
		expect(ok(snapshot!.headline).windowLabel).toBe(vitals!.sloWindowLabel);
	});

	test('one row per service the domain runs', async () => {
		const snapshot = await buildSlos();
		const domain = await routers().platform.findDomain(scope, 'payment-domain');

		expect(ok(snapshot!.services).length).toBe(domain!.serviceCount);
	});

	test('no SLO source leaves the table a gap while the headline stands', async () => {
		const snapshot = await buildSlos(['apm.slo']);

		expect(snapshot!.services.status).not.toBe('ok');
		expect(snapshot!.headline.status).toBe('ok');
	});

	test('no vitals leaves both the headline and the table a gap', async () => {
		// Not a mirror of the test above: `apm.slo` and `apm.domainVitals` are not
		// symmetric here. The table's rows are dealt out against the split
		// `apm.domainVitals` reports (`listDomainServiceVitals`, Task 8), so without it
		// there is no list of "this domain's services" to read budgets for either — a
		// `[]` would say "this domain runs no services", which is false. Losing
		// `apm.domainVitals` costs both panels; losing `apm.slo` alone costs only the one
		// that reads it.
		const snapshot = await buildSlos(['apm.domainVitals']);

		expect(snapshot!.headline.status).not.toBe('ok');
		expect(snapshot!.services.status).not.toBe('ok');
	});

	test('an unknown domain is null', async () => {
		expect(await buildSlos([], 'nope')).toBeNull();
	});
});
