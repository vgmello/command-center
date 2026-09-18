import { OWNER_TAG_KEY, boundDomains, sameTagName } from '$lib/platform/ownership';
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
 *
 * It also answers the real request shape: `dataset.filter.tags` narrows to one domain. The
 * estate total is the sum over domains plus untagged — one fixture derived from the other.
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

/** The untagged remainder: spend Cost Management cannot attribute to a domain. */
const UNTAGGED = '';

export interface CostEstate {
	/**
	 * `[cost, yyyyMMdd, serviceName, currency, domain]`, the first four in the column order
	 * the API declares. The domain is internal — nothing outside this module reads it — and
	 * exists so a tag filter can narrow the estate before it is re-aggregated back down to
	 * the real (day, service) shape.
	 */
	rows: Array<[number, number, string, string, string]>;
}

/**
 * Month-to-date spend, one row per service per day elapsed, split across the bound domains
 * plus an untagged remainder.
 *
 * Stops at `now` rather than filling the month: a full month of columns on the sixth is a
 * fiction, and the fixture estate already refuses to draw one.
 */
export function buildEstate(options: { now: Date; currency?: string }): CostEstate {
	const { now, currency = 'USD' } = options;
	const days = now.getUTCDate();
	const rows: CostEstate['rows'] = [];
	const domains = [...boundDomains('seed'), UNTAGGED];

	for (const [service, dailyRate] of SERVICES) {
		// Seeded, like every other fixture here — spend that moved on every refresh would
		// report change that did not happen, and could not be asserted on.
		const daily = buildSeries(`azure-cost:${service}`, dailyRate, {
			points: days,
			volatility: 0.12,
			floor: 1
		}).values;

		// One seeded share per domain (plus the untagged bucket), normalised per day so the
		// domains' costs sum back to `daily[index]` exactly — the tagged view and the estate
		// view can never disagree about a day's total.
		const shares = domains.map(
			(domain) =>
				buildSeries(`azure-cost:${service}:${domain || 'untagged'}`, 1, {
					points: days,
					volatility: 0.35,
					floor: 0.05
				}).values
		);

		for (let index = 0; index < days; index++) {
			const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), index + 1));
			const day = usageDate(at);
			const shareTotal = shares.reduce((sum, values) => sum + values[index], 0);

			domains.forEach((domain, domainIndex) => {
				const cost = daily[index] * (shares[domainIndex][index] / shareTotal);
				rows.push([cost, day, service, currency, domain]);
			});
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

/** The shape of the one clause the adapter (Task 7) sends: a domain tag `In` some values. */
interface CostQueryBody {
	dataset?: { filter?: { tags?: { name?: string; operator?: string; values?: string[] } } };
}

/** The request handler, so a test can serve it without opening a port. */
export function costMockHandler(
	options: { estate?: CostEstate; apiKey?: string; now?: Date } = {}
) {
	const now = options.now ?? new Date();
	const estate = options.estate ?? buildEstate({ now });
	const apiKey = options.apiKey ?? 'local-dev-key';

	return async (request: Request): Promise<Response> => {
		const authorization = request.headers.get('authorization');

		// Checked rather than ignored: the adapter attaches a bearer token on every call,
		// and a mock that accepted anything would not notice if it stopped. Before the body
		// read, same as before — a client that fails auth is owed a 401, not a body parse.
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

		const body = (await request.json().catch(() => null)) as CostQueryBody | null;

		if (!body) {
			return Response.json(
				{ error: { code: 'BadRequest', message: 'Body is not JSON.' } },
				{ status: 400 }
			);
		}

		// The whole clause is checked, not just `values`: a mock that narrowed on the values
		// alone would still answer an adapter that sent the wrong tag key or the wrong
		// operator, and the seam test would pass against a request the real API rejects.
		const clause = body.dataset?.filter?.tags;

		if (clause && clause.operator !== 'In') {
			return Response.json(
				{
					error: {
						code: 'BadRequest',
						message: `Unsupported tag filter operator '${clause.operator}'. Supported: In.`
					}
				},
				{ status: 400 }
			);
		}

		// Tag names are case-insensitive, as in ARM; a tag nobody carries matches no rows.
		const wanted = clause?.values ?? [];
		const rows = !clause
			? estate.rows
			: !sameTagName(clause.name, OWNER_TAG_KEY)
				? []
				: estate.rows.filter((row) => wanted.includes(row[4]));

		// Real Cost Management groups by (day, service); the estate's rows carry a domain too,
		// so a tag filter must re-aggregate back down rather than emit duplicate (day, service)
		// rows for the domains it kept.
		const grouped = new Map<string, [number, number, string, string]>();

		for (const [cost, day, service, currency] of rows) {
			const key = `${day}|${service}`;
			const existing = grouped.get(key);

			if (existing) existing[0] += cost;
			else grouped.set(key, [cost, day, service, currency]);
		}

		return Response.json({
			id: `${pathname}`,
			name: 'query',
			type: 'Microsoft.CostManagement/query',
			properties: { nextLink: null, columns: COLUMNS, rows: [...grouped.values()] }
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
