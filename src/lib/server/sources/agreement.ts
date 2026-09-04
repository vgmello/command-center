import { CAPABILITIES, kindOf, type Capability } from '$lib/platform/sources';
import type { ProviderDefinition } from './provider';

/**
 * The method that answers each capability.
 *
 * One table rather than a naming convention, because two of them are irregular:
 * `deployment.log` is answered by two methods of different shapes, and the mapping has
 * to be readable by a person reviewing a new provider.
 */
export const CAPABILITY_METHODS: Record<Capability, string> = {
	'cloud.regions': 'listRegions',
	'cloud.nodes': 'readNodeCounts',
	'cloud.clusters': 'listClusters',
	'cloud.utilization': 'readUtilization',
	'cloud.storage': 'readStorage',
	'cloud.databases': 'listDatabases',
	'cloud.queues': 'listQueues',
	'cloud.alerts': 'listAlerts',
	'cloud.cost': 'readCost',
	'apm.serviceStats': 'readServiceStats',
	'apm.healthChecks': 'listHealthChecks',
	'apm.endpoints': 'listEndpoints',
	'apm.metricSeries': 'readMetricSeries',
	'apm.requestRate': 'readRequestRate',
	'apm.slo': 'readSloBudget',
	'apm.latencyHeatmap': 'readLatencyHeatmap',
	'apm.insights': 'listMetricInsights',
	'apm.platformInsights': 'listPlatformInsights',
	'apm.domainVitals': 'readDomainVitals',
	'apm.rates': 'readRates',
	'apm.incidents': 'listIncidents',
	'apm.activity': 'readActivitySummary',
	'apm.dependencies': 'readServiceDependencies',
	'deployment.log': 'queryDeployments',
	'deployment.summary': 'readSummary',
	'deployment.trends': 'readTrends',
	'deployment.statusTrend': 'readStatusTrend',
	'deployment.breakdown': 'readDomainBreakdown',
	'deployment.insights': 'listInsights',
	'deployment.domains': 'listDeployingDomains'
};

/**
 * `deployment.log` answers two questions of different shapes — a page and a recent
 * list — so both methods belong to it. This is the only such case, and it is recorded
 * here rather than hidden in the check.
 */
const EXTRA_METHODS: Partial<Record<Capability, string[]>> = {
	'deployment.log': ['listDeployments']
};

/**
 * Where a provider's declared capabilities and its actual methods disagree.
 *
 * Both directions matter. Declaring without implementing is a runtime hole a router
 * would fall into; implementing without declaring is dead code, because the registry's
 * capability index is what decides who gets called.
 */
export function capabilityDrift(
	definition: ProviderDefinition<unknown>,
	client: object
): { declaredNotImplemented: Capability[]; implementedNotDeclared: Capability[] } {
	const implemented = (capability: Capability) => {
		const names = [CAPABILITY_METHODS[capability], ...(EXTRA_METHODS[capability] ?? [])];
		return names.some((name) => typeof (client as Record<string, unknown>)[name] === 'function');
	};

	const ofThisKind = CAPABILITIES.filter((one) => kindOf(one) === definition.kind);

	return {
		declaredNotImplemented: [...definition.capabilities].filter((one) => !implemented(one)),
		implementedNotDeclared: ofThisKind.filter(
			(one) => implemented(one) && !definition.capabilities.has(one)
		)
	};
}
