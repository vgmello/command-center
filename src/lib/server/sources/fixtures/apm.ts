import * as v from 'valibot';
import * as catalog from '../../platform/service-fixtures';
import * as platform from '../../platform/fixtures';
import { defineProvider } from '../provider';
import type { ApmProvider } from '../contracts';
import type { LinkView, SourceBinding, SourceContext } from '../provider';

/** The slug a resource-scoped APM read is about, from its binding. */
function subject(ctx: SourceContext): string {
	return ctx.binding?.externalId ?? '';
}

export const fixtureApmProvider = defineProvider<ApmProvider>({
	id: 'fixture-apm',
	kind: 'apm',
	name: 'Fixture APM',
	icon: 'chart-column',
	capabilities: [
		'apm.serviceStats',
		'apm.healthChecks',
		'apm.endpoints',
		'apm.metricSeries',
		'apm.requestRate',
		'apm.slo',
		'apm.latencyHeatmap',
		'apm.insights',
		'apm.domainVitals',
		'apm.rates',
		'apm.incidents',
		'apm.activity',
		'apm.dependencies'
	],
	settings: v.object({}),
	connect: () => ({
		async readServiceStats(ctx) {
			return catalog.readServiceStats(subject(ctx));
		},
		async listHealthChecks(ctx) {
			return catalog.listHealthChecks(subject(ctx));
		},
		async readServiceDependencies(ctx) {
			return catalog.readDependencies(subject(ctx));
		},
		async readRequestRate(ctx) {
			return catalog.readRequestRate(subject(ctx), new Date());
		},
		async listEndpoints(ctx, limit) {
			return catalog.listEndpoints(subject(ctx), limit);
		},
		async readMetricSeries(ctx) {
			return catalog.readMetricSeries(subject(ctx), new Date());
		},
		async readSloBudget(ctx) {
			return catalog.readSloBudget(subject(ctx), new Date());
		},
		async readLatencyHeatmap(ctx) {
			return catalog.readLatencyHeatmap(subject(ctx), new Date());
		},
		async listMetricInsights(ctx) {
			return catalog.listMetricInsights(subject(ctx), new Date());
		},
		async readDomainVitals(ctx) {
			return platform.readDomainVitals(subject(ctx), new Date());
		},
		async readRates(ctx) {
			// The existing fixture keys its rates off the time range, which the scope carries.
			return platform.readPlatformRates(ctx.scope.timeRange);
		},
		async listIncidents(_ctx, limit) {
			return platform.listIncidents(new Date()).slice(0, limit);
		},
		async readActivitySummary() {
			return platform.listActivitySummary(new Date());
		},
		resourceLink(binding: SourceBinding | undefined, view: LinkView) {
			if (!binding) return null;
			return {
				label: 'Show in Fixture APM',
				href: `https://fixture.invalid/apm/${binding.externalId}/${view}`
			};
		}
	})
});
