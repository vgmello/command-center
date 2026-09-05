import type { Capability } from '$lib/platform/sources';
import type { SourceStore, StoredDocument } from '../store/source-store';
import type { ConnectionLimits } from './rate-limit';
import { isDocument } from './tiers';

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
	// Fleet-wide, so it costs more to compute and moves more slowly than one service's.
	'apm.platformInsights': 180,
	// The table every screen leans on; short, because a service going down is the
	// thing a reader is watching for.
	'apm.serviceHealth': 30,
	'apm.domainVitals': 30,
	'apm.rates': 30,
	'apm.incidents': 30,
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
	readonly #store: SourceStore | null;
	readonly #limits: ConnectionLimits | null;
	readonly #holder: string;
	readonly #leaseSeconds: number;
	readonly now: () => number;
	readonly deadlineMs: number;

	constructor(
		options: {
			now?: () => number;
			deadlineMs?: number;
			/**
			 * Where answers outlive the process.
			 *
			 * Absent means memory only, which is correct and simply asks the upstream far
			 * more often — so a deployment with no database still works.
			 */
			store?: SourceStore | null;
			/** What bounds how often we may ask. Absent means unbounded. */
			limits?: ConnectionLimits | null;
			/** This instance's identity, for leases. */
			holder?: string;
			leaseSeconds?: number;
		} = {}
	) {
		this.now = options.now ?? Date.now;
		this.deadlineMs = options.deadlineMs ?? 10_000;
		this.#store = options.store ?? null;
		this.#limits = options.limits ?? null;
		this.#holder = options.holder ?? `instance-${Bun.randomUUIDv7().slice(0, 8)}`;
		this.#leaseSeconds = options.leaseSeconds ?? 15;
	}

	/**
	 * The answer, from the nearest tier that has a good one.
	 *
	 * memory → store → limiter → source, and back down. `fetchedAt` travels with it so a
	 * panel can say "Azure, four minutes ago" rather than implying everything is current.
	 */
	async read<T>(
		key: CacheKey,
		load: () => Promise<T>
	): Promise<{ data: T; stale?: true; fetchedAt?: Date }> {
		// JSON, not a space-joined string: a connection id and an args string are both
		// free-form, so concatenating them lets one pair spell another pair's key — and a
		// cache collision means one connection served from another's entry.
		const id = JSON.stringify([key.connectionId, key.capability, key.args]);
		const cached = this.#entries.get(id);

		if (cached && this.now() - cached.at < key.ttlSeconds * 1000) {
			return { data: cached.value as T, fetchedAt: new Date(cached.at) };
		}

		const existing = this.#inFlight.get(id);
		if (existing) return { data: (await existing) as T };

		// The persisted tier. Only whole-answer capabilities come through here: series
		// have their own path, because a window's whole answer would key on the window and
		// share nothing between a fifteen-minute view and a twenty-four-hour one.
		const persisted = this.#store && isDocument(key.capability) ? this.#store : null;
		let stored: StoredDocument | null = null;

		if (persisted) {
			stored = await persisted.readDocument(key).catch(() => null);

			if (stored && stored.expiresAt.getTime() > this.now()) {
				// Promote into memory so the next reader on this instance pays nothing.
				this.#entries.set(id, { value: stored.payload, at: stored.fetchedAt.getTime() });
				return { data: stored.payload as T, fetchedAt: stored.fetchedAt };
			}
		}

		const attempt = this.#fetch(id, key, load, persisted)
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
			return { data: (await attempt) as T, fetchedAt: new Date(this.now()) };
		} catch (cause) {
			// A stale answer beats no answer, but it is never passed off as fresh.
			if (cached) return { data: cached.value as T, stale: true, fetchedAt: new Date(cached.at) };
			if (stored) return { data: stored.payload as T, stale: true, fetchedAt: stored.fetchedAt };
			throw cause;
		}
	}

	/**
	 * Go to the source, once across the deployment where a store allows it.
	 *
	 * The lease is what turns eight cold instances into one upstream call. An instance
	 * refused the lease waits briefly for the winner's row rather than issuing its own —
	 * but only briefly, because serving a page late is better than not serving it, and a
	 * holder can die mid-fetch.
	 */
	async #fetch<T>(
		id: string,
		key: CacheKey,
		load: () => Promise<T>,
		store: SourceStore | null
	): Promise<T> {
		let holding = false;

		if (store) {
			// A store that cannot answer must not stop the read: assume the lease is ours
			// and go to the source, which is the behaviour of a deployment with no store.
			holding = await store.claim(key, this.#holder, this.#leaseSeconds).catch(() => true);

			if (!holding) {
				const waited = await this.#awaitWinner<T>(store, key);
				if (waited) return waited;
			}
		}

		// The limiter is taken as late as possible: a call answered by the store or by
		// another instance's row should not have spent any of the budget.
		if (this.#limits) await this.#limits.take(key.connectionId);

		try {
			const value = await this.withDeadline(load());

			if (store) {
				// A failure to persist must not fail the read — the answer is already in hand.
				await store.writeDocument(key, value, key.ttlSeconds).catch(() => {});
			}

			return value;
		} finally {
			// Released whether the fetch worked or not. Holding it after a failure would
			// make every other instance wait out the poll window for a row that is never
			// coming, which is the slowest possible way to serve nothing.
			if (store && holding) await store.release(key, this.#holder).catch(() => {});
		}
	}

	/** Poll briefly for the lease holder's answer. */
	async #awaitWinner<T>(store: SourceStore, key: CacheKey): Promise<T | null> {
		// Capped well below the lease: a page arriving two seconds late is tolerable,
		// and a holder that died mid-fetch should not cost every reader its whole lease.
		const deadline = this.now() + Math.min(this.#leaseSeconds, 2) * 1000;

		while (this.now() < deadline) {
			await Bun.sleep(100);

			const row = await store.readDocument(key).catch(() => null);
			if (row && row.expiresAt.getTime() > this.now()) return row.payload as T;
		}

		return null;
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
