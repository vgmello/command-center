import type { DeploymentStatus, DeploymentTrigger, TrendGrain } from './types';
import type { SelectOption } from './query';
import type { EnvironmentId } from './types';

/**
 * How you ask for deployments.
 *
 * Same shape and the same reasoning as `query.ts`: the closed sets are `as const`
 * arrays rather than bare unions, because the Valibot picklists guarding the endpoint
 * and the select controls in the toolbar both need the list at runtime. Declaring the
 * union twice is how the two drift — the UI offers a tab the server rejects.
 */

/**
 * The table's tabs.
 *
 * `completed` is not a `DeploymentStatus`: it covers everything that finished, which
 * is a success or a rollback. Keeping it out of the status vocabulary is what stops
 * "the deployment's state" and "which tab you are on" being confused for each other.
 */
export const DEPLOYMENT_STATES = ['all', 'in-progress', 'failed', 'completed'] as const;

export type DeploymentStateFilter = (typeof DEPLOYMENT_STATES)[number];

export const DEPLOYMENT_STATE_LABELS: Record<DeploymentStateFilter, string> = {
	all: 'All Deployments',
	'in-progress': 'In Progress',
	failed: 'Failed',
	completed: 'Completed'
};

/** Which statuses each tab admits. The single definition, so no adapter invents one. */
export const DEPLOYMENT_STATE_STATUSES: Record<DeploymentStateFilter, DeploymentStatus[]> = {
	all: ['success', 'failed', 'in-progress', 'rolled-back'],
	'in-progress': ['in-progress'],
	failed: ['failed'],
	completed: ['success', 'rolled-back']
};

export function matchesDeploymentState(
	status: DeploymentStatus,
	state: DeploymentStateFilter
): boolean {
	return DEPLOYMENT_STATE_STATUSES[state].includes(status);
}

/**
 * Date windows the toolbar offers.
 *
 * A preset list rather than a calendar: every one of these is a question someone
 * actually asks of a deployment log, none of them needs a date-picker dependency, and
 * an adapter can turn any of them into a `WHERE deployed_at > ?` without parsing.
 */
export const DEPLOYMENT_WINDOWS = ['any', 'today', '7d', '30d'] as const;

export type DeploymentWindow = (typeof DEPLOYMENT_WINDOWS)[number];

export const DEPLOYMENT_WINDOW_LABELS: Record<DeploymentWindow, string> = {
	any: 'Any time',
	today: 'Today',
	'7d': 'Last 7 days',
	'30d': 'Last 30 days'
};

/** Days each window looks back, or `null` for no bound. */
export const DEPLOYMENT_WINDOW_DAYS: Record<DeploymentWindow, number | null> = {
	any: null,
	today: 1,
	'7d': 7,
	'30d': 30
};

export const TREND_GRAINS = ['daily', 'weekly', 'monthly'] as const;

export const TREND_GRAIN_LABELS: Record<TrendGrain, string> = {
	daily: 'Daily',
	weekly: 'Weekly',
	monthly: 'Monthly'
};

export const DEPLOYMENT_TRIGGER_LABELS: Record<DeploymentTrigger, string> = {
	'ci-cd': 'CI/CD Pipeline',
	gitops: 'GitOps',
	manual: 'Manual',
	rollback: 'Rollback'
};

/** `all` is a filter value, not a domain or an environment, so it is a sentinel. */
export const ALL_DOMAINS = 'all';
export const ALL_ENVIRONMENTS = 'all';

export const DEPLOYMENT_PAGE_SIZES = [8, 25, 50] as const;

/** Filter and paging state for one request for deployments. Mirrors the toolbar. */
export interface DeploymentQuery {
	search: string;
	state: DeploymentStateFilter;
	/** A domain id, or `ALL_DOMAINS`. Open set, so validated as a bounded string. */
	domain: string;
	/** An environment id, or `ALL_ENVIRONMENTS`. */
	environment: EnvironmentId | typeof ALL_ENVIRONMENTS;
	window: DeploymentWindow;
	page: number;
	pageSize: number;
}

export function deploymentStateOptions(): SelectOption<DeploymentStateFilter>[] {
	return DEPLOYMENT_STATES.map((value) => ({ value, label: DEPLOYMENT_STATE_LABELS[value] }));
}

export function deploymentWindowOptions(): SelectOption<DeploymentWindow>[] {
	return DEPLOYMENT_WINDOWS.map((value) => ({ value, label: DEPLOYMENT_WINDOW_LABELS[value] }));
}

export function trendGrainOptions(): SelectOption<TrendGrain>[] {
	return TREND_GRAINS.map((value) => ({ value, label: TREND_GRAIN_LABELS[value] }));
}

export function deploymentPageSizeOptions(): SelectOption<string>[] {
	return DEPLOYMENT_PAGE_SIZES.map((size) => ({
		value: String(size),
		label: `${size} per page`
	}));
}

/**
 * Axis labels for a duration scale, in one unit for the whole axis.
 *
 * `formatDuration` is right for a cell and wrong for an axis: "1m 40s" beside "2m 30s"
 * is four labels' worth of width, and mixing "50s" with "1m 40s" makes the gaps look
 * uneven when they are not. The unit is chosen from the largest value so every tick on
 * one axis is measured the same way.
 */
export function durationAxisFormatter(maxSeconds: number): (value: number) => string {
	if (maxSeconds >= 600) return (value) => `${Math.round(value / 60)}m`;
	return (value) => `${Math.round(value)}s`;
}

/**
 * "3m 24s" / "58s" / "1h 04m".
 *
 * Deployment durations span seconds to hours, so a single unit either loses
 * resolution at one end or prints six digits at the other.
 */
export function formatDuration(seconds: number | null): string {
	// Not "0s": a running deployment has no duration yet, and zero would read as instant.
	if (seconds === null) return '—';

	if (seconds < 60) return `${Math.round(seconds)}s`;

	const minutes = Math.floor(seconds / 60);
	const rest = Math.round(seconds % 60);
	if (minutes < 60) return `${minutes}m ${String(rest).padStart(2, '0')}s`;

	const hours = Math.floor(minutes / 60);
	return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}
