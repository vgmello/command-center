import type {
	CurrentUser,
	Deployment,
	DomainPage,
	DomainStatusCounts,
	FavoriteItem,
	Incident,
	InfrastructureGroup,
	RateObservation
} from '$lib/platform/types';
import type { DomainQuery, PlatformScope } from '$lib/platform/query';
import type { PlatformSource, WorkspaceSource } from './source';
import {
	CURRENT_USER,
	listDeployments,
	listDomains,
	listFavorites,
	listIncidents,
	listInfrastructure
} from './fixtures';
import { queryDomainsInMemory } from './in-memory-query';
import { buildSeries } from './series';

/**
 * The stand-in implementation: seeded fixtures, no I/O.
 *
 * Every method is `async` even though nothing here awaits. That is the point — the
 * interface is shaped for a real backend, so the day one arrives, no caller changes.
 * A synchronous port would have forced every consumer to be rewritten instead.
 */

const INCIDENT_SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

export class FixturePlatformSource implements PlatformSource {
	readonly id = 'fixture';

	async readDomainStatusCounts(_scope: PlatformScope): Promise<DomainStatusCounts> {
		const counts: DomainStatusCounts = { healthy: 0, degraded: 0, down: 0, unknown: 0 };
		for (const domain of listDomains()) counts[domain.status]++;
		return counts;
	}

	async queryDomains(_scope: PlatformScope, query: DomainQuery): Promise<DomainPage> {
		return queryDomainsInMemory(listDomains(), query);
	}

	/**
	 * The headline rates.
	 *
	 * These numbers are invented here rather than in the assembler above, because
	 * "what the request rate is" is the source's job — the assembler only decides how
	 * to print it. When a metrics backend replaces this, that division already holds.
	 */
	async readRates(scope: PlatformScope): Promise<RateObservation[]> {
		const window = scope.timeRange;

		return [
			{
				id: 'request-rate',
				label: 'Request Rate',
				value: 18_700,
				kind: 'rate',
				unit: 'req/s',
				samples: buildSeries(`request-rate:${window}`, 18_700, {
					volatility: 0.08,
					drift: 0.12
				}).values,
				change: 8.4,
				polarity: 'higher-is-better'
			},
			{
				id: 'error-rate',
				label: 'Error Rate',
				value: 1.38,
				kind: 'percent',
				unit: '',
				samples: buildSeries(`error-rate:${window}`, 1.38, { volatility: 0.2, drift: 0.35 }).values,
				change: 0.32,
				polarity: 'lower-is-better'
			},
			{
				id: 'p95-latency',
				label: 'P95 Latency',
				value: 412,
				kind: 'duration-ms',
				unit: 'ms',
				samples: buildSeries(`p95:${window}`, 412, { volatility: 0.12, drift: -0.15 }).values,
				change: -28,
				polarity: 'lower-is-better'
			}
		];
	}

	async listIncidents(_scope: PlatformScope, limit: number): Promise<Incident[]> {
		return listIncidents(new Date())
			.sort(
				(a, b) =>
					INCIDENT_SEVERITY_ORDER[a.severity] - INCIDENT_SEVERITY_ORDER[b.severity] ||
					Date.parse(b.openedAt) - Date.parse(a.openedAt)
			)
			.slice(0, limit);
	}

	async listDeployments(_scope: PlatformScope, limit: number): Promise<Deployment[]> {
		return listDeployments(new Date())
			.sort((a, b) => Date.parse(b.deployedAt) - Date.parse(a.deployedAt))
			.slice(0, limit);
	}

	async listInfrastructure(_scope: PlatformScope): Promise<InfrastructureGroup[]> {
		return listInfrastructure();
	}
}

/** The signed-in user and their pins, also faked until auth and preferences land. */
export class FixtureWorkspaceSource implements WorkspaceSource {
	readonly id = 'fixture';

	async readCurrentUser(): Promise<CurrentUser> {
		return CURRENT_USER;
	}

	async listFavorites(): Promise<FavoriteItem[]> {
		return listFavorites();
	}
}
