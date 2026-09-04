import type { ServiceSource } from '../../platform/source';
import type { ApmProvider } from '../contracts';
import { fanOut, fanOutSingle, type RouterDeps } from './shared';

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
 */
export function createServiceRouter(deps: RouterDeps, catalog: ServiceSource): ServiceSource {
	const source: ServiceSource = {
		id: 'routed',

		// App-owned.
		listServices: (scope, domainId) => catalog.listServices(scope, domainId),
		findService: (scope, slug) => catalog.findService(scope, slug),
		/*
		 * The join. Identity is the catalog's and the readings are APM's, but in this
		 * increment both come from the catalog, whose fixtures already produce them. The
		 * APM half arrives with the real provider; splitting it now would mean inventing
		 * a merge for data that comes from one place.
		 */
		listServiceVitals: (scope, domainId, vitals, total) =>
			catalog.listServiceVitals(scope, domainId, vitals, total),

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

		readMetricSeries: (scope, slug) =>
			fanOutSingle(deps, 'apm.metricSeries', scope, `service=${slug}`, (client, ctx) =>
				(client as ApmProvider).readMetricSeries!({
					...ctx,
					binding: apmBinding(slug)
				})
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
