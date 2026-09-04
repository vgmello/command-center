/**
 * The vocabulary of the platform view.
 *
 * These types are the contract between the server (which assembles a snapshot)
 * and the UI (which renders one). They are deliberately browser-safe — no imports
 * from `$lib/server` — because the same shapes cross the wire out of remote
 * functions and get rendered on the client.
 *
 * Design rule: the server sends *facts*, not presentation. A domain carries a
 * `status` and a `healthScore`, never a colour or a CSS class. Mapping status to
 * colour is the component layer's job, which is what lets the theme change
 * without touching the data layer.
 */

/** Operational state of anything that can be observed: a domain, a service, a cluster. */
export type HealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

/** How much the business cares. Drives ordering and escalation, not colour. */
export type Criticality = 'mission-critical' | 'business-critical' | 'important' | 'standard';

/** Incident severity, independent of the health status of what it affects. */
export type IncidentSeverity = 'critical' | 'warning' | 'info';

export type IncidentState = 'open' | 'acknowledged' | 'mitigated' | 'resolved';

export type DeploymentStatus = 'success' | 'failed' | 'in-progress' | 'rolled-back';

/** Which deployment target the whole view is scoped to. */
export type EnvironmentId = 'production' | 'staging' | 'development';

/** Lookback window for every metric and trend in a snapshot. */
export type TimeRangeId = '5m' | '15m' | '1h' | '6h' | '24h' | '7d';

/** Direction a metric moved over the compared window. */
export type TrendDirection = 'up' | 'down' | 'flat';

/**
 * Whether a rise in a metric is good or bad. Request rate going up is neutral-to-good;
 * error rate going up is bad. The UI cannot infer this from the number, so the server
 * states it.
 */
export type TrendPolarity = 'higher-is-better' | 'lower-is-better' | 'neutral';

/** Fixed palette of identity tints. A closed set, so the UI can map it exhaustively. */
export type DomainAccent = 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'slate';

export interface EnvironmentOption {
	id: EnvironmentId;
	label: string;
}

export interface TimeRangeOption {
	id: TimeRangeId;
	label: string;
	/** Window length in seconds — used for rate maths and axis labelling. */
	seconds: number;
}

/**
 * A sparkline series. Values are already in the metric's display unit; the UI
 * only needs min/max to scale, which are precomputed so every sparkline in a
 * table renders without a pass over the data.
 */
export interface Series {
	values: number[];
	min: number;
	max: number;
}

/** A headline metric with its trend, as rendered in the metric strip. */
export interface RateMetric {
	id: string;
	label: string;
	/** Pre-formatted for display, e.g. "18.7k" — the raw value stays available for sorting. */
	value: number;
	formatted: string;
	unit: string;
	series: Series;
	direction: TrendDirection;
	/** Signed change against the comparison window, in the metric's own unit. */
	changeFormatted: string;
	comparedToLabel: string;
	polarity: TrendPolarity;
}

/** One tile in the counts row: total / healthy / degraded / down. */
export interface CountTile {
	id: string;
	label: string;
	/** Icon key, named by the server for the same reason every other icon is. */
	icon: string;
	value: number;
	/** Share of the platform total, 0–100. `null` on the total tile itself. */
	percentage: number | null;
	caption: string | null;
	/** Which status vocabulary entry tints this tile; `null` renders neutral. */
	status: HealthStatus | null;
}

/** A slice of the health distribution donut. */
export interface DistributionSlice {
	status: HealthStatus;
	label: string;
	count: number;
	percentage: number;
}

export interface HealthDistribution {
	total: number;
	slices: DistributionSlice[];
}

/** Domains per status across the whole scope — an aggregate, not a page of rows. */
export type DomainStatusCounts = Record<HealthStatus, number>;

/**
 * A rate metric as *observed*, before anything decides how to print it.
 *
 * `kind` is what tells the formatter whether 412 is a duration, a percentage or a
 * count; `polarity` is what tells the UI whether an increase is good news. Neither
 * can be inferred from the number, so the source states both.
 */
export interface RateObservation {
	id: string;
	label: string;
	value: number;
	kind: 'rate' | 'percent' | 'duration-ms';
	/** Display unit for `rate`. Percent and duration derive their own. */
	unit: string;
	/** Raw samples across the scope's window, in the metric's own unit. */
	samples: number[];
	/** Signed change against the comparison window, in the metric's own unit. */
	change: number;
	polarity: TrendPolarity;
}

/** A business domain: the unit this dashboard is organised around. */
export interface Domain {
	id: string;
	name: string;
	/**
	 * The name without its category suffix — "Payment", not "Payment Domain".
	 *
	 * Sent rather than derived by stripping the word in the UI: a domain is called
	 * what its owners call it, and a client that guesses gets it wrong the first time
	 * one is named "Domain Registry". A table with eleven columns needs the short
	 * form; a sidebar and an incident feed need the full one, so both travel.
	 */
	shortName: string;
	slug: string;
	/** Icon key resolved to a Lucide component by the UI. Never a component here. */
	icon: string;
	/**
	 * Identity tint for the domain's icon tile — a stable property of the domain,
	 * like its name, not a reading of its current health. Health is carried by
	 * `status`; the two are allowed to disagree and usually do.
	 */
	accent: DomainAccent;
	criticality: Criticality;
	/** 0–100. The single number the table sorts by. */
	healthScore: number;
	status: HealthStatus;
	serviceCount: number;
	errorRatePct: number;
	p95LatencyMs: number;
	activeIncidents: number;
	/**
	 * The team accountable for the domain, as a handle (`@payments-team`).
	 *
	 * A string rather than a `TeamId` union: owners come from an org directory that
	 * changes without a deploy, so a closed set here would go stale the first time a
	 * team is renamed. The filter's option list is read from the source for the same
	 * reason.
	 */
	owner: string;
	/**
	 * Uptime over the trailing seven days, 0–100.
	 *
	 * Deliberately a fixed window, not the scope's `timeRange`: availability is an SLO
	 * measure and the SLO is stated in weeks. Recomputing it over "last 15 minutes"
	 * would print a number nobody has an objective for.
	 */
	availability7dPct: number;
	/** Error-rate trend over the snapshot window, drawn beside the error rate. */
	errorTrend: Series;
	/** Overall health trend over the snapshot window, drawn in the Trend column. */
	healthTrend: Series;
	favorite: boolean;
}

export interface Incident {
	id: string;
	title: string;
	domainId: string;
	domainName: string;
	severity: IncidentSeverity;
	state: IncidentState;
	/** ISO 8601. Rendered as "2m ago" client-side so it stays correct as time passes. */
	openedAt: string;
}

export interface Deployment {
	id: string;
	service: string;
	version: string;
	domainId: string;
	domainName: string;
	icon: string;
	status: DeploymentStatus;
	deployedAt: string;
}

/** One column of the infrastructure summary: clusters, nodes, databases, queues. */
export interface InfrastructureGroup {
	id: string;
	label: string;
	icon: string;
	count: number;
	status: HealthStatus;
	statusLabel: string;
}

/** The aggregate badge in the sidebar footer. */
export interface SystemStatus {
	status: HealthStatus;
	label: string;
	detail: string;
}

/** Server-side paging state for the domain table. */
export interface Page {
	page: number;
	pageSize: number;
	totalItems: number;
	totalPages: number;
	/** 1-based, inclusive — exactly what "Showing 1 to 8 of 25" needs. */
	from: number;
	to: number;
}

export interface DomainPage {
	domains: Domain[];
	page: Page;
}

/**
 * One entry in the owner filter.
 *
 * Carries its `domainCount` because the source counted them anyway while grouping,
 * and the UI would otherwise have to load every domain to say "12 domains" beside a
 * team — which is the whole thing pushing the query down was meant to avoid.
 */
export interface DomainOwner {
	id: string;
	label: string;
	domainCount: number;
}

/**
 * A domain whose health score moved, for the "Recently Changed" feed.
 *
 * Both scores travel rather than a pre-computed delta or a sentence: the direction
 * is derived from them in one place, and a caller that wants "up 7" can have it
 * without the server guessing which of the two framings it wanted.
 */
export interface DomainChange {
	id: string;
	domainId: string;
	name: string;
	icon: string;
	accent: DomainAccent;
	healthScore: number;
	previousScore: number;
	direction: TrendDirection;
	changedAt: string;
}

/**
 * Incident and deployment activity rolled up to counts.
 *
 * An aggregate, not a page of rows: the two tiles that render this need six numbers,
 * and a real backend answers that with a `GROUP BY` rather than by shipping every
 * incident of the day.
 */
export interface ActivitySummary {
	activeIncidents: number;
	/** How many distinct domains those incidents span — the tile's caption. */
	incidentDomains: number;
	deploymentsToday: number;
	deploymentDomains: number;
}

/** Everything the overview page needs except the paged domain table. */
export interface OverviewSnapshot {
	/** ISO 8601 timestamp of assembly — drives the "last updated" affordance. */
	generatedAt: string;
	environment: EnvironmentId;
	timeRange: TimeRangeId;
	counts: CountTile[];
	metrics: RateMetric[];
	distribution: HealthDistribution;
	incidents: Incident[];
	deployments: Deployment[];
	infrastructure: InfrastructureGroup[];
	system: SystemStatus;
}

/**
 * Everything the domains page needs except the paged table.
 *
 * A sibling of `OverviewSnapshot`, not an extension of it: the two screens answer
 * different questions and will diverge. Sharing one snapshot would mean every field
 * either screen ever needs crosses the wire for both.
 */
export interface DomainsSnapshot {
	generatedAt: string;
	environment: EnvironmentId;
	timeRange: TimeRangeId;
	counts: CountTile[];
	distribution: HealthDistribution;
	incidents: Incident[];
	changes: DomainChange[];
	/** The owner filter's options, read from the source rather than declared by the UI. */
	owners: DomainOwner[];
}

/** A sidebar navigation entry. */
export interface NavItem {
	id: string;
	label: string;
	href: string;
	icon: string;
	/** Rendered as a pill on the right of the item, e.g. the alert count. */
	badge?: number;
}

/** A favourited domain, pinned under the main nav. */
export interface FavoriteItem {
	id: string;
	label: string;
	href: string;
	status: HealthStatus;
	pinned: boolean;
}

export interface CurrentUser {
	name: string;
	role: string;
	initials: string;
	unreadNotifications: number;
}
