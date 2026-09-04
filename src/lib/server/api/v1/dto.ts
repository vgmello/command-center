import * as v from 'valibot';
import type {
	ActivitySummary,
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
