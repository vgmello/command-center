import * as v from 'valibot';
import type {
	ActivitySummary,
	ClusterLoad,
	CostBreakdown,
	DatabaseInstance,
	DomainDependencies,
	DomainVitals,
	InfraAlert,
	InfraRegion,
	MessageQueue,
	MetricInsight,
	NodeCounts,
	ResourceUsage,
	ServiceVitals,
	SloBudget,
	StorageClass,
	TimeSeries,
	Deployment,
	DeploymentPage,
	DeploymentSummary,
	Domain,
	DomainChange,
	DomainPage,
	DomainStatusCounts,
	FacetOption,
	Page,
	HealthCheck,
	Incident,
	InfrastructureGroup,
	RateObservation,
	Service,
	ServiceDependencies,
	ServiceEndpoint,
	SystemStatus
} from '$lib/platform/types';

/**
 * The frozen v1 wire contract.
 *
 * These types exist so that the internal shapes can change freely without breaking
 * anyone integrating against the API. Returning `OverviewSnapshot` or `Domain`
 * directly would make every field rename a breaking change discovered by a customer
 * rather than by a test.
 *
 * Two kinds of field are deliberately absent:
 *
 *  - **Presentation.** `icon`, `accent`, `statusLabel`, the pre-formatted strings —
 *    these are how *our* UI draws a thing, and mean nothing to another client.
 *  - **Render-time derivations.** Sparkline series carry precomputed `min`/`max`
 *    bounds for our SVG scaling. A time series is a reasonable thing to expose, but
 *    it should be exposed as timestamped samples, not as our drawing aid. Left out
 *    of v1 rather than shipped in a shape we would regret.
 *
 * Anything added here is permanent for v1. Removing or renaming means v2.
 *
 * Written as Valibot schemas rather than bare interfaces so the TypeScript types and
 * the published OpenAPI document come from one declaration. A hand-written spec
 * beside hand-written types is two things that drift.
 *
 * The enums are spelled out here rather than imported from the internal unions on
 * purpose: adding a fifth health status internally must not silently widen a
 * published contract. It should fail at the mapper and force a decision.
 */

const criticalitySchema = v.picklist([
	'mission-critical',
	'business-critical',
	'important',
	'standard'
]);
const healthStatusSchema = v.picklist(['healthy', 'degraded', 'down', 'unknown']);

export const domainRefSchema = v.object({
	id: v.string(),
	name: v.string()
});

export const domainSchema = v.object({
	id: v.string(),
	name: v.string(),
	criticality: criticalitySchema,
	/** 0–100; the single number the platform ranks domains by. */
	healthScore: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
	status: healthStatusSchema,
	serviceCount: v.pipe(v.number(), v.integer()),
	errorRatePct: v.number(),
	p95LatencyMs: v.number(),
	activeIncidents: v.pipe(v.number(), v.integer()),
	/** The accountable team's handle, e.g. `@payments-team`. */
	owner: v.string(),
	/** Uptime over the trailing seven days. A fixed window, not the request's range. */
	availability7dPct: v.pipe(v.number(), v.minValue(0), v.maxValue(100))
});

export const pageSchema = v.object({
	page: v.pipe(v.number(), v.integer()),
	pageSize: v.pipe(v.number(), v.integer()),
	totalItems: v.pipe(v.number(), v.integer()),
	totalPages: v.pipe(v.number(), v.integer())
});

export const domainPageSchema = v.object({
	data: v.array(domainSchema),
	page: pageSchema
});

export const domainSummarySchema = v.object({
	total: v.pipe(v.number(), v.integer()),
	healthy: v.pipe(v.number(), v.integer()),
	degraded: v.pipe(v.number(), v.integer()),
	down: v.pipe(v.number(), v.integer()),
	unknown: v.pipe(v.number(), v.integer())
});

export const metricSchema = v.object({
	id: v.string(),
	label: v.string(),
	value: v.number(),
	unit: v.string(),
	/** What the value is, so a client knows how to render it. */
	kind: v.picklist(['rate', 'percent', 'duration-ms']),
	/** Signed change over the requested window, in the metric's own unit. */
	change: v.number(),
	/** Whether an increase is good news. Not inferable from the number. */
	polarity: v.picklist(['higher-is-better', 'lower-is-better', 'neutral'])
});

export const incidentSchema = v.object({
	id: v.string(),
	title: v.string(),
	domain: domainRefSchema,
	severity: v.picklist(['critical', 'warning', 'info']),
	state: v.picklist(['open', 'acknowledged', 'mitigated', 'resolved']),
	openedAt: v.pipe(v.string(), v.isoTimestamp())
});

export const deploymentSchema = v.object({
	id: v.string(),
	/** The reference a human quotes, e.g. `#17892`. `id` is ours; this is theirs. */
	reference: v.string(),
	service: v.string(),
	version: v.string(),
	domain: domainRefSchema,
	environment: v.picklist(['production', 'staging', 'development']),
	status: v.picklist(['success', 'failed', 'in-progress', 'rolled-back']),
	trigger: v.picklist(['ci-cd', 'gitops', 'manual', 'rollback']),
	deployedBy: v.string(),
	deployedAt: v.pipe(v.string(), v.isoTimestamp()),
	/** Seconds, or null while the run is still going. Never 0 for "unfinished". */
	durationSeconds: v.nullable(v.pipe(v.number(), v.minValue(0)))
});

export const deploymentPageSchema = v.object({
	data: v.array(deploymentSchema),
	page: pageSchema
});

export const deploymentSummarySchema = v.object({
	total: v.pipe(v.number(), v.integer()),
	domainCount: v.pipe(v.number(), v.integer()),
	successful: v.pipe(v.number(), v.integer()),
	inProgress: v.pipe(v.number(), v.integer()),
	failed: v.pipe(v.number(), v.integer()),
	/** Mean wall-clock duration of the runs that finished, in seconds. */
	meanDurationSeconds: v.pipe(v.number(), v.minValue(0)),
	/** Share of runs that failed or were rolled back. */
	changeFailureRatePct: v.pipe(v.number(), v.minValue(0), v.maxValue(100))
});

export const activitySummarySchema = v.object({
	activeIncidents: v.pipe(v.number(), v.integer()),
	/** How many distinct domains those incidents span. */
	incidentDomains: v.pipe(v.number(), v.integer()),
	deploymentsToday: v.pipe(v.number(), v.integer()),
	deploymentDomains: v.pipe(v.number(), v.integer())
});

/** A filter option populated from the data: an owner, a domain, anything grouped. */
export const facetSchema = v.object({
	id: v.string(),
	label: v.string(),
	count: v.pipe(v.number(), v.integer())
});

export const domainChangeSchema = v.object({
	domain: domainRefSchema,
	healthScore: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
	previousScore: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
	direction: v.picklist(['up', 'down', 'flat']),
	changedAt: v.pipe(v.string(), v.isoTimestamp())
});

/** A labelled destination outside the platform: a repo, a channel, a runbook. */
export const linkSchema = v.object({
	label: v.string(),
	href: v.pipe(v.string(), v.url())
});

export const serviceSchema = v.object({
	id: v.string(),
	name: v.string(),
	description: v.string(),
	domain: domainRefSchema,
	status: healthStatusSchema,
	owner: v.string(),
	serviceType: v.string(),
	language: v.string(),
	runtime: v.string(),
	repository: linkSchema,
	chatChannel: linkSchema,
	runbook: linkSchema,
	/** The observability console, when the catalog records one. */
	dashboard: v.nullable(linkSchema),
	instancesHealthy: v.pipe(v.number(), v.integer()),
	instancesTotal: v.pipe(v.number(), v.integer()),
	activeAlerts: v.pipe(v.number(), v.integer())
});

/**
 * One SLI reading.
 *
 * The value is a number with its unit stated, not the pre-formatted string our table
 * prints: "517 ms" is a rendering, and a client that wants to alert on it needs the
 * number.
 */
export const healthCheckSchema = v.object({
	id: v.string(),
	label: v.string(),
	status: healthStatusSchema,
	value: v.number(),
	unit: v.picklist(['percent', 'milliseconds'])
});

export const dependencySchema = v.object({
	id: v.string(),
	name: v.string(),
	/** How they talk: HTTP, gRPC, PostgreSQL. Not inferable from the name. */
	protocol: v.string(),
	status: healthStatusSchema
});

export const dependenciesSchema = v.object({
	upstream: v.array(dependencySchema),
	downstream: v.array(dependencySchema)
});

export const endpointSchema = v.object({
	method: v.string(),
	path: v.string(),
	p95LatencyMs: v.pipe(v.number(), v.minValue(0)),
	requestsPerSecond: v.pipe(v.number(), v.minValue(0)),
	status: healthStatusSchema
});

/**
 * A labelled series.
 *
 * `min` and `max` are absent: they are precomputed so *our* charts can scale without a
 * pass over the data, which is a rendering concern. A client has the points.
 */
export const seriesSchema = v.object({
	id: v.string(),
	label: v.string(),
	points: v.array(v.object({ label: v.string(), value: v.number() }))
});

export const domainVitalsSchema = v.object({
	requestRate: seriesSchema,
	errorRate: seriesSchema,
	p95Latency: seriesSchema,
	services: v.object({
		healthy: v.pipe(v.number(), v.integer()),
		degraded: v.pipe(v.number(), v.integer()),
		down: v.pipe(v.number(), v.integer())
	}),
	sloCompliancePct: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
	sloWindow: v.string()
});

const domainNodeSchema = v.object({
	id: v.string(),
	name: v.string(),
	status: healthStatusSchema
});

export const domainDependenciesSchema = v.object({
	upstream: v.array(domainNodeSchema),
	downstream: v.array(domainNodeSchema),
	/** Domain names in order, describing how a failure propagates. */
	criticalPath: v.array(v.string())
});

/** One service of a domain, with the readings its health table prints. */
export const serviceVitalsSchema = v.object({
	id: v.string(),
	name: v.string(),
	kind: v.string(),
	status: healthStatusSchema,
	requestsPerSecond: v.pipe(v.number(), v.minValue(0)),
	errorRatePct: v.pipe(v.number(), v.minValue(0)),
	p95LatencyMs: v.pipe(v.number(), v.minValue(0)),
	instancesHealthy: v.pipe(v.number(), v.integer()),
	instancesTotal: v.pipe(v.number(), v.integer())
});

export const serviceMetricsSchema = v.object({
	requestRate: seriesSchema,
	p95Latency: seriesSchema,
	errorRate: seriesSchema,
	saturation: v.array(seriesSchema),
	byEndpoint: v.array(seriesSchema),
	byInstance: v.array(seriesSchema)
});

export const sloBudgetSchema = v.object({
	window: v.string(),
	achievedPct: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
	targetPct: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
	/** How much of the allowance is intact, 0–100. */
	remainingPct: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
	/** Minutes of the objective's allowance still unspent. */
	remainingMinutes: v.pipe(v.number(), v.minValue(0)),
	burnPct: v.pipe(v.number(), v.minValue(0))
});

export const metricInsightSchema = v.object({
	id: v.string(),
	kind: v.picklist(['anomaly', 'insight']),
	severity: v.picklist(['critical', 'warning', 'info']),
	title: v.string(),
	detail: v.string(),
	affects: v.string(),
	startedAt: v.pipe(v.string(), v.isoTimestamp())
});

export const regionSchema = v.object({
	id: v.string(),
	name: v.string(),
	status: healthStatusSchema,
	latitude: v.pipe(v.number(), v.minValue(-90), v.maxValue(90)),
	longitude: v.pipe(v.number(), v.minValue(-180), v.maxValue(180)),
	nodeCount: v.pipe(v.number(), v.integer())
});

export const nodeCountsSchema = v.object({
	healthy: v.pipe(v.number(), v.integer()),
	warning: v.pipe(v.number(), v.integer()),
	down: v.pipe(v.number(), v.integer())
});

export const clusterSchema = v.object({
	id: v.string(),
	name: v.string(),
	cpuPct: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
	status: healthStatusSchema
});

/**
 * One utilisation reading.
 *
 * `value` is the number in the unit stated, not the string our tile prints: a client
 * alerting on CPU needs 42, not "42".
 */
export const resourceUsageSchema = v.object({
	id: v.string(),
	label: v.string(),
	value: v.number(),
	unit: v.string(),
	series: seriesSchema
});

export const storageSchema = v.object({
	totalBytes: v.pipe(v.number(), v.minValue(0)),
	classes: v.array(
		v.object({
			id: v.string(),
			label: v.string(),
			bytes: v.pipe(v.number(), v.minValue(0))
		})
	)
});

export const databaseSchema = v.object({
	id: v.string(),
	name: v.string(),
	engine: v.string(),
	status: healthStatusSchema,
	cpuPct: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
	connections: v.pipe(v.number(), v.integer()),
	connectionLimit: v.pipe(v.number(), v.integer())
});

export const queueSchema = v.object({
	id: v.string(),
	name: v.string(),
	kind: v.string(),
	status: healthStatusSchema,
	messages: v.pipe(v.number(), v.integer()),
	/** Consumer lag in messages. Zero is an answer, not a missing value. */
	lag: v.pipe(v.number(), v.integer())
});

export const infraAlertSchema = v.object({
	id: v.string(),
	severity: v.picklist(['critical', 'warning', 'info']),
	title: v.string(),
	subject: v.string(),
	raisedAt: v.pipe(v.string(), v.isoTimestamp())
});

export const costSchema = v.object({
	/** One label per day, shared by every category. */
	days: v.array(v.string()),
	categories: v.array(
		v.object({
			id: v.string(),
			label: v.string(),
			amount: v.number(),
			/** Spend per day, in the same order as `days`. */
			daily: v.array(v.number())
		})
	),
	total: v.number(),
	forecast: v.number()
});

export const infrastructureSchema = v.object({
	id: v.string(),
	label: v.string(),
	count: v.pipe(v.number(), v.integer()),
	status: healthStatusSchema
});

export const systemStatusSchema = v.object({
	status: healthStatusSchema,
	label: v.string(),
	detail: v.string()
});

export const errorSchema = v.object({
	error: v.literal('invalid_request'),
	issues: v.array(v.object({ path: v.string(), message: v.string() }))
});

/**
 * A missing resource.
 *
 * A separate schema rather than making `issues` optional on the one above: the two
 * failures carry different information, and a client branching on `error` should not
 * also have to test whether a field happens to be present.
 */
export const notFoundSchema = v.object({
	error: v.literal('not_found'),
	message: v.string()
});

export type DomainRefDto = v.InferOutput<typeof domainRefSchema>;
export type DomainDto = v.InferOutput<typeof domainSchema>;
export type PageDto = v.InferOutput<typeof pageSchema>;
export type DomainPageDto = v.InferOutput<typeof domainPageSchema>;
export type DomainSummaryDto = v.InferOutput<typeof domainSummarySchema>;
export type MetricDto = v.InferOutput<typeof metricSchema>;
export type IncidentDto = v.InferOutput<typeof incidentSchema>;
export type DeploymentDto = v.InferOutput<typeof deploymentSchema>;
export type InfrastructureDto = v.InferOutput<typeof infrastructureSchema>;
export type SystemStatusDto = v.InferOutput<typeof systemStatusSchema>;

export function toDomainDto(domain: Domain): DomainDto {
	return {
		id: domain.id,
		name: domain.name,
		criticality: domain.criticality,
		healthScore: domain.healthScore,
		status: domain.status,
		serviceCount: domain.serviceCount,
		errorRatePct: domain.errorRatePct,
		p95LatencyMs: domain.p95LatencyMs,
		activeIncidents: domain.activeIncidents,
		owner: domain.owner,
		availability7dPct: domain.availability7dPct
	};
}

/**
 * Paging metadata, listed field by field like every other mapper.
 *
 * Extracted now that two resources page. `from` and `to` stay internal: they are the
 * "Showing 1 to 8 of 29" arithmetic our footer does, derivable from the four fields
 * here, and a contract is smaller when it does not publish its own conveniences.
 */
function toPageDto(page: Page): PageDto {
	return {
		page: page.page,
		pageSize: page.pageSize,
		totalItems: page.totalItems,
		totalPages: page.totalPages
	};
}

export function toDomainPageDto(result: DomainPage): DomainPageDto {
	return {
		data: result.domains.map(toDomainDto),
		page: toPageDto(result.page)
	};
}

export function toDomainSummaryDto(counts: DomainStatusCounts): DomainSummaryDto {
	return {
		total: counts.healthy + counts.degraded + counts.down + counts.unknown,
		healthy: counts.healthy,
		degraded: counts.degraded,
		down: counts.down,
		unknown: counts.unknown
	};
}

export function toMetricDto(observation: RateObservation): MetricDto {
	return {
		id: observation.id,
		label: observation.label,
		value: observation.value,
		unit: observation.kind === 'percent' ? '%' : observation.unit,
		kind: observation.kind,
		change: observation.change,
		polarity: observation.polarity
	};
}

export function toIncidentDto(incident: Incident): IncidentDto {
	return {
		id: incident.id,
		title: incident.title,
		domain: { id: incident.domainId, name: incident.domainName },
		severity: incident.severity,
		state: incident.state,
		openedAt: incident.openedAt
	};
}

export function toDeploymentDto(deployment: Deployment): DeploymentDto {
	return {
		id: deployment.id,
		reference: deployment.reference,
		service: deployment.service,
		version: deployment.version,
		domain: { id: deployment.domainId, name: deployment.domainName },
		environment: deployment.environment,
		status: deployment.status,
		trigger: deployment.trigger,
		deployedBy: deployment.deployedBy,
		deployedAt: deployment.deployedAt,
		durationSeconds: deployment.durationSeconds
	};
}

export type DeploymentPageDto = v.InferOutput<typeof deploymentPageSchema>;
export type DeploymentSummaryDto = v.InferOutput<typeof deploymentSummarySchema>;
export type ActivitySummaryDto = v.InferOutput<typeof activitySummarySchema>;
export type FacetDto = v.InferOutput<typeof facetSchema>;
export type DomainChangeDto = v.InferOutput<typeof domainChangeSchema>;
export type ServiceDto = v.InferOutput<typeof serviceSchema>;
export type HealthCheckDto = v.InferOutput<typeof healthCheckSchema>;
export type DependenciesDto = v.InferOutput<typeof dependenciesSchema>;
export type EndpointDto = v.InferOutput<typeof endpointSchema>;

export function toDeploymentPageDto(result: DeploymentPage): DeploymentPageDto {
	return {
		data: result.deployments.map(toDeploymentDto),
		page: toPageDto(result.page)
	};
}

/**
 * The day's deployment aggregate.
 *
 * The against-yesterday deltas the dashboard prints are deliberately absent: they are
 * a comparison this screen chose to draw, and a client with its own period can compute
 * a better one from two calls to this endpoint.
 */
export function toDeploymentSummaryDto(summary: DeploymentSummary): DeploymentSummaryDto {
	return {
		total: summary.total,
		domainCount: summary.domainCount,
		successful: summary.successful,
		inProgress: summary.inProgress,
		failed: summary.failed,
		meanDurationSeconds: summary.meanDurationSeconds,
		changeFailureRatePct: summary.changeFailureRatePct
	};
}

export function toActivitySummaryDto(activity: ActivitySummary): ActivitySummaryDto {
	return {
		activeIncidents: activity.activeIncidents,
		incidentDomains: activity.incidentDomains,
		deploymentsToday: activity.deploymentsToday,
		deploymentDomains: activity.deploymentDomains
	};
}

export function toFacetDto(option: FacetOption): FacetDto {
	return { id: option.id, label: option.label, count: option.count };
}

export function toDomainChangeDto(change: DomainChange): DomainChangeDto {
	return {
		domain: { id: change.domainId, name: change.name },
		healthScore: change.healthScore,
		previousScore: change.previousScore,
		direction: change.direction,
		changedAt: change.changedAt
	};
}

export function toServiceDto(service: Service): ServiceDto {
	return {
		id: service.slug,
		name: service.name,
		description: service.description,
		domain: { id: service.domainId, name: service.domainName },
		status: service.status,
		owner: service.owner,
		serviceType: service.serviceType,
		language: service.language,
		runtime: service.runtime,
		repository: service.repository,
		chatChannel: service.chatChannel,
		runbook: service.runbook,
		dashboard: service.dashboard,
		instancesHealthy: service.instancesHealthy,
		instancesTotal: service.instancesTotal,
		activeAlerts: service.activeAlerts
	};
}

/**
 * A health check as a number and a unit.
 *
 * The internal shape carries a formatted string and a sparkline because that is what
 * our table draws. A client wants the reading — it will render or alert on it its own
 * way — so the value is parsed back out of the check's own unit rather than shipped as
 * "517 ms".
 */
export function toHealthCheckDto(check: HealthCheck): HealthCheckDto {
	const percent = check.formatted.trim().endsWith('%');
	const value = Number.parseFloat(check.formatted);

	return {
		id: check.id,
		label: check.label,
		status: check.status,
		value: Number.isFinite(value) ? value : 0,
		unit: percent ? 'percent' : 'milliseconds'
	};
}

export function toDependenciesDto(dependencies: ServiceDependencies): DependenciesDto {
	const node = (one: ServiceDependencies['upstream'][number]) => ({
		id: one.id,
		name: one.name,
		protocol: one.protocol,
		status: one.status
	});

	return {
		upstream: dependencies.upstream.map(node),
		downstream: dependencies.downstream.map(node)
	};
}

/**
 * Both share fields are deliberately absent.
 *
 * `latencySharePct` and `requestSharePct` are bar widths, computed against whichever
 * endpoints we happened to return — a caller with a different `limit` would get
 * different percentages for the same traffic. The measurements they are derived from
 * travel instead, so a client can work out any share it actually wants.
 */
export function toEndpointDto(endpoint: ServiceEndpoint): EndpointDto {
	return {
		method: endpoint.method,
		path: endpoint.path,
		p95LatencyMs: endpoint.p95LatencyMs,
		requestsPerSecond: endpoint.requestsPerSecond,
		status: endpoint.status
	};
}

export type SeriesDto = v.InferOutput<typeof seriesSchema>;
export type DomainVitalsDto = v.InferOutput<typeof domainVitalsSchema>;
export type DomainDependenciesDto = v.InferOutput<typeof domainDependenciesSchema>;
export type ServiceVitalsDto = v.InferOutput<typeof serviceVitalsSchema>;
export type ServiceMetricsDto = v.InferOutput<typeof serviceMetricsSchema>;
export type SloBudgetDto = v.InferOutput<typeof sloBudgetSchema>;
export type MetricInsightDto = v.InferOutput<typeof metricInsightSchema>;
export type RegionDto = v.InferOutput<typeof regionSchema>;
export type NodeCountsDto = v.InferOutput<typeof nodeCountsSchema>;
export type ClusterDto = v.InferOutput<typeof clusterSchema>;
export type ResourceUsageDto = v.InferOutput<typeof resourceUsageSchema>;
export type StorageDto = v.InferOutput<typeof storageSchema>;
export type DatabaseDto = v.InferOutput<typeof databaseSchema>;
export type QueueDto = v.InferOutput<typeof queueSchema>;
export type InfraAlertDto = v.InferOutput<typeof infraAlertSchema>;
export type CostDto = v.InferOutput<typeof costSchema>;

/** Drops the precomputed bounds, which exist so our charts can scale in one pass. */
export function toSeriesDto(series: TimeSeries): SeriesDto {
	return {
		id: series.id,
		label: series.label,
		points: series.points.map((point) => ({ label: point.label, value: point.value }))
	};
}

export function toDomainVitalsDto(vitals: DomainVitals): DomainVitalsDto {
	return {
		requestRate: toSeriesDto(vitals.requestRate),
		errorRate: toSeriesDto(vitals.errorRate),
		p95Latency: toSeriesDto(vitals.p95Latency),
		services: {
			healthy: vitals.serviceCounts.healthy,
			degraded: vitals.serviceCounts.degraded,
			down: vitals.serviceCounts.down
		},
		sloCompliancePct: vitals.sloCompliancePct,
		sloWindow: vitals.sloWindowLabel
	};
}

export function toDomainDependenciesDto(dependencies: DomainDependencies): DomainDependenciesDto {
	const node = (one: DomainDependencies['upstream'][number]) => ({
		id: one.id,
		name: one.name,
		status: one.status
	});

	return {
		upstream: dependencies.upstream.map(node),
		downstream: dependencies.downstream.map(node),
		criticalPath: [...dependencies.criticalPath]
	};
}

/**
 * `icon`, `accent` and the sparkline are absent: the first two are how our table draws
 * a row, and the third is a shape precomputed for it.
 */
export function toServiceVitalsDto(vitals: ServiceVitals): ServiceVitalsDto {
	return {
		id: vitals.slug,
		name: vitals.name,
		kind: vitals.kind,
		status: vitals.status,
		requestsPerSecond: vitals.requestsPerSecond,
		errorRatePct: vitals.errorRatePct,
		p95LatencyMs: vitals.p95LatencyMs,
		instancesHealthy: vitals.instancesHealthy,
		instancesTotal: vitals.instancesTotal
	};
}

export function toServiceMetricsDto(series: {
	requestRate: TimeSeries;
	p95Latency: TimeSeries;
	errorRate: TimeSeries;
	saturation: TimeSeries[];
	byEndpoint: TimeSeries[];
	byInstance: TimeSeries[];
}): ServiceMetricsDto {
	return {
		requestRate: toSeriesDto(series.requestRate),
		p95Latency: toSeriesDto(series.p95Latency),
		errorRate: toSeriesDto(series.errorRate),
		saturation: series.saturation.map(toSeriesDto),
		byEndpoint: series.byEndpoint.map(toSeriesDto),
		byInstance: series.byInstance.map(toSeriesDto)
	};
}

/**
 * The budget as minutes, not as the string our panel prints.
 *
 * "21h 36m" is a rendering; a client deciding whether to freeze a release needs the
 * number. The burn sparkline is likewise ours and does not travel.
 */
export function toSloBudgetDto(slo: SloBudget): SloBudgetDto {
	return {
		window: slo.label,
		achievedPct: slo.achievedPct,
		targetPct: slo.targetPct,
		remainingPct: slo.remainingPct,
		// The same number the panel's label is built from, not a second derivation of it.
		remainingMinutes: slo.remainingMinutes,
		burnPct: slo.burnPct
	};
}

export function toMetricInsightDto(insight: MetricInsight): MetricInsightDto {
	return {
		id: insight.id,
		kind: insight.kind,
		severity: insight.severity,
		title: insight.title,
		detail: insight.detail,
		affects: insight.affects,
		startedAt: insight.startedAt
	};
}

export function toRegionDto(region: InfraRegion): RegionDto {
	return {
		id: region.id,
		name: region.name,
		status: region.status,
		latitude: region.latitude,
		longitude: region.longitude,
		nodeCount: region.nodeCount
	};
}

export function toNodeCountsDto(counts: NodeCounts): NodeCountsDto {
	return { healthy: counts.healthy, warning: counts.warning, down: counts.down };
}

export function toClusterDto(cluster: ClusterLoad): ClusterDto {
	return {
		id: cluster.id,
		name: cluster.name,
		cpuPct: cluster.cpuPct,
		status: cluster.status
	};
}

/**
 * The reading as a number in the unit its series is measured in.
 *
 * Not `usage.unit`, which is the unit the *headline* is printed in: the network tile
 * says "1.2 Gbps" while its series carries bits per second, so publishing that pairing
 * would label 1,200,000,000 as gigabits. The base unit is stated instead, and a client
 * scales it however it likes.
 *
 * `formatted`, `axisMax` and the signed change are all how a tile draws this.
 */
export function toResourceUsageDto(usage: ResourceUsage): ResourceUsageDto {
	return {
		id: usage.id,
		label: usage.label,
		value: usage.series.points.at(-1)?.value ?? 0,
		unit: usage.unit === '%' ? 'percent' : 'bits_per_second',
		series: toSeriesDto(usage.series)
	};
}

/** Bytes, not "5.1 TB": the unit a client picks is its own business. */
export function toStorageDto(storage: { totalBytes: number; classes: StorageClass[] }): StorageDto {
	return {
		totalBytes: storage.totalBytes,
		classes: storage.classes.map((one) => ({
			id: one.id,
			label: one.label,
			// The internal shape formats and rounds to a share; the bytes are recovered
			// from the total so the parts still sum to it.
			bytes: Math.round((one.percentage / 100) * storage.totalBytes)
		}))
	};
}

export function toDatabaseDto(database: DatabaseInstance): DatabaseDto {
	return {
		id: database.id,
		name: database.name,
		engine: database.engine,
		status: database.status,
		cpuPct: database.cpuPct,
		connections: database.connections,
		connectionLimit: database.connectionLimit
	};
}

export function toQueueDto(queue: MessageQueue): QueueDto {
	return {
		id: queue.id,
		name: queue.name,
		kind: queue.kind,
		status: queue.status,
		messages: queue.messages,
		lag: queue.lag
	};
}

export function toInfraAlertDto(alert: InfraAlert): InfraAlertDto {
	return {
		id: alert.id,
		severity: alert.severity,
		title: alert.title,
		subject: alert.subject,
		raisedAt: alert.raisedAt
	};
}

/**
 * Spend as numbers.
 *
 * The pre-formatted totals, the accents and the percentage shares are all ours: a
 * client with the daily figures can compute any share it wants, against whatever
 * denominator it cares about.
 */
export function toCostDto(cost: CostBreakdown): CostDto {
	return {
		days: [...cost.labels],
		categories: cost.categories.map((category) => ({
			id: category.id,
			label: category.label,
			amount: category.amount,
			daily: [...category.daily]
		})),
		total: cost.total,
		forecast: cost.forecast
	};
}

export function toInfrastructureDto(group: InfrastructureGroup): InfrastructureDto {
	return {
		id: group.id,
		label: group.label,
		count: group.count,
		status: group.status
	};
}

export function toSystemStatusDto(status: SystemStatus): SystemStatusDto {
	return { status: status.status, label: status.label, detail: status.detail };
}
