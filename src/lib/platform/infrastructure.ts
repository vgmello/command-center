import type { SelectOption } from './query';

/**
 * The infrastructure view's vocabulary.
 *
 * Same shape as `services.ts`: the closed set lives here so the route's validation and
 * the tab strip are built from one list.
 */

export const INFRA_TABS = [
	'overview',
	'compute',
	'network',
	'storage',
	'databases',
	'messaging',
	'security',
	'costs',
	'capacity'
] as const;

export type InfraTab = (typeof INFRA_TABS)[number];

export const INFRA_TAB_LABELS: Record<InfraTab, string> = {
	overview: 'Overview',
	compute: 'Compute',
	network: 'Network',
	storage: 'Storage',
	databases: 'Databases',
	messaging: 'Messaging',
	security: 'Security',
	costs: 'Costs',
	capacity: 'Capacity'
};

export function isInfraTab(value: string): value is InfraTab {
	return (INFRA_TABS as readonly string[]).includes(value);
}

/** `overview` is the bare path, so the section has one canonical URL. */
export function infraTabHref(tab: InfraTab): string {
	return tab === 'overview' ? '/infrastructure' : `/infrastructure/${tab}`;
}

export function infraTabOptions(): SelectOption<InfraTab>[] {
	return INFRA_TABS.map((value) => ({ value, label: INFRA_TAB_LABELS[value] }));
}

/**
 * Bytes in the largest unit that keeps the number short.
 *
 * Powers of 1024 and the IEC-derived labels everyone actually reads: a 5.1 TB volume
 * is what the console says, not 5.6 TB.
 */
export function formatBytes(bytes: number, decimals = 1): string {
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	if (bytes < 1) return '0 B';

	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** exponent;

	return `${value.toFixed(exponent === 0 ? 0 : decimals).replace(/\.0$/, '')} ${units[exponent]}`;
}

/** Bits per second, which network gear is specified in and storage never is. */
export function formatBitrate(
	bitsPerSecond: number,
	decimals = 1
): { value: string; unit: string } {
	const units = ['bps', 'Kbps', 'Mbps', 'Gbps', 'Tbps'];
	if (bitsPerSecond < 1) return { value: '0', unit: 'bps' };

	const exponent = Math.min(Math.floor(Math.log10(bitsPerSecond) / 3), units.length - 1);
	const value = bitsPerSecond / 1000 ** exponent;

	return {
		value: value.toFixed(exponent === 0 ? 0 : decimals).replace(/\.0$/, ''),
		unit: units[exponent]
	};
}

/** "$28,540" — whole dollars, because nobody reads cents off a monthly total. */
export function formatMoney(amount: number): string {
	return `$${Math.round(amount).toLocaleString('en-US')}`;
}
