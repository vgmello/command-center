import { formatChange } from './format';
import type { SelectOption } from './query';
import type {
	CostBreakdown,
	CostBreakdownView,
	DomainAccent,
	ResourceReading,
	ResourceUsage,
	StorageClass,
	StorageClassView
} from './types';

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
export function splitBytes(bytes: number, decimals = 1): { value: string; unit: string } {
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
	if (bytes < 1) return { value: '0', unit: 'B' };

	const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** exponent;

	return {
		value: value.toFixed(exponent === 0 ? 0 : decimals).replace(/\.0$/, ''),
		unit: units[exponent]
	};
}

export function formatBytes(bytes: number, decimals = 1): string {
	const { value, unit } = splitBytes(bytes, decimals);
	return `${value} ${unit}`;
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

/**
 * The tints the estate's categories are drawn in.
 *
 * Presentation, so it lives above the port. `CloudProvider` used to require a source to
 * supply a `DomainAccent`, which meant a real adapter had to hold an opinion about which
 * of Azure's storage tiers is violet — not a fact about Azure, and the single thing that
 * made the contract impossible to implement honestly.
 */
const ACCENTS: DomainAccent[] = ['blue', 'green', 'violet', 'amber', 'red', 'slate'];

/**
 * A stable tint for an identifier.
 *
 * Hashed rather than positional: assigning by index would recolour every category when a
 * new one appeared, which a reader sees as the estate having changed.
 */
export function accentFor(id: string): DomainAccent {
	// A local hash rather than the server's `hashSeed`: this module is browser-safe and
	// must not reach into `$lib/server`.
	let hash = 0;
	for (let index = 0; index < id.length; index++) {
		hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
	}

	return ACCENTS[hash % ACCENTS.length];
}

/**
 * A share of a total, rounded for display.
 *
 * Rounded here rather than left raw, because these numbers are printed as well as used for
 * bar widths — an unrounded share reaches the page as "41.12903225806452%". The bytes and
 * amounts they are derived from stay exact, which is the whole point of carrying both.
 *
 * `decimals` because the two callers disagree: storage reads as whole percents and spend
 * to one place, and that was true before the shares moved up here.
 */
function shareOf(part: number, total: number, decimals = 0): number {
	if (total === 0) return 0;

	const factor = 10 ** decimals;
	return Math.round((part / total) * 100 * factor) / factor;
}

/** Storage facts, plus how the screen draws them. */
export function toStorageView(storage: { totalBytes: number; classes: StorageClass[] }): {
	totalBytes: number;
	totalFormatted: string;
	classes: StorageClassView[];
} {
	return {
		totalBytes: storage.totalBytes,
		totalFormatted: formatBytes(storage.totalBytes),
		classes: storage.classes.map((one) => ({
			...one,
			formatted: formatBytes(one.bytes),
			accent: accentFor(one.id),
			percentage: shareOf(one.bytes, storage.totalBytes)
		}))
	};
}

/**
 * One resource reading, plus how the screen draws it.
 *
 * `unit` survives untouched and `displayUnit` is added beside it, because they differ: the
 * series carries bits per second while the headline reads gigabits.
 */
export function toUsageView(reading: ResourceReading): ResourceUsage {
	const headline = headlineOf(reading);

	return {
		...reading,
		formatted: headline.value,
		displayUnit: headline.unit,
		changeFormatted: formatChange(reading.change, '%', 0),
		comparedToLabel: 'vs 15m ago'
	};
}

/**
 * The number and the unit a tile prints, which are not the ones it stores.
 *
 * Four units reach this strip, because four different things are being measured and only
 * one of them is a percentage: a CPU share, free memory in bytes, disk throughput in bytes
 * per second, and network throughput in bits per second. Each keeps its own scale rather
 * than being rounded into a percentage of a ceiling nobody published — `5482128896 B`
 * rendered raw is exactly what the render sweep looks for.
 */
function headlineOf(reading: ResourceReading): { value: string; unit: string } {
	if (reading.unit === 'bps') return formatBitrate(reading.value);
	if (reading.unit === 'B') return splitBytes(reading.value);

	if (reading.unit === 'B/s') {
		const { value, unit } = splitBytes(reading.value);
		return { value, unit: `${unit}/s` };
	}

	return { value: String(Math.round(reading.value)), unit: reading.unit };
}

/** Spend facts, plus how the screen draws them. */
export function toCostView(cost: CostBreakdown): CostBreakdownView {
	return {
		...cost,
		totalFormatted: formatMoney(cost.total),
		forecastFormatted: formatMoney(cost.forecast),
		categories: cost.categories.map((one) => ({
			...one,
			formatted: formatMoney(one.amount),
			accent: accentFor(one.id),
			percentage: shareOf(one.amount, cost.total, 1)
		}))
	};
}
