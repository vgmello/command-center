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
 */

export interface DomainRefDto {
	id: string;
	name: string;
}

export interface DomainDto {
	id: string;
	name: string;
	criticality: Domain['criticality'];
	healthScore: number;
	status: Domain['status'];
	serviceCount: number;
	errorRatePct: number;
	p95LatencyMs: number;
	activeIncidents: number;
}

export interface PageDto {
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
}

export interface DomainPageDto {
	data: DomainDto[];
	page: PageDto;
}

export interface DomainSummaryDto {
	total: number;
	healthy: number;
	degraded: number;
	down: number;
	unknown: number;
}

export interface MetricDto {
	id: string;
	label: string;
	value: number;
	unit: string;
	kind: RateObservation['kind'];
	change: number;
	polarity: RateObservation['polarity'];
}

export interface IncidentDto {
	id: string;
	title: string;
	domain: DomainRefDto;
	severity: Incident['severity'];
	state: Incident['state'];
	openedAt: string;
}

export interface DeploymentDto {
	id: string;
	service: string;
	version: string;
	domain: DomainRefDto;
	status: Deployment['status'];
	deployedAt: string;
}

export interface InfrastructureDto {
	id: string;
	label: string;
	count: number;
	status: InfrastructureGroup['status'];
}

export interface SystemStatusDto {
	status: SystemStatus['status'];
	label: string;
	detail: string;
}

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
		activeIncidents: domain.activeIncidents
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
