import type {
	ClusterLoad,
	CostBreakdown,
	CostCategory,
	DatabaseInstance,
	InfraAlert,
	InfraRegion,
	InfrastructureGroup,
	MessageQueue,
	NodeCounts,
	ResourceUsage,
	StorageClass,
	TimeSeries
} from '$lib/platform/types';
import { formatBitrate, formatBytes, formatMoney } from '$lib/platform/infrastructure';
import { formatChange } from '$lib/platform/format';
import { statusFromScore } from '$lib/platform/health';
import { buildSeries } from './series';

/**
 * The stand-in estate.
 *
 * Its own file, like the service catalog: a different upstream from the platform
 * inventory, and the thing that gets deleted when a real cluster API lands.
 *
 * Everything is seeded so the charts are stable across refreshes, and the numbers are
 * derived from one another wherever two panels show the same quantity — the node donut
 * and the node tile cannot disagree, because only one of them counts.
 */

const NODE_COUNTS: NodeCounts = { healthy: 42, warning: 4, down: 2 };

/** Nodes the estate is paying for, healthy or not. */
const NODE_CAPACITY = 52;

export function readNodeCounts(): NodeCounts {
	return NODE_COUNTS;
}

export function totalNodes(): number {
	return NODE_COUNTS.healthy + NODE_COUNTS.warning + NODE_COUNTS.down;
}

export function nodeCapacity(): number {
	return NODE_CAPACITY;
}

/**
 * Where the estate runs.
 *
 * Coordinates are the region's namesake city, so a marker lands where a reader expects
 * it. They travel as facts; the projection that turns them into pixels is the UI's.
 */
export function listRegions(): InfraRegion[] {
	const seeds: Array<[string, string, number, number, number, number]> = [
		['eu-west-1', 'eu-west-1', 53.3, -6.3, 12, 96],
		['eu-central-1', 'eu-central-1', 50.1, 8.7, 10, 94],
		['us-east-1', 'us-east-1', 38.0, -78.5, 14, 92],
		['us-west-2', 'us-west-2', 45.5, -121.0, 8, 90],
		['ap-southeast-1', 'ap-southeast-1', 1.3, 103.8, 4, 62]
	];

	return seeds.map(([id, name, latitude, longitude, nodeCount, score]) => ({
		id,
		name,
		status: statusFromScore(score),
		latitude,
		longitude,
		nodeCount
	}));
}

export function listClusters(limit: number): ClusterLoad[] {
	const seeds: Array<[string, number]> = [
		['prod-eu-west-1-a', 72],
		['prod-eu-west-1-b', 58],
		['prod-us-east-1-a', 41],
		['prod-us-west-2-a', 34],
		['prod-ap-southeast-1-a', 28],
		['prod-eu-central-1-a', 22]
	];

	return seeds.slice(0, limit).map(([name, cpuPct]) => ({
		id: name,
		name,
		cpuPct,
		// Load is not health, but sustained load grades like it: past 70% a cluster has
		// nowhere left to absorb a spike, and past 50% it is worth watching.
		status: cpuPct >= 70 ? 'down' : cpuPct >= 50 ? 'degraded' : 'healthy'
	}));
}

export function listGroups(): InfrastructureGroup[] {
	const nodes = totalNodes();

	return [
		{
			id: 'clusters',
			label: 'Clusters',
			icon: 'boxes',
			count: 6,
			status: 'healthy',
			statusLabel: 'Healthy'
		},
		{
			id: 'nodes',
			label: 'Nodes',
			icon: 'server',
			count: nodes,
			status: NODE_COUNTS.down > 0 ? 'degraded' : 'healthy',
			statusLabel: NODE_COUNTS.down > 0 ? 'Degraded' : 'Healthy'
		},
		{
			id: 'databases',
			label: 'Databases',
			icon: 'database',
			count: listDatabases(20).length,
			status: 'healthy',
			statusLabel: 'Healthy'
		},
		{
			id: 'queues',
			label: 'Queues',
			icon: 'layers',
			count: listQueues(20).length,
			status: listQueues(20).some((queue) => queue.status !== 'healthy') ? 'degraded' : 'healthy',
			statusLabel: 'Operational'
		}
	];
}

/** Buckets across the window, labelled with wall-clock times. */
function clockPoints(now: Date, values: number[], stepMinutes = 5) {
	return values.map((value, index) => {
		const at = new Date(now.getTime() - (values.length - 1 - index) * stepMinutes * 60_000);
		return {
			label: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
			value: Math.round(value * 100) / 100
		};
	});
}

function toSeries(id: string, label: string, points: ReturnType<typeof clockPoints>): TimeSeries {
	const values = points.map((point) => point.value);
	return { id, label, points, min: Math.min(...values), max: Math.max(...values) };
}

/**
 * The four utilisation panels.
 *
 * `axisMax` travels with each one because the three percentage panels are read against
 * a fixed 0–100 and the network panel against its own ceiling. A chart that scaled CPU
 * to its own peak would make 42% and 95% look identical.
 */
export function readUtilization(now: Date, buckets = 18): ResourceUsage[] {
	const seeds: Array<[string, string, number, number, number, number]> = [
		['cpu', 'CPU', 42, 0.1, -6, 100],
		['memory', 'Memory', 58, 0.05, -3, 100],
		['disk', 'Disk', 47, 0.03, -4, 100],
		['network', 'Network I/O', 1.2e9, 0.14, -8, 2e9]
	];

	return seeds.map(([id, label, centre, volatility, change, axisMax]) => {
		const values = buildSeries(`infra:${id}`, centre, { volatility, floor: 0 }).values.slice(
			0,
			buckets
		);
		const bitrate = id === 'network' ? formatBitrate(centre) : null;

		return {
			id,
			label,
			formatted: bitrate ? bitrate.value : String(Math.round(centre)),
			unit: bitrate ? bitrate.unit : '%',
			series: toSeries(id, label, clockPoints(now, values)),
			axisMax,
			changeFormatted: formatChange(change, '%', 0),
			comparedToLabel: 'vs 15m ago',
			direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
			// Less of every one of these is better; none of them is a throughput goal.
			polarity: 'lower-is-better'
		};
	});
}

const TIB = 1024 ** 4;

export function readStorage(): { totalBytes: number; classes: StorageClass[] } {
	const seeds: Array<[string, string, number, StorageClass['accent']]> = [
		['block', 'Block Storage', 5.1 * TIB, 'blue'],
		['object', 'Object Storage', 4.8 * TIB, 'green'],
		['file', 'File Storage', 2.5 * TIB, 'violet']
	];

	const totalBytes = seeds.reduce((sum, [, , bytes]) => sum + bytes, 0);

	return {
		totalBytes,
		classes: seeds.map(([id, label, bytes, accent]) => ({
			id,
			label,
			formatted: formatBytes(bytes),
			accent,
			percentage: Math.round((bytes / totalBytes) * 100)
		}))
	};
}

export function listDatabases(limit: number): DatabaseInstance[] {
	const seeds: Array<[string, string, number, number, number, number]> = [
		['payment-db', 'PostgreSQL', 32, 120, 300, 512 * 1024 ** 3],
		['order-db', 'PostgreSQL', 28, 98, 300, 256 * 1024 ** 3],
		['user-db', 'PostgreSQL', 18, 76, 200, 128 * 1024 ** 3],
		['analytics-db', 'ClickHouse', 41, 64, 150, 1.2 * TIB],
		['inventory-db', 'PostgreSQL', 24, 52, 200, 96 * 1024 ** 3]
	];

	return seeds
		.slice(0, limit)
		.map(([name, engine, cpuPct, connections, connectionLimit, bytes]) => ({
			id: name,
			name,
			engine,
			// Saturation of the connection pool is what takes a database down, so it is what
			// decides the badge — not CPU, which recovers on its own.
			status: connections / connectionLimit >= 0.9 ? 'degraded' : 'healthy',
			cpuPct,
			connections,
			connectionLimit,
			storageFormatted: formatBytes(bytes)
		}));
}

export function listQueues(limit: number): MessageQueue[] {
	const seeds: Array<[string, string, number, number]> = [
		['payment-queue', 'SQS', 12_420, 0],
		['order-events', 'Kafka', 5_231, 120],
		['notification-queue', 'SQS', 2_105, 2_340],
		['email-queue', 'SQS', 1_230, 0],
		['audit-events', 'Kafka', 860, 12]
	];

	const LAG_THRESHOLD = 1_000;

	return seeds.slice(0, limit).map(([name, kind, messages, lag]) => ({
		id: name,
		name,
		kind,
		messages,
		// Lag is the only reading here that means anything on its own: a deep queue that
		// is keeping up is fine, and a shallow one that is not is an incident.
		status: lag >= LAG_THRESHOLD ? 'degraded' : 'healthy',
		lag
	}));
}

function minutesAgo(now: Date, minutes: number): string {
	return new Date(now.getTime() - minutes * 60_000).toISOString();
}

export function listAlerts(now: Date, limit: number): InfraAlert[] {
	const seeds: Array<[string, InfraAlert['severity'], string, string, number]> = [
		[
			'infra-2201',
			'critical',
			'High CPU usage on cluster prod-eu-west-1-a',
			'Cluster: prod-eu-west-1-a',
			2
		],
		[
			'infra-2200',
			'warning',
			'High memory usage on node ip-10-0-2-15',
			'Cluster: prod-us-east-1-a',
			7
		],
		['infra-2199', 'info', 'Backup completed for payment-db', 'Database: payment-db', 15],
		[
			'infra-2198',
			'warning',
			'Consumer lag rising on notification-queue',
			'Queue: notification-queue',
			24
		]
	];

	return seeds.slice(0, limit).map(([id, severity, title, subject, minutes]) => ({
		id,
		severity,
		title,
		subject,
		raisedAt: minutesAgo(now, minutes)
	}));
}

/**
 * Month-to-date spend.
 *
 * The **daily rate** is the seed, not the month's total. Seeding a monthly figure and
 * dividing it by the days elapsed is what produced a $214,000 end-of-month forecast on
 * the fourth: the total described a full month and the divisor described four days.
 * With a rate, month-to-date and the forecast are both derived from it and agree at
 * every point in the month.
 *
 * The chart therefore has as many columns as the month has had days. That is what
 * month-to-date means; a full month of columns on the fourth would be a fiction.
 */
export function readCost(now: Date): CostBreakdown {
	// Daily rates chosen to reach a realistic monthly spend over a thirty-day month.
	const seeds: Array<[string, string, number, CostCategory['accent']]> = [
		['compute', 'Compute', 12_430 / 30, 'blue'],
		['storage', 'Storage', 6_850 / 30, 'green'],
		['databases', 'Databases', 4_120 / 30, 'violet'],
		['network', 'Network', 2_980 / 30, 'amber'],
		['other', 'Other', 2_160 / 30, 'slate']
	];

	const days = now.getDate();
	const labels = Array.from({ length: days }, (_, index) => {
		const at = new Date(now.getFullYear(), now.getMonth(), index + 1);
		return at.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
	});

	const categories = seeds.map(([id, label, dailyRate, accent]) => {
		const daily = buildSeries(`cost:${id}`, dailyRate, { volatility: 0.12, floor: 1 }).values.slice(
			0,
			days
		);
		// The month-to-date figure is the sum of the days drawn, so the legend, the
		// headline and the columns cannot describe different months.
		const amount = daily.reduce((sum, value) => sum + value, 0);

		return { id, label, amount, formatted: formatMoney(amount), accent, daily, dailyRate };
	});

	const total = categories.reduce((sum, category) => sum + category.amount, 0);
	const runRate = total / days;

	return {
		labels,
		categories: categories.map(({ dailyRate: _rate, ...category }) => ({
			...category,
			percentage: Math.round((category.amount / total) * 1000) / 10
		})),
		totalFormatted: formatMoney(total),
		changePct: 6.2,
		// Straight-line from the run rate so far. Stated as a forecast, not a promise.
		forecastFormatted: formatMoney(runRate * daysInMonth(now)),
		forecastChangePct: -5.8
	};
}

function daysInMonth(now: Date): number {
	return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}
