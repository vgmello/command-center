import type { SelectOption } from './query';

/**
 * The service view's vocabulary.
 *
 * Same reasoning as `query.ts` and `deployments.ts`: closed sets live here as `as const`
 * arrays so the Valibot picklist guarding the route and the tab strip that renders it
 * are built from one list. A tab the UI offers and the router rejects is the failure
 * this prevents.
 */

/**
 * The service detail tabs.
 *
 * `overview` is the index route; every other value is a path segment under it. Listing
 * them here is what lets the route validate its `tab` param instead of rendering a
 * page for any string someone types.
 */
export const SERVICE_TABS = [
	'overview',
	'deployments',
	'metrics',
	'traces',
	'logs',
	'alerts',
	'dependencies',
	'configuration'
] as const;

export type ServiceTab = (typeof SERVICE_TABS)[number];

export const SERVICE_TAB_LABELS: Record<ServiceTab, string> = {
	overview: 'Overview',
	deployments: 'Deployments',
	metrics: 'Metrics',
	traces: 'Traces',
	logs: 'Logs',
	alerts: 'Alerts',
	dependencies: 'Dependencies',
	configuration: 'Configuration'
};

export function isServiceTab(value: string): value is ServiceTab {
	return (SERVICE_TABS as readonly string[]).includes(value);
}

/**
 * Where a tab lives.
 *
 * `overview` is the bare service path rather than `/overview`, so the canonical URL of
 * a service is the short one — that is what gets pasted into an incident channel.
 */
export function serviceTabHref(slug: string, tab: ServiceTab): string {
	return tab === 'overview' ? `/services/${slug}` : `/services/${slug}/${tab}`;
}

export function serviceTabOptions(): SelectOption<ServiceTab>[] {
	return SERVICE_TABS.map((value) => ({ value, label: SERVICE_TAB_LABELS[value] }));
}

/** "3 / 3" reads better than "3 of 3" in a tile, and the slash is not a fraction bar. */
export function formatInstances(healthy: number, total: number): string {
	return `${healthy} / ${total}`;
}

/**
 * "100% healthy" / "2 of 3 healthy".
 *
 * Says the share when every instance agrees and the counts when they do not, because
 * "67% healthy" hides which instance is the problem while "2 of 3" invites the click.
 */
export function describeInstanceHealth(healthy: number, total: number): string {
	if (total === 0) return 'No instances';
	if (healthy === total) return '100% healthy';
	return `${healthy} of ${total} healthy`;
}
