/**
 * The Coralogix HTTP client.
 *
 * Coralogix is two APIs behind one account, and this client speaks both:
 *
 * - **Metrics** are Prometheus-compatible — `/metrics/api/v1/query` and `query_range`,
 *   with the standard Prometheus envelope. Anything PromQL can express is available.
 * - **DataPrime** is their own query language over logs and events, at
 *   `/api/v1/dataprime/query`, answering in NDJSON.
 *
 * Both authenticate with `Authorization: Bearer`. `baseUrl` is the only thing that
 * differs between the mock and a real region, and there is no branch here for either.
 */

/** The envelope every Prometheus-compatible endpoint returns. */
export interface PromResponse<T> {
	status: 'success' | 'error';
	data: T;
	error?: string;
	errorType?: string;
}

export interface PromMatrix {
	resultType: 'matrix';
	result: { metric: Record<string, string>; values: [number, string][] }[];
}

export interface PromVector {
	resultType: 'vector';
	result: { metric: Record<string, string>; value: [number, string] }[];
}

/** One row of a DataPrime answer, as it arrives on the wire. */
export interface DataPrimeRow {
	metadata?: { key: string; value: string }[];
	labels?: { key: string; value: string }[];
	userData?: string;
}

export class CoralogixHttpError extends Error {
	constructor(
		readonly status: number,
		readonly path: string
	) {
		// The status and the path, never the body: a Coralogix error can quote the query,
		// and a query can carry identifiers a log line should not.
		super(`Coralogix responded ${status} for ${path}.`);
		this.name = 'CoralogixHttpError';
	}
}

export interface CoralogixClientOptions {
	/**
	 * The region root, e.g. `https://api.eu2.coralogix.com`, or a mock's URL.
	 *
	 * Coralogix is region-partitioned and there is no global endpoint, so this is
	 * configuration rather than a constant with an override.
	 */
	baseUrl: string;
	apiKey: string;
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	timeoutMs?: number;
}

export class CoralogixClient {
	readonly #baseUrl: string;
	readonly #apiKey: string;
	readonly #fetch: (url: string, init?: RequestInit) => Promise<Response>;
	readonly #timeoutMs: number;

	constructor(options: CoralogixClientOptions) {
		this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
		this.#apiKey = options.apiKey;
		this.#fetch = options.fetch ?? globalThis.fetch;
		this.#timeoutMs = options.timeoutMs ?? 10_000;
	}

	get baseUrl(): string {
		return this.#baseUrl;
	}

	async #send(path: string, init: RequestInit): Promise<Response> {
		let response: Response;

		try {
			response = await this.#fetch(`${this.#baseUrl}${path}`, {
				...init,
				headers: {
					Authorization: `Bearer ${this.#apiKey}`,
					Accept: 'application/json',
					...init.headers
				},
				signal: AbortSignal.timeout(this.#timeoutMs)
			});
		} catch {
			// Status 0 stands for "never got an answer". The cause's own text is dropped:
			// a fetch error can quote request headers, and ours carry the API key.
			throw new CoralogixHttpError(0, path);
		}

		if (!response.ok) throw new CoralogixHttpError(response.status, path);

		return response;
	}

	/**
	 * An instant PromQL query — one value per series, at one moment.
	 *
	 * POST rather than GET: a PromQL expression naming several label matchers outgrows a
	 * query string quickly, and Prometheus's own API accepts either.
	 */
	async instant(query: string, at: Date): Promise<PromVector> {
		const body = new URLSearchParams({ query, time: String(at.getTime() / 1000) });
		const response = await this.#send('/metrics/api/v1/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString()
		});

		const parsed = (await response.json()) as PromResponse<PromVector>;
		if (parsed.status !== 'success') throw new CoralogixHttpError(422, '/metrics/api/v1/query');

		return parsed.data;
	}

	/** A PromQL range query — a series of values per series, across a window. */
	async range(query: string, from: Date, to: Date, stepSeconds: number): Promise<PromMatrix> {
		const body = new URLSearchParams({
			query,
			start: String(Math.floor(from.getTime() / 1000)),
			end: String(Math.floor(to.getTime() / 1000)),
			step: String(stepSeconds)
		});

		const response = await this.#send('/metrics/api/v1/query_range', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: body.toString()
		});

		const parsed = (await response.json()) as PromResponse<PromMatrix>;
		if (parsed.status !== 'success')
			throw new CoralogixHttpError(422, '/metrics/api/v1/query_range');

		return parsed.data;
	}

	/**
	 * A DataPrime query over logs and events.
	 *
	 * The answer is NDJSON: a `queryId` line, then batches of results, then a
	 * `statistics` line carrying the terminal status. The rows are collected and the
	 * status checked, because a query that fails partway still answers 200 — reporting
	 * whatever arrived before the failure as the whole truth is how a half-empty
	 * incident list ends up looking calm.
	 */
	async dataprime(query: string, from: Date, to: Date, limit = 1000): Promise<DataPrimeRow[]> {
		const response = await this.#send('/api/v1/dataprime/query', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				query,
				metadata: {
					tier: 'TIER_FREQUENT_SEARCH',
					syntax: 'QUERY_SYNTAX_DATAPRIME',
					startDate: from.toISOString(),
					endDate: to.toISOString(),
					limit
				}
			})
		});

		const rows: DataPrimeRow[] = [];
		let status: string | undefined;

		for (const line of (await response.text()).split('\n')) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			let parsed: {
				result?: { results?: DataPrimeRow[] };
				statistics?: { status?: string };
				error?: unknown;
			};

			try {
				parsed = JSON.parse(trimmed);
			} catch {
				// A malformed line means the stream is not what it claims to be. Better to
				// fail than to report the rows that happened to parse as the whole answer.
				throw new CoralogixHttpError(422, '/api/v1/dataprime/query');
			}

			if (parsed.result?.results) rows.push(...parsed.result.results);
			if (parsed.statistics?.status) status = parsed.statistics.status;
			if (parsed.error) throw new CoralogixHttpError(422, '/api/v1/dataprime/query');
		}

		if (status && status !== 'COMPLETED') {
			throw new CoralogixHttpError(422, '/api/v1/dataprime/query');
		}

		return rows;
	}
}

/** A DataPrime row's `userData` parsed back into an object, or null. */
export function rowData<T>(row: DataPrimeRow): T | null {
	if (!row.userData) return null;

	try {
		return JSON.parse(row.userData) as T;
	} catch {
		return null;
	}
}
