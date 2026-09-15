import type { TokenCredential } from '@azure/identity';

/**
 * Azure Resource Manager and Monitor, over `fetch`.
 *
 * Not an SDK client, per the API selection order: the requirement is authenticated GETs,
 * paging and a metrics query, which `fetch` does. `@azure/identity` is the one dependency
 * taken, because acquiring and refreshing a token is the security-sensitive half and is
 * exactly what the order says not to hand-roll.
 */

/** What ARM calls a paged collection: a page of values and an absolute link to the next. */
interface Page<T> {
	value: T[];
	nextLink?: string;
}

export interface MetricSeries {
	name: string;
	points: Array<{ at: Date; value: number }>;
}

export interface AzureClientOptions {
	/** The ARM root. floci-az locally, `https://management.azure.com` in production. */
	baseUrl: string;
	/** Cost Management's root, which is ARM in production and our own mock locally. */
	costBaseUrl: string;
	subscriptionId: string;
	credential: TokenCredential;
	/** The scope a token is requested for. Differs when ARM is not the real ARM. */
	scope?: string;
}

const ARM_SCOPE = 'https://management.azure.com/.default';

export class AzureClient {
	readonly #options: AzureClientOptions;
	/** The current token and when it dies, so a request does not fetch one every time. */
	#token: { value: string; expiresAt: number } | null = null;

	constructor(options: AzureClientOptions) {
		this.#options = options;
	}

	get subscriptionId(): string {
		return this.#options.subscriptionId;
	}

	/** `/subscriptions/{id}` — the prefix almost every ARM path hangs off. */
	get scopePath(): string {
		return `/subscriptions/${this.#options.subscriptionId}`;
	}

	/**
	 * A bearer token, cached until shortly before it expires.
	 *
	 * The minute of headroom is because a token that expires mid-flight fails the request
	 * rather than the refresh, which is the confusing way round.
	 */
	async #authorization(): Promise<string> {
		if (this.#token && Date.now() < this.#token.expiresAt - 60_000) {
			return `Bearer ${this.#token.value}`;
		}

		const token = await this.#options.credential.getToken(this.#options.scope ?? ARM_SCOPE);
		if (!token) throw new Error('Azure credential returned no token.');

		this.#token = { value: token.token, expiresAt: token.expiresOnTimestamp };
		return `Bearer ${token.token}`;
	}

	/**
	 * One GET, absolute or relative to the subscription.
	 *
	 * A failure carries ARM's own error code rather than the body: the body can contain the
	 * resource ids of a whole subscription, and an exception message ends up in logs.
	 */
	async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
		const url = path.startsWith('http')
			? new URL(path)
			: new URL(`${this.#options.baseUrl}${path}`);

		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined) url.searchParams.set(key, String(value));
		}

		const response = await fetch(url, {
			headers: { authorization: await this.#authorization(), accept: 'application/json' }
		});

		if (!response.ok) {
			const code = await this.#errorCode(response);
			throw new Error(`Azure ${response.status} on ${url.pathname}${code ? `: ${code}` : ''}`);
		}

		return response.json() as Promise<T>;
	}

	async #errorCode(response: Response): Promise<string | null> {
		try {
			const body = (await response.json()) as { error?: { code?: string } };
			return body.error?.code ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Every page of a collection, up to `limit`.
	 *
	 * ARM pages with an **absolute `nextLink`**, not a skip offset — a client that assumed
	 * offsets would re-read page one forever, and would look like it worked because page
	 * one is full of real data. The limit is a bound on rows, not on pages, and it stops
	 * as soon as it has enough rather than walking an estate to show ten.
	 */
	async collect<T>(
		path: string,
		options: { limit: number; params?: Record<string, string | number | undefined> }
	): Promise<T[]> {
		const rows: T[] = [];
		let next: string | undefined = path;

		while (next && rows.length < options.limit) {
			const page: Page<T> = await this.get<Page<T>>(
				next,
				next === path ? (options.params ?? {}) : {}
			);

			rows.push(...(page.value ?? []));
			next = page.nextLink;
		}

		return rows.slice(0, options.limit);
	}

	/**
	 * A Monitor metrics query for one resource.
	 *
	 * Returns the series in the order asked for, with absent ones as empty rather than
	 * missing — a caller lining up three metrics on one axis should not have to discover
	 * that the second is not there.
	 */
	async metrics(
		resourceId: string,
		names: readonly string[],
		window: { from: Date; to: Date; stepSeconds: number },
		aggregation: 'Average' | 'Total' | 'Maximum' = 'Average'
	): Promise<MetricSeries[]> {
		const body = await this.get<{
			value: Array<{
				name: { value: string };
				timeseries: Array<{
					data: Array<{ timeStamp: string; average?: number; total?: number; maximum?: number }>;
				}>;
			}>;
		}>(`${resourceId}/providers/Microsoft.Insights/metrics`, {
			'api-version': '2018-01-01',
			metricnames: names.join(','),
			aggregation,
			interval: isoDuration(window.stepSeconds),
			timespan: `${window.from.toISOString()}/${window.to.toISOString()}`
		});

		const read = (point: { average?: number; total?: number; maximum?: number }) =>
			point.average ?? point.total ?? point.maximum ?? 0;

		const byName = new Map(
			(body.value ?? []).map((metric) => [
				metric.name.value,
				(metric.timeseries?.[0]?.data ?? []).map((point) => ({
					at: new Date(point.timeStamp),
					value: read(point)
				}))
			])
		);

		return names.map((name) => ({ name, points: byName.get(name) ?? [] }));
	}

	/** Cost Management lives at its own root locally, and on ARM in production. */
	async queryCost<T>(body: unknown): Promise<T> {
		const url = `${this.#options.costBaseUrl}${this.scopePath}/providers/Microsoft.CostManagement/query`;

		const response = await fetch(`${url}?api-version=2021-10-01`, {
			method: 'POST',
			headers: {
				authorization: await this.#authorization(),
				'content-type': 'application/json',
				accept: 'application/json'
			},
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const code = await this.#errorCode(response);
			throw new Error(`Azure ${response.status} on Cost Management${code ? `: ${code}` : ''}`);
		}

		return response.json() as Promise<T>;
	}

	/** Where a resource lives in the portal. */
	portalLink(tenantId: string, resourceId: string, view: string): string {
		return `https://portal.azure.com/#@${tenantId}/resource${resourceId}/${view}`;
	}
}

/**
 * The Monitor interval for a step, in seconds.
 *
 * Monitor accepts a fixed set of intervals and rejects anything else, so this snaps rather
 * than converts: a faithful `PT90S` for a ninety-second step is the correct translation of
 * the number and a request Azure refuses. It snaps *down* to the largest supported interval
 * that fits, because a coarser one would silently return fewer points than the caller's
 * grid expects — and the accumulator stores at a canonical resolution.
 */
const MONITOR_INTERVALS: Array<[number, string]> = [
	[86_400, 'P1D'],
	[43_200, 'PT12H'],
	[21_600, 'PT6H'],
	[3_600, 'PT1H'],
	[1_800, 'PT30M'],
	[900, 'PT15M'],
	[300, 'PT5M'],
	[60, 'PT1M']
];

export function isoDuration(seconds: number): string {
	for (const [size, name] of MONITOR_INTERVALS) {
		if (seconds >= size) return name;
	}

	// A minute is the finest Monitor offers; asking for less is asking for a 400.
	return 'PT1M';
}
