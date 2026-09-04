import type { Capability } from '$lib/platform/sources';

/**
 * How long each capability's answer stays good.
 *
 * One TTL for everything is either stale or wasteful: regions change monthly,
 * utilisation by the minute, and spend once a day whatever anyone does. Every capability
 * is listed rather than defaulted, so adding one is a compile error instead of a silent
 * inheritance of a number that suits it badly.
 */
export const DEFAULT_TTL_SECONDS: Record<Capability, number> = {
	'cloud.regions': 86_400,
	'cloud.nodes': 60,
	'cloud.clusters': 60,
	'cloud.utilization': 30,
	'cloud.storage': 3_600,
	'cloud.databases': 300,
	'cloud.queues': 60,
	'cloud.alerts': 30,
	'cloud.cost': 3_600,
	'apm.serviceStats': 30,
	'apm.healthChecks': 30,
	'apm.endpoints': 60,
	'apm.metricSeries': 30,
	'apm.requestRate': 30,
	'apm.slo': 300,
	'apm.latencyHeatmap': 60,
	'apm.insights': 120,
	'apm.domainVitals': 30,
	'apm.rates': 30,
	'apm.incidents': 30,
	'apm.activity': 60,
	'apm.dependencies': 600,
	'deployment.log': 30,
	'deployment.summary': 60,
	'deployment.trends': 300,
	'deployment.statusTrend': 60,
	'deployment.breakdown': 60,
	'deployment.insights': 300,
	'deployment.domains': 600
};

export interface CacheKey {
	connectionId: string;
	capability: Capability;
	/** A stable string for the call's arguments. Different args, different entry. */
	args: string;
	ttlSeconds: number;
}

interface Entry {
	value: unknown;
	at: number;
}

/**
 * TTL, single-flight, a deadline, and stale-on-failure.
 *
 * Single-flight matters more than the storage does: a page whose seven panels all want
 * `cloud.nodes` must issue one API call rather than seven. That is the largest
 * protection a rate limit will get, and it is most of what this class is.
 */
export class SourceCache {
	readonly #entries = new Map<string, Entry>();
	readonly #inFlight = new Map<string, Promise<unknown>>();
	readonly now: () => number;
	readonly deadlineMs: number;

	constructor(options: { now?: () => number; deadlineMs?: number } = {}) {
		this.now = options.now ?? Date.now;
		this.deadlineMs = options.deadlineMs ?? 10_000;
	}

	async read<T>(key: CacheKey, load: () => Promise<T>): Promise<{ data: T; stale?: true }> {
		// JSON, not a space-joined string: a connection id and an args string are both
		// free-form, so concatenating them lets one pair spell another pair's key — and a
		// cache collision means one connection served from another's entry.
		const id = JSON.stringify([key.connectionId, key.capability, key.args]);
		const cached = this.#entries.get(id);

		if (cached && this.now() - cached.at < key.ttlSeconds * 1000) {
			return { data: cached.value as T };
		}

		const existing = this.#inFlight.get(id);
		if (existing) return { data: (await existing) as T };

		const attempt = this.withDeadline(load())
			.then((value) => {
				this.#entries.set(id, { value, at: this.now() });
				return value;
			})
			.finally(() => {
				// Cleared whether it resolved or threw, so one failure does not poison the
				// key for every later caller.
				this.#inFlight.delete(id);
			});

		this.#inFlight.set(id, attempt);

		try {
			return { data: (await attempt) as T };
		} catch (cause) {
			// A stale answer beats no answer, but it is never passed off as fresh.
			if (cached) return { data: cached.value as T, stale: true };
			throw cause;
		}
	}

	clear(): void {
		this.#entries.clear();
		this.#inFlight.clear();
	}

	/** A hung upstream must fail one panel rather than hold the page open. */
	private withDeadline<T>(work: Promise<T>): Promise<T> {
		let timer: ReturnType<typeof setTimeout>;

		return Promise.race([
			work,
			new Promise<never>((_resolve, reject) => {
				timer = setTimeout(
					() => reject(new Error(`Source call exceeded its ${this.deadlineMs}ms deadline.`)),
					this.deadlineMs
				);
			})
		]).finally(() => clearTimeout(timer)) as Promise<T>;
	}
}
