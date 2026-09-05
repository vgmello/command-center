import type { SelectOption } from './query';

/**
 * The domain view's vocabulary.
 *
 * Same shape as `services.ts` and `infrastructure.ts`: one list, used by both the route
 * guard and the tab strip.
 */

export const DOMAIN_TABS = [
	'overview',
	'services',
	'deployments',
	'infrastructure',
	'alerts',
	'slos',
	'dependencies',
	'logs'
] as const;

export type DomainTab = (typeof DOMAIN_TABS)[number];

export const DOMAIN_TAB_LABELS: Record<DomainTab, string> = {
	overview: 'Overview',
	services: 'Services',
	deployments: 'Deployments',
	infrastructure: 'Infrastructure',
	alerts: 'Alerts',
	slos: 'SLOs',
	dependencies: 'Dependencies',
	logs: 'Logs'
};

export function isDomainTab(value: string): value is DomainTab {
	return (DOMAIN_TABS as readonly string[]).includes(value);
}

/** `overview` is the bare domain path, so a domain has one canonical URL. */
export function domainTabHref(slug: string, tab: DomainTab): string {
	return tab === 'overview' ? `/domains/${slug}` : `/domains/${slug}/${tab}`;
}

export function domainTabOptions(): SelectOption<DomainTab>[] {
	return DOMAIN_TABS.map((value) => ({ value, label: DOMAIN_TAB_LABELS[value] }));
}

/** How many service rows the table shows before the reader asks for the rest. */
export const SERVICE_ROWS_COLLAPSED = 5;

/** "Show 9 more services" — or nothing at all when there are none. */
export function describeHiddenServices(total: number, shown: number): string | null {
	const hidden = total - shown;
	if (hidden <= 0) return null;
	return `Show ${hidden} more service${hidden === 1 ? '' : 's'}`;
}
