import { buildSeries } from '../../../../platform/series';

/**
 * A stand-in for Azure Monitor.
 *
 * floci-az emulates ARM but not Monitor — a metrics request returns "Unsupported
 * Microsoft.Compute path" — and almost everything the infrastructure screen asks for is a
 * Monitor reading. Without this the Azure provider can answer three of nine capabilities;
 * with it, seven.
 *
 * It answers the real contract rather than a convenient one: the resource id is the path,
 * `metricnames` is comma-separated, `timespan` is `from/to`, and a series arrives as
 * `value[].timeseries[0].data[]` with the aggregation's own field name. A mock that
 * invented its own shape would test the mock.
 */

/** The aggregation a caller asked for decides which field carries the number. */
type Aggregation = 'Average' | 'Total' | 'Maximum' | 'Minimum';

/**
 * Where each metric sits, so a reading is plausible for the thing it describes.
 *
 * Keyed by metric name, because Monitor's names are global rather than per-resource-type:
 * `Percentage CPU` means the same thing on a virtual machine and on a database.
 */
const METRIC_CENTRES: Record<string, { centre: number; volatility: number; floor: number }> = {
	'Percentage CPU': { centre: 42, volatility: 0.18, floor: 0 },
	'Available Memory Bytes': { centre: 6.2e9, volatility: 0.1, floor: 0 },
	'Disk Read Bytes': { centre: 4.1e7, volatility: 0.3, floor: 0 },
	'Disk Write Bytes': { centre: 2.8e7, volatility: 0.3, floor: 0 },
	'Network In Total': { centre: 1.2e9, volatility: 0.22, floor: 0 },
	'Network Out Total': { centre: 8.4e8, volatility: 0.22, floor: 0 },
	// Storage reports bytes used; the spread is small because storage does not swing.
	UsedCapacity: { centre: 5.1e12, volatility: 0.02, floor: 0 },
	// Postgres flexible servers.
	active_connections: { centre: 120, volatility: 0.25, floor: 0 },
	memory_percent: { centre: 58, volatility: 0.12, floor: 0 },
	storage_used: { centre: 5.5e11, volatility: 0.03, floor: 0 },
	// AKS.
	node_cpu_usage_percentage: { centre: 57, volatility: 0.2, floor: 0 },
	node_memory_working_set_percentage: { centre: 64, volatility: 0.15, floor: 0 }
};

const FALLBACK = { centre: 50, volatility: 0.2, floor: 0 };

/** `PT5M` and friends back to seconds, so the mock honours the interval it was given. */
function intervalSeconds(value: string | null): number {
	if (!value) return 300;

	const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
	if (!match) return 300;

	const [, days, hours, minutes, seconds] = match.map((one) => (one ? Number(one) : 0));
	return days * 86_400 + hours * 3_600 + minutes * 60 + seconds || 300;
}

const FIELD: Record<Aggregation, string> = {
	Average: 'average',
	Total: 'total',
	Maximum: 'maximum',
	Minimum: 'minimum'
};

export function monitorMockHandler(options: { apiKey?: string } = {}) {
	const apiKey = options.apiKey ?? 'local-dev-key';

	return (request: Request): Response => {
		if (request.headers.get('authorization') !== `Bearer ${apiKey}`) {
			return Response.json(
				{ error: { code: 'AuthenticationFailed', message: 'Bearer token missing or invalid.' } },
				{ status: 401 }
			);
		}

		const url = new URL(request.url);

		if (!url.pathname.endsWith('/providers/Microsoft.Insights/metrics')) {
			return Response.json(
				{ error: { code: 'ResourceNotFound', message: `No route for ${url.pathname}.` } },
				{ status: 404 }
			);
		}

		const resourceId = url.pathname.slice(0, -'/providers/Microsoft.Insights/metrics'.length);
		const names = (url.searchParams.get('metricnames') ?? '').split(',').filter(Boolean);
		const aggregation = (url.searchParams.get('aggregation') ?? 'Average') as Aggregation;
		const field = FIELD[aggregation] ?? 'average';

		const [fromText, toText] = (url.searchParams.get('timespan') ?? '').split('/');
		const to = toText ? new Date(toText) : new Date();
		const from = fromText ? new Date(fromText) : new Date(to.getTime() - 3_600_000);

		const step = intervalSeconds(url.searchParams.get('interval')) * 1000;
		const points = Math.max(1, Math.min(Math.round((to.getTime() - from.getTime()) / step), 2_000));

		return Response.json({
			timespan: `${from.toISOString()}/${to.toISOString()}`,
			interval: url.searchParams.get('interval') ?? 'PT5M',
			value: names.map((name) => {
				const shape = METRIC_CENTRES[name] ?? FALLBACK;

				// Seeded on the resource *and* the metric, so one machine's CPU is its own
				// and stays the same across restarts — a dashboard whose numbers move on
				// every refresh reports change that did not happen.
				const values = buildSeries(`azure-monitor:${resourceId}:${name}`, shape.centre, {
					points,
					volatility: shape.volatility,
					floor: shape.floor
				}).values;

				return {
					id: `${resourceId}/providers/Microsoft.Insights/metrics/${name}`,
					type: 'Microsoft.Insights/metrics',
					name: { value: name, localizedValue: name },
					unit: 'Count',
					timeseries: [
						{
							metadatavalues: [],
							data: values.map((value, index) => ({
								timeStamp: new Date(from.getTime() + index * step).toISOString(),
								[field]: value
							}))
						}
					]
				};
			})
		});
	};
}

/** `port: 0` asks the OS for a free port, so parallel test files never collide. */
export function startMonitorMock(options: { apiKey?: string; port?: number } = {}) {
	const handle = monitorMockHandler(options);
	const server = Bun.serve({ port: options.port ?? 0, fetch: handle });

	return {
		url: `http://localhost:${server.port}`,
		port: server.port,
		stop: () => server.stop(true)
	};
}
