import type {
	ClusterLoad,
	CostBreakdown,
	DatabaseInstance,
	InfraAlert,
	InfraRegion,
	InfrastructureGroup,
	MessageQueue,
	NodeCounts,
	ResourceReading,
	StorageClass,
	TimeSeries
} from '$lib/platform/types';
import { statusFromScore } from '$lib/platform/health';
import { FIXTURE_STORAGE_BYTES, fixtureOwnerOf } from '$lib/platform/ownership';
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

/** Nodes the estate is paying for, healthy or not. */
const NODE_CAPACITY = 52;

/** Region rows: `[id, name, lat, lon, healthy, warning, down, score]`.
 *
 * The node split is stated per region and the estate is the sum, so the estate donut's
 * two down nodes are findable on a domain's Infrastructure tab — deriving a region's split
 * from its `score` put them nowhere. The score stays: it grades the region, not its nodes. */
const REGION_ROWS: Array<[string, string, number, number, number, number, number, number]> = [
	['eu-west-1', 'eu-west-1', 53.3, -6.3, 11, 1, 0, 96],
	['eu-central-1', 'eu-central-1', 50.1, 8.7, 9, 1, 0, 94],
	['us-east-1', 'us-east-1', 38.0, -78.5, 13, 0, 1, 92],
	['us-west-2', 'us-west-2', 45.5, -121.0, 7, 1, 0, 90],
	['ap-southeast-1', 'ap-southeast-1', 1.3, 103.8, 2, 1, 1, 62]
];

function sumNodeCounts(rows: typeof REGION_ROWS): NodeCounts {
	return rows.reduce(
		(acc, [, , , , healthy, warning, down]) => ({
			healthy: acc.healthy + healthy,
			warning: acc.warning + warning,
			down: acc.down + down
		}),
		{ healthy: 0, warning: 0, down: 0 }
	);
}

/** Derived, not seeded: 42 / 4 / 2 is what the rows add up to. */
const NODE_COUNTS: NodeCounts = sumNodeCounts(REGION_ROWS);

function regionNodeCount(row: (typeof REGION_ROWS)[number]): number {
	return row[4] + row[5] + row[6];
}

export function readNodeCounts(owner?: string): NodeCounts {
	if (owner === undefined) return NODE_COUNTS;
	return sumNodeCounts(REGION_ROWS.filter((row) => fixtureOwnerOf(row[0]) === owner));
}

function nodeTotal(counts: NodeCounts): number {
	return counts.healthy + counts.warning + counts.down;
}

export function totalNodes(): number {
	return nodeTotal(NODE_COUNTS);
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
export function listRegions(owner?: string): InfraRegion[] {
	const all = REGION_ROWS.map((row) => {
		const [id, name, latitude, longitude, , , , score] = row;
		return {
			id,
			name,
			status: statusFromScore(score),
			latitude,
			longitude,
			nodeCount: regionNodeCount(row)
		};
	});

	return owner === undefined ? all : all.filter((r) => fixtureOwnerOf(r.id) === owner);
}

export function listClusters(limit: number, owner?: string): ClusterLoad[] {
	const seeds: Array<[string, number]> = [
		['prod-eu-west-1-a', 72],
		['prod-eu-west-1-b', 58],
		['prod-us-east-1-a', 41],
		['prod-us-west-2-a', 34],
		['prod-ap-southeast-1-a', 28],
		['prod-eu-central-1-a', 22]
	];

	const all = seeds.map(([name, cpuPct]) => ({
		id: name,
		name,
		cpuPct,
		// Load is not health, but sustained load grades like it: past 70% a cluster has
		// nowhere left to absorb a spike, and past 50% it is worth watching.
		status:
			cpuPct >= 70 ? ('down' as const) : cpuPct >= 50 ? ('degraded' as const) : ('healthy' as const)
	}));

	return (owner === undefined ? all : all.filter((c) => fixtureOwnerOf(c.id) === owner)).slice(
		0,
		limit
	);
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
export function readUtilization(now: Date, owner?: string, buckets = 18): ResourceReading[] {
	// Utilisation is a reading off machines. An owner with no nodes has none to read, so
	// the answer is an empty list — the same answer the Azure provider gives for zero owned
	// VMs — rather than four series drawn for machines the same page counts as `0`.
	if (owner !== undefined && nodeTotal(readNodeCounts(owner)) === 0) return [];

	const seeds: Array<[string, string, number, number, number, number]> = [
		['cpu', 'CPU', 42, 0.1, -6, 100],
		['memory', 'Memory', 58, 0.05, -3, 100],
		['disk', 'Disk', 47, 0.03, -4, 100],
		['network', 'Network I/O', 1.2e9, 0.14, -8, 2e9]
	];

	return seeds.map(([id, label, centre, volatility, change, axisMax]) => {
		const seedKey = owner === undefined ? `infra:${id}` : `infra:${owner}:${id}`;
		const values = buildSeries(seedKey, centre, {
			points: buckets,
			volatility,
			floor: 0
		}).values;
		return {
			id,
			label,
			value: centre,
			// The unit the reading is in, not the one a headline prints: network is bits
			// per second, and the "1.2 Gbps" is derived above the port.
			unit: id === 'network' ? 'bps' : '%',
			series: toSeries(id, label, clockPoints(now, values)),
			axisMax,
			change,
			direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
			// Less of every one of these is better; none of them is a throughput goal.
			polarity: 'lower-is-better'
		};
	});
}

const TIB = 1024 ** 4;

/** Storage class seeds: `[id, label, bytes]`. Hoisted so an owner's storage read can pull
 * the same class ids from `FIXTURE_STORAGE_BYTES` rather than restating them. */
const STORAGE_SEEDS: Array<[string, string, number]> = [
	['block', 'Block Storage', 5.1 * TIB],
	['object', 'Object Storage', 4.8 * TIB],
	['file', 'File Storage', 2.5 * TIB]
];

export function readStorage(owner?: string): { totalBytes: number; classes: StorageClass[] } {
	if (owner === undefined) {
		const totalBytes = STORAGE_SEEDS.reduce((sum, [, , bytes]) => sum + bytes, 0);

		// Bytes, not a formatted string and a rounded share. The share is recomputed above the
		// port, and the API publishes these exactly rather than multiplying a percentage out.
		return {
			totalBytes,
			classes: STORAGE_SEEDS.map(([id, label, bytes]) => ({ id, label, bytes }))
		};
	}

	const mine = FIXTURE_STORAGE_BYTES[owner] ?? { block: 0, object: 0, file: 0 };
	const classes = STORAGE_SEEDS.map(([id, label]) => ({
		id,
		label,
		bytes: mine[id as 'block' | 'object' | 'file']
	}));
	return { totalBytes: classes.reduce((sum, c) => sum + c.bytes, 0), classes };
}

export function listDatabases(limit: number, owner?: string): DatabaseInstance[] {
	const seeds: Array<[string, string, number, number, number, number]> = [
		['payment-db', 'PostgreSQL', 32, 120, 300, 512 * 1024 ** 3],
		['order-db', 'PostgreSQL', 28, 98, 300, 256 * 1024 ** 3],
		['user-db', 'PostgreSQL', 18, 76, 200, 128 * 1024 ** 3],
		['analytics-db', 'ClickHouse', 41, 64, 150, 1.2 * TIB],
		['inventory-db', 'PostgreSQL', 24, 52, 200, 96 * 1024 ** 3]
	];

	return (owner === undefined ? seeds : seeds.filter(([name]) => fixtureOwnerOf(name) === owner))
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
			storageBytes: bytes
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
export function readCost(now: Date, owner?: string): CostBreakdown {
	// Daily rates chosen to reach a realistic monthly spend over a thirty-day month.
	const seeds: Array<[string, string, number]> = [
		['compute', 'Compute', 12_430 / 30],
		['storage', 'Storage', 6_850 / 30],
		['databases', 'Databases', 4_120 / 30],
		['network', 'Network', 2_980 / 30],
		['other', 'Other', 2_160 / 30]
	];

	const days = now.getDate();
	const labels = Array.from({ length: days }, (_, index) => {
		const at = new Date(now.getFullYear(), now.getMonth(), index + 1);
		return at.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
	});

	// An owner's slice of spend follows its slice of nodes — derived, so the owners'
	// spend sums back to the estate's exactly.
	const share = owner === undefined ? 1 : nodeTotal(readNodeCounts(owner)) / totalNodes();

	const categories = seeds.map(([id, label, dailyRate]) => {
		const daily = buildSeries(`cost:${id}`, dailyRate, {
			points: days,
			volatility: 0.12,
			floor: 1
		}).values.map((value) => value * share);
		// The month-to-date figure is the sum of the days drawn, so the legend, the
		// headline and the columns cannot describe different months.
		const amount = daily.reduce((sum, value) => sum + value, 0);

		return { id, label, amount, daily, dailyRate };
	});

	const total = categories.reduce((sum, category) => sum + category.amount, 0);
	const runRate = total / days;

	// Straight-line from the run rate so far. Stated as a forecast, not a promise.
	const forecast = runRate * daysInMonth(now);

	return {
		labels,
		// Amounts, not shares and strings. `toCostView` derives both, so the API publishes
		// the figures exactly rather than recovering them from a rounded percentage.
		categories: categories.map(({ dailyRate: _rate, ...category }) => category),
		total,
		changePct: 6.2,
		forecast,
		forecastChangePct: -5.8
	};
}

function daysInMonth(now: Date): number {
	return new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
}
