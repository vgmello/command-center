import type { CatalogDomain, CatalogService } from './catalog';
import { statusFromScore } from './health';
import type { Domain, HealthStatus, Series, Service, ServiceVitals } from './types';

/**
 * Where the declared half and the read half meet.
 *
 * The catalog says what a service *is*; a source says how it is *doing*. Neither can
 * produce the other, and this is the one place they are joined — so a provider cannot
 * invent an owner and a catalog cannot invent a status.
 *
 * Pure, and therefore the same join whichever catalog and whichever APM source are
 * configured. Two implementations merging differently would put two versions of the same
 * service on two screens.
 */

/** What a source reports about one service. */
export interface ServiceReading {
	/** The catalog slug this reading belongs to. */
	service: string;
	errorRatePct: number;
	p95LatencyMs: number;
	requestsPerSecond: number;
	instancesHealthy: number;
	instancesTotal: number;
	activeAlerts: number;
	/**
	 * Recent history, where the source has it.
	 *
	 * Optional because a source may be able to answer "what is the error rate now"
	 * without answering "what was it for the last hour" — an instant query and a range
	 * query are different requests, and a provider that only has the first should say so
	 * rather than fabricate a flat line.
	 */
	errorSeries?: number[];
	healthSeries?: number[];
}

/** A sparkline from raw samples, or an empty one that draws nothing. */
function seriesOf(values: number[] | undefined): Series {
	if (!values || values.length === 0) return { values: [], min: 0, max: 0 };
	return { values, min: Math.min(...values), max: Math.max(...values) };
}

/**
 * How a reading scores out of a hundred.
 *
 * Stated as penalties rather than a formula nobody can explain, so a reader can be told
 * why a service scores 74. Errors weigh heaviest because a failing request is a failed
 * request; latency and dead instances degrade rather than break.
 */
export const SCORE_PENALTIES = {
	/** Points lost per percent of failing requests. */
	perErrorPercent: 8,
	/** Points lost per second of P95 latency above the first 200ms. */
	perLatencySecond: 15,
	/** Points lost for each instance that is not answering. */
	perDeadInstance: 6,
	/** Points lost per open alert. */
	perAlert: 3
} as const;

export function healthScoreOf(reading: ServiceReading): number {
	const dead = Math.max(0, reading.instancesTotal - reading.instancesHealthy);
	const slowSeconds = Math.max(0, reading.p95LatencyMs - 200) / 1000;

	const score =
		100 -
		reading.errorRatePct * SCORE_PENALTIES.perErrorPercent -
		slowSeconds * SCORE_PENALTIES.perLatencySecond -
		dead * SCORE_PENALTIES.perDeadInstance -
		reading.activeAlerts * SCORE_PENALTIES.perAlert;

	return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * A catalog entry plus what a source says about it.
 *
 * With no reading the service is `unknown` — not healthy, and not down. Nothing is
 * watching it, which is a different statement from either, and `HealthStatus` carries it
 * so the badge can say so rather than the page guessing.
 */
export function mergeService(
	entry: CatalogService,
	domainName: string,
	reading: ServiceReading | undefined
): Service {
	return {
		id: entry.id,
		slug: entry.slug,
		name: entry.name,
		description: entry.description,
		icon: entry.icon,
		accent: entry.accent,
		status: reading ? statusFromScore(healthScoreOf(reading)) : 'unknown',
		domainId: entry.domainId,
		domainName,
		owner: entry.owner,
		serviceType: entry.serviceType,
		language: entry.language,
		runtime: entry.runtime,
		repository: entry.repository,
		chatChannel: entry.chatChannel,
		runbook: entry.runbook,
		dashboard: entry.dashboard,
		instancesHealthy: reading?.instancesHealthy ?? 0,
		instancesTotal: reading?.instancesTotal ?? 0,
		activeAlerts: reading?.activeAlerts ?? 0
	};
}

/**
 * A row of a domain's service table.
 *
 * Built from the catalog's services and whatever is reporting on them, so the rows are
 * exactly the services declared — no more and no fewer. The old fixture generated rows to
 * match a count the domain claimed separately, which is how a header said 24 over a table
 * listing 2; a count derived from the catalog cannot disagree with the catalog.
 */
export function mergeVitals(
	entry: CatalogService,
	reading: ServiceReading | undefined
): ServiceVitals {
	return {
		id: entry.id,
		slug: entry.slug,
		name: entry.name,
		kind: entry.serviceType,
		icon: entry.icon,
		accent: entry.accent,
		status: reading ? statusFromScore(healthScoreOf(reading)) : 'unknown',
		requestsPerSecond: reading?.requestsPerSecond ?? 0,
		errorRatePct: reading?.errorRatePct ?? 0,
		p95LatencyMs: reading?.p95LatencyMs ?? 0,
		instancesHealthy: reading?.instancesHealthy ?? 0,
		instancesTotal: reading?.instancesTotal ?? 0,
		trend: seriesOf(reading?.errorSeries)
	};
}

/** The mean of a set, or zero for an empty one. */
function meanOf(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((sum, one) => sum + one, 0) / values.length;
}

/**
 * A domain, rolled up from the services the catalog says are in it.
 *
 * `serviceCount` is the number of services **declared**, not a figure the domain carries
 * separately. Two fixtures describing one quantity is how a header ends up saying 24 over
 * a table listing 2, and a count derived from the catalog cannot disagree with the
 * catalog.
 *
 * A domain with no readings at all is `unknown` and scores zero. The zero is not a claim
 * that its health is nought — the status carries the truth, and the score exists so the
 * table has something to sort by. Unscored domains therefore sort last, which is the
 * right place for something nothing is watching.
 */
export function rollUpDomain(
	entry: CatalogDomain,
	services: CatalogService[],
	readings: Map<string, ServiceReading>
): Domain {
	const known = services
		.map((one) => readings.get(one.slug))
		.filter((one): one is ServiceReading => one !== undefined);

	const scored = known.length > 0;
	const healthScore = scored ? Math.round(meanOf(known.map(healthScoreOf))) : 0;
	const status: HealthStatus = scored ? statusFromScore(healthScore) : 'unknown';

	return {
		id: entry.id,
		name: entry.name,
		shortName: entry.shortName,
		slug: entry.slug,
		icon: entry.icon,
		accent: entry.accent,
		criticality: entry.criticality,
		healthScore,
		status,
		serviceCount: services.length,
		errorRatePct: Math.round(meanOf(known.map((one) => one.errorRatePct)) * 100) / 100,
		p95LatencyMs: Math.round(meanOf(known.map((one) => one.p95LatencyMs))),
		activeIncidents: known.reduce((sum, one) => sum + one.activeAlerts, 0),
		owner: entry.owner,
		// Availability over the trailing week is not something a live reading answers —
		// it needs a window this join does not have. Derived from the score so it is at
		// least consistent with everything beside it, and stated here rather than
		// silently invented.
		availability7dPct: scored ? Math.round((99 + healthScore / 100) * 100) / 100 : 0,
		errorTrend: seriesOf(known.flatMap((one) => one.errorSeries ?? [])),
		healthTrend: seriesOf(known.flatMap((one) => one.healthSeries ?? [])),
		// Pins belong to the signed-in user, not to the domain. The workspace layer
		// applies them above this join, which is why every domain leaves it unpinned.
		favorite: false
	};
}
