import type { ServiceSource } from '../../platform/source';
import type { CatalogSource } from '../../catalog/source';
import { identityFor } from '$lib/platform/catalog';
import { mergeService, mergeVitals, type ServiceReading } from '$lib/platform/catalog-merge';
import type { ApmProvider } from '../contracts';
import { fanOut, fanOutSeries, fanOutSingle, type RouterDeps } from './shared';
import { metricSeriesShape } from './metric-series-shape';

const apmBinding = (slug: string) => ({
	kind: 'apm' as const,
	connectionId: '',
	externalId: slug
});

/**
 * `ServiceSource`, split between the catalog and an APM source.
 *
 * The catalog half is what a service *is*; the APM half is what it is *doing*. That is
 * also why Coralogix could never implement this port directly: it has no idea what
 * services exist, only what is emitting telemetry.
 *
 * The join happens here and in `catalog-merge`, once — so a catalog cannot invent a
 * status and a provider cannot invent an owner.
 */
export function createServiceRouter(deps: RouterDeps, catalog: CatalogSource): ServiceSource {
	/** Readings keyed by catalog slug, or an empty map when nothing answers. */
	async function readings(scope: Parameters<ServiceSource['listServices']>[0]) {
		try {
			const rows = await fanOut<ServiceReading>(
				deps,
				'apm.serviceHealth',
				scope,
				'',
				(client, ctx) => (client as ApmProvider).readServiceHealth!(ctx)
			);

			return new Map(rows.map((one) => [one.service, one]));
		} catch {
			// No APM source, or none that reports per-service health. The catalog still
			// renders and every service reads `unknown`, which is the honest answer for
			// something nothing is watching — and much better than no page at all.
			return new Map<string, ServiceReading>();
		}
	}

	/** The catalog's own name for a service, as the APM source knows it. */
	function apmName(entry: {
		slug: string;
		identity: Parameters<typeof identityFor>[0]['identity'];
	}) {
		return identityFor(entry, 'apm');
	}
	const source: ServiceSource = {
		id: 'routed-service',

		// Declared by the catalog, joined with whatever a source reports.
		listServices: async (scope, domainId) => {
			const [entries, byService] = await Promise.all([
				catalog.listServices(domainId),
				readings(scope)
			]);
			const domains = new Map((await catalog.listDomains()).map((one) => [one.id, one.name]));

			return entries.map((entry) =>
				mergeService(
					entry,
					domains.get(entry.domainId) ?? entry.domainId,
					byService.get(apmName(entry))
				)
			);
		},

		findService: async (scope, slug) => {
			const entry = await catalog.findService(slug);
			if (!entry) return null;

			const [byService, domain] = await Promise.all([
				readings(scope),
				catalog.findDomain(entry.domainId)
			]);

			return mergeService(entry, domain?.name ?? entry.domainId, byService.get(apmName(entry)));
		},
		/**
		 * One row per service the catalog declares in this domain.
		 *
		 * `vitals` and `total` are still taken, because the port's callers pass them, but
		 * the rows no longer have to be generated to match a claimed count — the count is
		 * now the catalog's own, so the table and the header cannot disagree.
		 */
		listServiceVitals: async (scope, domainId) => {
			const [entries, byService] = await Promise.all([
				catalog.listServices(domainId),
				readings(scope)
			]);

			return entries.map((entry) => mergeVitals(entry, byService.get(apmName(entry))));
		},

		// Source-backed.
		readStats: (scope, slug) =>
			fanOut(deps, 'apm.serviceStats', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readServiceStats!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		listHealthChecks: (scope, slug) =>
			fanOut(deps, 'apm.healthChecks', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).listHealthChecks!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		readDependencies: (scope, slug) =>
			fanOutSingle(deps, 'apm.dependencies', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readServiceDependencies!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		readRequestRate: (scope, slug) =>
			fanOutSingle(deps, 'apm.requestRate', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readRequestRate!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		listEndpoints: (scope, slug, limit) =>
			fanOut(deps, 'apm.endpoints', scope, `service=${slug}&limit=${limit}`, (client, ctx) =>
				(client as ApmProvider).listEndpoints!({ ...ctx, binding: apmBinding(slug) }, limit)
			),

		/**
		 * The six series the metrics tab draws, accumulated rather than re-fetched.
		 *
		 * This is the read that most wanted a store: a twenty-four-hour chart refreshing
		 * every thirty seconds otherwise re-reads a day of settled history 2,880 times a
		 * day. The shape below is what lets a whole answer be taken apart into samples and
		 * put back together — six named series, three of which are per-entity families.
		 */
		readMetricSeries: (scope, slug) =>
			fanOutSeries(
				deps,
				'apm.metricSeries',
				scope,
				`service=${slug}`,
				metricSeriesShape(slug, scope),
				(client, ctx) =>
					(client as ApmProvider).readMetricSeries!({ ...ctx, binding: apmBinding(slug) })
			),

		readSloBudget: (scope, slug) =>
			fanOutSingle(deps, 'apm.slo', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readSloBudget!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		readLatencyHeatmap: (scope, slug) =>
			fanOutSingle(deps, 'apm.latencyHeatmap', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readLatencyHeatmap!({
					...ctx,
					binding: apmBinding(slug)
				})
			),

		listMetricInsights: (scope, slug) =>
			fanOut(deps, 'apm.insights', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).listMetricInsights!({
					...ctx,
					binding: apmBinding(slug)
				})
			)
	};

	return source;
}
