/**
 * The Octopus HTTP client.
 *
 * Everything that talks to the network lives here, so the mapping layer stays pure and
 * the provider stays a mapping table. `baseUrl` is the only thing that differs between
 * the mock and a customer's server — there is no branch in this file for one or the
 * other, and that is the property the mock exists to prove.
 */

/** The paged envelope every Octopus collection endpoint returns. */
export interface OctopusPage<T> {
	Items: T[];
	ItemsPerPage: number;
	TotalResults: number;
	NumberOfPages: number;
}

export class OctopusHttpError extends Error {
	constructor(
		readonly status: number,
		readonly path: string
	) {
		// The status and the path, never the response body: an Octopus error can echo
		// request context, and the settings that built the request hold an API key.
		super(`Octopus responded ${status} for ${path}.`);
		this.name = 'OctopusHttpError';
	}
}

export interface OctopusClientOptions {
	baseUrl: string;
	apiKey: string;
	spaceId: string;
	/**
	 * Swapped in tests that need to count calls. Defaults to the global.
	 *
	 * Narrower than `typeof fetch` on purpose: this client only ever passes a URL string
	 * and an init, so demanding the full global signature would force every test double
	 * to carry members it never uses.
	 */
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
	/** Per-request ceiling. The cache's own deadline sits above this. */
	timeoutMs?: number;
}

/** Octopus caps a page at thirty, whatever `take` asks for. */
const MAX_TAKE = 30;

export class OctopusClient {
	readonly #baseUrl: string;
	readonly #apiKey: string;
	readonly #spaceId: string;
	readonly #fetch: (url: string, init?: RequestInit) => Promise<Response>;
	readonly #timeoutMs: number;

	constructor(options: OctopusClientOptions) {
		// A trailing slash would produce `//api` on every request. Real servers tolerate
		// it; not every proxy in front of one does.
		this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
		this.#apiKey = options.apiKey;
		this.#spaceId = options.spaceId;
		this.#fetch = options.fetch ?? globalThis.fetch;
		this.#timeoutMs = options.timeoutMs ?? 10_000;
	}

	get spaceId(): string {
		return this.#spaceId;
	}

	get baseUrl(): string {
		return this.#baseUrl;
	}

	/**
	 * One GET, as JSON.
	 *
	 * `AbortSignal.timeout` rather than a hand-rolled race: it aborts the request itself
	 * rather than leaving it running while we stop waiting for it, which is what keeps a
	 * hung upstream from holding a socket for the process's lifetime.
	 */
	async get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
		const url = new URL(`${this.#baseUrl}${path}`);
		for (const [key, value] of Object.entries(params)) {
			if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
		}

		let response: Response;
		try {
			response = await this.#fetch(url.toString(), {
				headers: { 'X-Octopus-ApiKey': this.#apiKey, Accept: 'application/json' },
				signal: AbortSignal.timeout(this.#timeoutMs)
			});
		} catch {
			// Status 0 stands for "never got an answer" — a refused connection, DNS, or the
			// abort above. The cause's own text is dropped rather than wrapped: a fetch
			// error can quote request headers, and ours carry the API key.
			throw new OctopusHttpError(0, path);
		}

		if (!response.ok) throw new OctopusHttpError(response.status, path);

		return (await response.json()) as T;
	}

	/** A path under the configured space. */
	spaced(name: string): string {
		return `/api/${this.#spaceId}/${name}`;
	}

	/**
	 * Read a whole collection, following the server's paging.
	 *
	 * `limit` bounds the walk so a large instance cannot turn one panel into hundreds of
	 * requests. The cap is deliberate rather than defensive: a screen that shows fifty
	 * rows has no use for the four thousandth.
	 */
	async collect<T>(
		path: string,
		options: { limit: number; params?: Record<string, string | number | undefined> } = {
			limit: MAX_TAKE
		}
	): Promise<T[]> {
		const items: T[] = [];
		let skip = 0;

		while (items.length < options.limit) {
			const take = Math.min(MAX_TAKE, options.limit - items.length);
			const body = await this.get<OctopusPage<T>>(path, { ...options.params, skip, take });

			items.push(...body.Items);

			// Stop on a short page as well as on the count: a server that reports a
			// TotalResults it then cannot fill would otherwise loop forever.
			if (body.Items.length === 0 || items.length >= body.TotalResults) break;
			skip += body.Items.length;
		}

		return items.slice(0, options.limit);
	}

	/**
	 * Fetch records by id in batches.
	 *
	 * This is the call that keeps a page of deployments to two requests instead of
	 * thirty-one: the ids go up in one `?ids=` query rather than one request per row.
	 */
	async byIds<T extends { Id: string }>(
		path: string,
		ids: readonly string[]
	): Promise<Map<string, T>> {
		const unique = [...new Set(ids)].filter(Boolean);
		const found = new Map<string, T>();

		for (let index = 0; index < unique.length; index += MAX_TAKE) {
			const batch = unique.slice(index, index + MAX_TAKE);
			const body = await this.get<OctopusPage<T>>(path, {
				ids: batch.join(','),
				take: batch.length
			});

			for (const item of body.Items) found.set(item.Id, item);
		}

		return found;
	}
}
