import { buildSeries } from '../../../../platform/series';

/**
 * A stand-in for Azure Cost Management.
 *
 * floci-az emulates ARM, Monitor and Entra but not Cost Management, so this is the one
 * Azure surface the local stack has to supply itself. Without it `cloud.cost` cannot be
 * exercised at all and the infrastructure screen is testable in eight of its nine parts.
 *
 * It answers the real contract rather than a convenient one — a POST to the scope's query
 * endpoint returning `{ properties: { columns, rows } }`, with `UsageDate` as a `yyyyMMdd`
 * integer. A mock that invented its own shape would test the mock.
 */

/** The services spend is grouped by, and their daily run rate in dollars. */
const SERVICES: Array<[string, number]> = [
	['Virtual Machines', 12_430 / 30],
	['Storage', 6_850 / 30],
	['Azure Database for PostgreSQL', 4_120 / 30],
	['Bandwidth', 2_980 / 30],
	['Other', 2_160 / 30]
];

/** `20260906`, which is how Cost Management returns a day — not an ISO string. */
function usageDate(at: Date): number {
	return at.getUTCFullYear() * 10_000 + (at.getUTCMonth() + 1) * 100 + at.getUTCDate();
}

export interface CostEstate {
	/** `[cost, yyyyMMdd, serviceName, currency]`, the column order the API declares. */
	rows: Array<[number, number, string, string]>;
}

/**
 * Month-to-date spend, one row per service per day elapsed.
 *
 * Stops at `now` rather than filling the month: a full month of columns on the sixth is a
 * fiction, and the fixture estate already refuses to draw one.
 */
export function buildEstate(options: { now: Date; currency?: string }): CostEstate {
	const { now, currency = 'USD' } = options;
	const days = now.getUTCDate();
	const rows: CostEstate['rows'] = [];

	for (const [service, dailyRate] of SERVICES) {
		// Seeded, like every other fixture here — spend that moved on every refresh would
		// report change that did not happen, and could not be asserted on.
		const daily = buildSeries(`azure-cost:${service}`, dailyRate, {
			points: days,
			volatility: 0.12,
			floor: 1
		}).values;

		for (let index = 0; index < days; index++) {
			const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), index + 1));
			rows.push([daily[index], usageDate(at), service, currency]);
		}
	}

	return { rows };
}

const COLUMNS = [
	{ name: 'Cost', type: 'Number' },
	{ name: 'UsageDate', type: 'Number' },
	{ name: 'ServiceName', type: 'String' },
	{ name: 'Currency', type: 'String' }
];

/** The request handler, so a test can serve it without opening a port. */
export function costMockHandler(
	options: { estate?: CostEstate; apiKey?: string; now?: Date } = {}
) {
	const now = options.now ?? new Date();
	const estate = options.estate ?? buildEstate({ now });
	const apiKey = options.apiKey ?? 'local-dev-key';

	return (request: Request): Response => {
		const authorization = request.headers.get('authorization');

		// Checked rather than ignored: the adapter attaches a bearer token on every call,
		// and a mock that accepted anything would not notice if it stopped.
		if (authorization !== `Bearer ${apiKey}`) {
			return Response.json(
				{ error: { code: 'AuthenticationFailed', message: 'Bearer token missing or invalid.' } },
				{ status: 401 }
			);
		}

		const { pathname } = new URL(request.url);

		if (
			request.method !== 'POST' ||
			!pathname.endsWith('/providers/Microsoft.CostManagement/query')
		) {
			return Response.json(
				{ error: { code: 'NotFound', message: `No route for ${request.method} ${pathname}.` } },
				{ status: 404 }
			);
		}

		return Response.json({
			id: `${pathname}`,
			name: 'query',
			type: 'Microsoft.CostManagement/query',
			properties: { nextLink: null, columns: COLUMNS, rows: estate.rows }
		});
	};
}

/** `port: 0` asks the OS for a free port, so parallel test files never collide. */
export function startCostMock(
	options: { estate?: CostEstate; apiKey?: string; port?: number; now?: Date } = {}
) {
	const handle = costMockHandler(options);
	const server = Bun.serve({ port: options.port ?? 0, fetch: handle });

	return {
		url: `http://localhost:${server.port}`,
		port: server.port,
		stop: () => server.stop(true)
	};
}
