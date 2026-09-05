import type { Capability } from '$lib/platform/sources';

/**
 * What the sources told us, kept so we do not ask again.
 *
 * A port, like everything else here: an in-memory implementation for tests that do not
 * care, Postgres for real, and nothing above it knows which. See
 * `docs/superpowers/specs/2026-09-04-source-store-design.md`.
 */

/** The identity of one cached answer — the same tuple the memory tier keys on. */
export interface StoreKey {
	connectionId: string;
	capability: Capability;
	/** The scoped argument string the router built. */
	args: string;
}

export interface StoredDocument {
	payload: unknown;
	fetchedAt: Date;
	expiresAt: Date;
}

/** One point of one series. */
export interface StoredSample {
	connectionId: string;
	capability: Capability;
	environment: string;
	/** A service, a route, an instance. Empty for an estate-wide aggregate. */
	entity: string;
	metric: string;
	bucketAt: Date;
	value: number;
	/**
	 * Whether a late sample can still revise it.
	 *
	 * Provisional buckets are re-fetched on every read; settled ones never are. Writing a
	 * bucket as settled the instant its window closes is how a backfilled number gets
	 * baked in permanently.
	 */
	settled: boolean;
}

export interface SeriesQuery {
	connectionId: string;
	capability: Capability;
	environment: string;
	from: Date;
	to: Date;
	/** Restrict to particular entities, or every one when absent. */
	entities?: string[];
}

export interface SourceStore {
	/** Which implementation answered. Surfaced in diagnostics, never in a payload. */
	readonly id: string;

	readDocument(key: StoreKey): Promise<StoredDocument | null>;
	writeDocument(key: StoreKey, payload: unknown, ttlSeconds: number): Promise<void>;

	readSeries(query: SeriesQuery): Promise<StoredSample[]>;
	/** Upsert: a provisional bucket read again may arrive with a corrected value. */
	appendSeries(samples: StoredSample[]): Promise<void>;

	/**
	 * Claim a key for a few seconds, or report that someone else holds it.
	 *
	 * Single-flight across the deployment rather than within one process. Returns `true`
	 * when the caller may fetch, `false` when another instance already is.
	 */
	claim(key: StoreKey, holder: string, seconds: number): Promise<boolean>;

	/** Drop expired documents, dead leases, and samples past their retention. */
	prune(now: Date, retentionHours: number): Promise<void>;

	close(): Promise<void>;
}

/**
 * The string a key hashes to.
 *
 * The same shape the memory cache builds, so the two tiers cannot disagree about what a
 * request was. Hashed by the store because `args` can carry a whole query object and
 * Postgres refuses a btree entry over about 2700 bytes.
 */
export function keyOf(key: StoreKey): string {
	return JSON.stringify([key.connectionId, key.capability, key.args]);
}
