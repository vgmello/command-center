import {
	boolean,
	doublePrecision,
	index,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp
} from 'drizzle-orm/pg-core';

/**
 * What the sources told us, kept so we do not ask again.
 *
 * Three tables, and only one of them has volume. See
 * `docs/superpowers/specs/2026-09-04-source-store-design.md` for why the thirty
 * capabilities split three ways and why only two of those ways are persisted.
 */

/**
 * Whole answers to reference reads — region lists, node counts, dependency graphs.
 *
 * Keyed by a hash rather than by the natural tuple, because `args` can carry a whole
 * query object: a domain search string alone is bounded at 120 characters, and Postgres
 * refuses a btree entry over about 2700 bytes. Hashing makes the key a fixed 64 characters
 * whatever a caller asks for. The components travel beside it so a row can still be read
 * by a human debugging a cache.
 */
export const sourceDocuments = pgTable('source_documents', {
	/** sha256 of [connectionId, capability, args] — the memory tier's own id, hashed. */
	key: text('key').primaryKey(),
	connectionId: text('connection_id').notNull(),
	capability: text('capability').notNull(),
	args: text('args').notNull(),
	payload: jsonb('payload').notNull(),
	fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
});

/**
 * Accumulated samples.
 *
 * Not a cache: a closed bucket never changes, so these are written once and read forever.
 * Stored at one canonical resolution and downsampled on read — storing at whatever step a
 * query happened to ask for would mean a 15-minute view and a 24-hour view shared no rows,
 * which is the entire benefit.
 *
 * `settled` is what a late sample cannot corrupt. A bucket stays provisional until it is
 * older than the connection's settling window, and only settled rows are trusted on a
 * later read.
 *
 * The primary key ends with `bucketAt` deliberately: TimescaleDB requires the partitioning
 * column in every unique index, so `create_hypertable` remains possible on this table
 * without a schema change if the volume ever justifies it. At the volumes computed in the
 * spec — under four gigabytes for a two-hundred-service estate — it does not.
 */
export const sourceSeries = pgTable(
	'source_series',
	{
		connectionId: text('connection_id').notNull(),
		capability: text('capability').notNull(),
		environment: text('environment').notNull(),
		/** A service, a route, an instance. Empty for an estate-wide aggregate. */
		entity: text('entity').notNull(),
		/** `p95`, `error_rate`, `request_rate`. */
		metric: text('metric').notNull(),
		bucketAt: timestamp('bucket_at', { withTimezone: true }).notNull(),
		value: doublePrecision('value').notNull(),
		settled: boolean('settled').notNull().default(false)
	},
	(table) => [
		primaryKey({
			columns: [
				table.connectionId,
				table.capability,
				table.environment,
				table.entity,
				table.metric,
				table.bucketAt
			]
		}),
		// The read path asks for a window across every entity of one capability, which the
		// primary key cannot serve — its leading columns are the wrong ones for that scan.
		index('source_series_window').on(
			table.connectionId,
			table.capability,
			table.environment,
			table.bucketAt
		)
	]
);

/**
 * Who is currently fetching what.
 *
 * Single-flight across the deployment rather than within one process. Eight instances
 * starting cold otherwise issue eight identical calls at a rate-limited API at the moment
 * it can least absorb them; with a lease, one fetches and the rest wait for the row.
 */
export const sourceLeases = pgTable('source_leases', {
	key: text('key').primaryKey(),
	/** Which instance holds it — for diagnosing a lease that outlived its holder. */
	holder: text('holder').notNull(),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull()
});
