import { statusFromScore } from '$lib/platform/health';
import type {
	CostBreakdown,
	InfraRegion,
	NodeCounts,
	ResourceReading,
	TrendPolarity
} from '$lib/platform/types';
import type { MetricSeries } from './client';

/**
 * ARM shapes to domain facts.
 *
 * Pure, so the awkward parts are testable without a subscription: a VM's power state lives
 * in an array of slash-delimited status codes, and a region has to be inferred from where
 * resources are rather than asked for.
 */

/** What ARM returns for anything with a location. */
export interface ArmResource {
	id: string;
	name: string;
	location: string;
	properties?: Record<string, unknown>;
}

export interface ArmVirtualMachine extends ArmResource {
	properties?: {
		instanceView?: { statuses?: Array<{ code?: string; level?: string }> };
		provisioningState?: string;
	};
}

/**
 * Where each Azure region is.
 *
 * ARM's `/locations` endpoint is not served by floci-az, and a region's coordinates are not
 * in a resource anyway — so this is a table. A location that is not in it is **skipped**
 * rather than placed at 0,0: `world.ts` asserts the open ocean is not land, and a region
 * drawn in the Gulf of Guinea is a visible lie about where an estate runs.
 */
const REGION_COORDS: Record<string, [number, number, string]> = {
	eastus: [37.3719, -79.8164, 'East US'],
	eastus2: [36.6681, -78.3889, 'East US 2'],
	westus: [37.783, -122.417, 'West US'],
	westus2: [47.233, -119.852, 'West US 2'],
	westus3: [33.448, -112.074, 'West US 3'],
	centralus: [41.5908, -93.6208, 'Central US'],
	northeurope: [53.3478, -6.2597, 'North Europe'],
	westeurope: [52.3667, 4.9, 'West Europe'],
	uksouth: [50.941, -0.799, 'UK South'],
	ukwest: [53.427, -3.084, 'UK West'],
	francecentral: [46.3772, 2.373, 'France Central'],
	germanywestcentral: [50.11, 8.682, 'Germany West Central'],
	switzerlandnorth: [47.451, 8.564, 'Switzerland North'],
	swedencentral: [60.67, 17.14, 'Sweden Central'],
	southeastasia: [1.283, 103.833, 'Southeast Asia'],
	eastasia: [22.267, 114.188, 'East Asia'],
	japaneast: [35.68, 139.77, 'Japan East'],
	australiaeast: [-33.86, 151.209, 'Australia East'],
	centralindia: [18.5822, 73.9197, 'Central India'],
	brazilsouth: [-23.55, -46.633, 'Brazil South'],
	canadacentral: [43.653, -79.383, 'Canada Central'],
	southafricanorth: [-25.731, 28.218, 'South Africa North'],
	uaenorth: [25.266, 55.297, 'UAE North']
};

export function knownRegion(location: string): boolean {
	return location in REGION_COORDS;
}

/**
 * A virtual machine's power state.
 *
 * Azure reports it as a slash-delimited code inside an array that also carries the
 * provisioning state — `PowerState/running` beside `ProvisioningState/succeeded` — so the
 * prefix is what identifies it, not the position.
 */
export function powerStateOf(machine: ArmVirtualMachine): string {
	const statuses = machine.properties?.instanceView?.statuses ?? [];
	const power = statuses.find((one) => one.code?.startsWith('PowerState/'));

	// No instance view at all is not "stopped": it is a machine ARM did not tell us about,
	// and counting it as down would report an outage that may not exist.
	return power?.code?.slice('PowerState/'.length) ?? 'unknown';
}

/** Running, something-else, or off. */
export function countNodes(machines: ArmVirtualMachine[]): NodeCounts {
	const counts: NodeCounts = { healthy: 0, warning: 0, down: 0 };

	for (const machine of machines) {
		const state = powerStateOf(machine);

		if (state === 'running') counts.healthy++;
		else if (state === 'deallocated' || state === 'stopped') counts.down++;
		else counts.warning++;
	}

	return counts;
}

/**
 * The regions an estate actually occupies.
 *
 * Built from where the resources are rather than from a list of where they could be, which
 * is what ARM's absent `/locations` forces and is the better answer anyway: a map of every
 * Azure region with one node in it says less than a map of the five you run in.
 */
export function regionsOf(machines: ArmVirtualMachine[]): InfraRegion[] {
	const byLocation = new Map<string, ArmVirtualMachine[]>();

	for (const machine of machines) {
		if (!knownRegion(machine.location)) continue;
		byLocation.set(machine.location, [...(byLocation.get(machine.location) ?? []), machine]);
	}

	return [...byLocation.entries()]
		.map(([location, rows]) => {
			const [latitude, longitude, name] = REGION_COORDS[location];
			const counts = countNodes(rows);
			const total = counts.healthy + counts.warning + counts.down;

			return {
				id: location,
				name,
				// Scored on the share running, so one node rebuilding in fifty does not paint
				// a region red — the estate rollup rule, applied per region.
				status: statusFromScore(total === 0 ? 0 : Math.round((counts.healthy / total) * 100)),
				latitude,
				longitude,
				nodeCount: total
			};
		})
		.sort((a, b) => b.nodeCount - a.nodeCount);
}

/** One row of a Cost Management query: `[cost, yyyyMMdd, service, currency]`. */
export type CostRow = [number, number, string, string];

/** `20260915` back to a date, which is how Cost Management returns a day. */
function fromUsageDate(value: number): Date {
	const year = Math.floor(value / 10_000);
	const month = Math.floor((value % 10_000) / 100);
	return new Date(Date.UTC(year, month - 1, value % 100));
}

/**
 * Month-to-date spend, grouped by service.
 *
 * The forecast is a straight line from the run rate so far, and is stated as a forecast
 * rather than a promise. `changePct` is not derivable from a month-to-date query — it needs
 * the previous month — so it is reported as zero rather than invented, and the screen shows
 * no movement rather than a movement nobody measured.
 */
export function costFrom(rows: CostRow[], now: Date): CostBreakdown {
	const days = [...new Set(rows.map(([, date]) => date))].sort((a, b) => a - b);
	const labels = days.map((day) =>
		fromUsageDate(day).toLocaleDateString('en-GB', {
			month: 'short',
			day: 'numeric',
			timeZone: 'UTC'
		})
	);

	const byService = new Map<string, number[]>();
	for (const [cost, date, service] of rows) {
		const daily = byService.get(service) ?? Array(days.length).fill(0);
		daily[days.indexOf(date)] += cost;
		byService.set(service, daily);
	}

	const categories = [...byService.entries()]
		.map(([service, daily]) => ({
			id: service.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
			label: service,
			amount: daily.reduce((sum, one) => sum + one, 0),
			daily
		}))
		.sort((a, b) => b.amount - a.amount);

	const total = categories.reduce((sum, one) => sum + one.amount, 0);
	const elapsed = Math.max(days.length, 1);
	const inMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();

	return {
		labels,
		categories,
		total,
		changePct: 0,
		forecast: (total / elapsed) * inMonth,
		forecastChangePct: 0
	};
}

/** ARM's shape for an AKS cluster, as far as a cluster row needs it. */
export interface ArmCluster extends ArmResource {
	properties?: {
		provisioningState?: string;
		agentPoolProfiles?: Array<{ count?: number; provisioningState?: string }>;
	};
}

/**
 * Whether a cluster is serving.
 *
 * Judged on its agent pools rather than its own `provisioningState`, because the cluster
 * resource reports the state of the *control plane* — floci-az leaves it at "Creating"
 * while it provisions containers, and a real cluster mid-upgrade says the same. The pools
 * are what run workloads, so they are what the row is about.
 */
export function clusterIsReady(cluster: ArmCluster): boolean {
	const pools = cluster.properties?.agentPoolProfiles ?? [];
	if (pools.length === 0) return cluster.properties?.provisioningState === 'Succeeded';

	return pools.every((one) => one.provisioningState === 'Succeeded');
}

/** How many nodes a cluster's pools add up to. */
export function clusterNodeCount(cluster: ArmCluster): number {
	return (cluster.properties?.agentPoolProfiles ?? []).reduce(
		(sum, one) => sum + (one.count ?? 0),
		0
	);
}

/** The latest point of a series, or zero when a metric reported nothing. */
export function latest(points: Array<{ value: number }>): number {
	return points.at(-1)?.value ?? 0;
}

/** What one Monitor metric becomes on the utilisation strip. */
interface UsageSeed {
	id: string;
	label: string;
	metric: string;
	unit: string;
	polarity: TrendPolarity;
	/** Monitor's number to the unit the reading claims. */
	scale: (raw: number, stepSeconds: number) => number;
}

/**
 * The four readings, and what Azure actually measures for each.
 *
 * Only CPU arrives as the thing the panel wants. The other three are counters over the
 * sampling interval or a byte figure, so each carries its own conversion and its own unit
 * rather than being rounded into a percentage nobody measured:
 *
 * - **Memory** is *available* bytes. Azure does not publish a used percentage, because
 *   that needs the VM size's total RAM, which is not a metric. So the reading says what
 *   was measured — bytes free — and its polarity is the other way up.
 * - **Disk** and **network** are `Total` counters over the interval, so both divide by it.
 *   Network goes on to bits, which is the unit network gear is specified in; disk stays
 *   in bytes, which is the unit storage is.
 */
const USAGE_SEEDS: UsageSeed[] = [
	{
		id: 'cpu',
		label: 'CPU',
		metric: 'Percentage CPU',
		unit: '%',
		polarity: 'lower-is-better',
		scale: (raw) => raw
	},
	{
		id: 'memory',
		label: 'Memory available',
		metric: 'Available Memory Bytes',
		unit: 'B',
		polarity: 'higher-is-better',
		scale: (raw) => raw
	},
	{
		id: 'disk',
		label: 'Disk read',
		metric: 'Disk Read Bytes',
		unit: 'B/s',
		polarity: 'lower-is-better',
		scale: (raw, step) => raw / step
	},
	{
		id: 'network',
		label: 'Network in',
		metric: 'Network In Total',
		unit: 'bps',
		polarity: 'lower-is-better',
		scale: (raw, step) => (raw * 8) / step
	}
];

/** `14:05`, which is how the strip labels a bucket. */
function clockLabel(at: Date): string {
	return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * The estate's utilisation, averaged across the machines that were sampled.
 *
 * Averaged rather than summed, because the panel reads as "what a machine in this estate
 * is doing" — a sum would make the CPU line rise every time someone provisioned a VM.
 * Bucket *n* averages bucket *n* of every machine, so a machine whose series is short
 * contributes to the buckets it has and to no others; a machine that reported nothing at
 * all does not drag the average toward zero.
 */
export function utilizationFrom(
	perMachine: MetricSeries[][],
	window: { from: Date; to: Date; stepSeconds: number }
): ResourceReading[] {
	return USAGE_SEEDS.map((seed) => {
		const totals: number[] = [];
		const counts: number[] = [];
		const stamps: Date[] = [];

		for (const machine of perMachine) {
			const series = machine.find((one) => one.name === seed.metric);

			for (const [index, point] of (series?.points ?? []).entries()) {
				totals[index] = (totals[index] ?? 0) + seed.scale(point.value, window.stepSeconds);
				counts[index] = (counts[index] ?? 0) + 1;
				stamps[index] ??= point.at;
			}
		}

		const values = totals.map((total, index) => Math.round((total / counts[index]) * 100) / 100);
		const points = values.map((value, index) => ({
			label: clockLabel(stamps[index] ?? window.to),
			value
		}));

		const first = values[0] ?? 0;
		const value = values.at(-1) ?? 0;
		// Against the start of the window rather than a second query: the strip's caption
		// says "vs 15m ago", and a fifteen-minute window is exactly what was fetched.
		const change = first === 0 ? 0 : Math.round(((value - first) / first) * 1000) / 10;

		return {
			id: seed.id,
			label: seed.label,
			value,
			unit: seed.unit,
			series: {
				id: seed.id,
				label: seed.label,
				points,
				min: values.length ? Math.min(...values) : 0,
				max: values.length ? Math.max(...values) : 0
			},
			// A percentage is read against a fixed 0–100 so 42% and 95% cannot look alike.
			// The other three have no ceiling Azure knows of, so they are read against
			// their own peak with headroom — stated here rather than invented as a limit.
			axisMax: seed.unit === '%' ? 100 : Math.max(...values, 0) * 1.25 || 1,
			change,
			direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
			polarity: seed.polarity
		};
	});
}
