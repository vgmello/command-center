import * as v from 'valibot';
import type {
	Deployment,
	Domain,
	DomainPage,
	DomainStatusCounts,
	Incident,
	InfrastructureGroup,
	RateObservation,
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
	service: v.string(),
	version: v.string(),
	domain: domainRefSchema,
	status: v.picklist(['success', 'failed', 'in-progress', 'rolled-back']),
	deployedAt: v.pipe(v.string(), v.isoTimestamp())
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

export function toDomainPageDto(result: DomainPage): DomainPageDto {
	return {
		data: result.domains.map(toDomainDto),
		page: {
			page: result.page.page,
			pageSize: result.page.pageSize,
			totalItems: result.page.totalItems,
			totalPages: result.page.totalPages
		}
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
		service: deployment.service,
		version: deployment.version,
		domain: { id: deployment.domainId, name: deployment.domainName },
		status: deployment.status,
		deployedAt: deployment.deployedAt
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
