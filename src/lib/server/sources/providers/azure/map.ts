import { statusFromScore } from '$lib/platform/health';
import type { CostBreakdown, InfraRegion, NodeCounts } from '$lib/platform/types';

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
