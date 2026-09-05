import { SQL } from 'bun';
import { and, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { drizzle, type BunSQLDatabase } from 'drizzle-orm/bun-sql';
import type {
	SeriesQuery,
	SourceStore,
	StoreKey,
	StoredDocument,
	StoredSample
} from './source-store';
import { keyOf } from './source-store';
import { sourceDocuments, sourceLeases, sourceSeries } from './schema';
import type { Capability } from '$lib/platform/sources';

/**
 * The store, in Postgres.
 *
 * Through `drizzle-orm/bun-sql`, which sits on Bun's native SQL client — so the only
 * dependency is Drizzle itself. A `pg` driver would have been tier 4 of the API selection
 * order and needed justifying on its own.
 */

/** A fixed-length key, because `args` can carry a whole query object. */
function hashKey(key: StoreKey): string {
	return new Bun.CryptoHasher('sha256').update(keyOf(key)).digest('hex');
}

export class PostgresSourceStore implements SourceStore {
	readonly id = 'postgres';
	readonly #client: SQL;
	readonly #db: BunSQLDatabase;

	constructor(url: string) {
		this.#client = new SQL(url);
		this.#db = drizzle({ client: this.#client });
	}

	/** The underlying handle, for the migrator. */
	get db(): BunSQLDatabase {
		return this.#db;
	}

	async readDocument(key: StoreKey): Promise<StoredDocument | null> {
		const [row] = await this.#db
			.select()
			.from(sourceDocuments)
			.where(eq(sourceDocuments.key, hashKey(key)))
			.limit(1);

		if (!row) return null;

		return { payload: row.payload, fetchedAt: row.fetchedAt, expiresAt: row.expiresAt };
	}

	async writeDocument(key: StoreKey, payload: unknown, ttlSeconds: number): Promise<void> {
		const now = new Date();

		await this.#db
			.insert(sourceDocuments)
			.values({
				key: hashKey(key),
				connectionId: key.connectionId,
				capability: key.capability,
				args: key.args,
				payload: payload as never,
				fetchedAt: now,
				expiresAt: new Date(now.getTime() + ttlSeconds * 1000)
			})
			// A second instance racing to write the same answer overwrites rather than
			// failing: both fetched it, both are right, and the later one is fresher.
			.onConflictDoUpdate({
				target: sourceDocuments.key,
				set: {
					payload: payload as never,
					fetchedAt: now,
					expiresAt: new Date(now.getTime() + ttlSeconds * 1000)
				}
			});
	}

	async readSeries(query: SeriesQuery): Promise<StoredSample[]> {
		const filters = [
			eq(sourceSeries.connectionId, query.connectionId),
			eq(sourceSeries.capability, query.capability),
			eq(sourceSeries.environment, query.environment),
			gte(sourceSeries.bucketAt, query.from),
			lte(sourceSeries.bucketAt, query.to)
		];

		if (query.entities?.length) filters.push(inArray(sourceSeries.entity, query.entities));

		const rows = await this.#db
			.select()
			.from(sourceSeries)
			.where(and(...filters))
			.orderBy(sourceSeries.bucketAt);

		return rows.map((row) => ({
			connectionId: row.connectionId,
			capability: row.capability as Capability,
			environment: row.environment,
			entity: row.entity,
			metric: row.metric,
			bucketAt: row.bucketAt,
			value: row.value,
			settled: row.settled
		}));
	}

	async appendSeries(samples: StoredSample[]): Promise<void> {
		if (samples.length === 0) return;

		// Chunked: Postgres caps a statement's parameters, and a wide window across many
		// entities can run to thousands of rows.
		const CHUNK = 500;

		for (let index = 0; index < samples.length; index += CHUNK) {
			await this.#db
				.insert(sourceSeries)
				.values(samples.slice(index, index + CHUNK))
				// A provisional bucket read again may arrive corrected, so a later write
				// wins. Once settled it is never written again, so nothing can revise it.
				.onConflictDoUpdate({
					target: [
						sourceSeries.connectionId,
						sourceSeries.capability,
						sourceSeries.environment,
						sourceSeries.entity,
						sourceSeries.metric,
						sourceSeries.bucketAt
					],
					set: { value: sql`excluded.value`, settled: sql`excluded.settled` }
				});
		}
	}

	/**
	 * Take the lease, or report that someone else holds a live one.
	 *
	 * One statement, because two — read then write — is a race that hands the same lease
	 * to two instances, which is the exact thing a lease exists to prevent. The conflict
	 * clause only overwrites an *expired* lease, so a live holder is left alone.
	 */
	async claim(key: StoreKey, holder: string, seconds: number): Promise<boolean> {
		const now = new Date();
		const hashed = hashKey(key);

		const taken = await this.#db
			.insert(sourceLeases)
			.values({ key: hashed, holder, expiresAt: new Date(now.getTime() + seconds * 1000) })
			.onConflictDoUpdate({
				target: sourceLeases.key,
				set: { holder, expiresAt: new Date(now.getTime() + seconds * 1000) },
				where: lt(sourceLeases.expiresAt, now)
			})
			.returning({ holder: sourceLeases.holder });

		// No row back means the conflict clause declined: a live lease is held elsewhere.
		return taken.length > 0 && taken[0].holder === holder;
	}

	async release(key: StoreKey, holder: string): Promise<void> {
		// Scoped to the holder: a straggler whose lease already expired and was taken by
		// someone else must not free the new owner's claim.
		await this.#db
			.delete(sourceLeases)
			.where(and(eq(sourceLeases.key, hashKey(key)), eq(sourceLeases.holder, holder)));
	}

	async prune(now: Date, retentionHours: number): Promise<void> {
		const horizon = new Date(now.getTime() - retentionHours * 3_600_000);

		await this.#db.delete(sourceDocuments).where(lt(sourceDocuments.expiresAt, now));
		await this.#db.delete(sourceLeases).where(lt(sourceLeases.expiresAt, now));
		await this.#db.delete(sourceSeries).where(lt(sourceSeries.bucketAt, horizon));
	}

	async close(): Promise<void> {
		await this.#client.close();
	}
}
