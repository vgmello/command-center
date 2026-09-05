import type { Capability } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';
import { DEFAULT_TTL_SECONDS, type SourceCache } from '../cache';
import type { Dispatcher } from '../dispatch';
import type { SourceContext } from '../provider';
import type { SourceRegistry } from '../registry';
import type { SourceStore, StoredSample } from '../../store/source-store';
import {
	BUCKET_SECONDS,
	MAX_STORED_SECONDS,
	RANGE_SECONDS,
	gapFor,
	groupSamples,
	toSamples,
	type SeriesKey
} from '../series';

export interface RouterDeps {
	registry: SourceRegistry;
	dispatcher: Dispatcher;
	cache: SourceCache;
	/**
	 * Where series accumulate.
	 *
	 * Optional: with no store the series path degrades to an ordinary fan-out, which is
	 * exactly the behaviour before there was one.
	 */
	store?: SourceStore | null;
}

/**
 * How long this capability's answer keeps, letting a provider override the default.
 *
 * The first connection that supports it decides. With several connections of one kind
 * their TTLs could differ, and the shortest would be the safe choice — but the fan-out
 * is cached as one entry, so one number has to win, and the first is stable.
 */
function ttlFor(deps: RouterDeps, capability: Capability): number {
	return (
		deps.registry.supporting(capability)[0]?.definition.ttl?.[capability] ??
		DEFAULT_TTL_SECONDS[capability]
	);
}

/**
 * The cache key's argument half, scope included.
 *
 * A capability's answer depends on which environment and which window were asked about,
 * so two scopes must be two entries. Leaving scope out is not a crash — it is one
 * environment's numbers served under another environment's heading, which is worse.
 *
 * Nested JSON rather than a joined string, for the same reason the key itself is JSON:
 * an args string is free-form and could otherwise spell a different scope's key.
 */
function scopedArgs(scope: PlatformScope, args: string): string {
	return JSON.stringify([scope.environment, scope.timeRange, args]);
}

/**
 * An aggregate read whose answer is a list: fan out, concatenate, cache.
 *
 * Shared by every router, because what differs between them is which capability answers
 * which port method — never how dispatch or caching work.
 */
export async function fanOut<T>(
	deps: RouterDeps,
	capability: Capability,
	scope: PlatformScope,
	args: string,
	call: (client: unknown, ctx: SourceContext) => Promise<T[]>
): Promise<T[]> {
	// `stale` is dropped here: the ports this feeds return plain data (`listRegions`
	// returns `InfraRegion[]`), so there is nowhere for a staleness marker to travel
	// without changing the port interfaces. It lands once the panel types carry it.
	const { data } = await deps.cache.read(
		{
			connectionId: 'fan-out',
			capability,
			args: scopedArgs(scope, args),
			ttlSeconds: ttlFor(deps, capability)
		},
		async () => (await deps.dispatcher.all<T>({ capability, scope, call })).data
	);

	// `all` already concatenates each connection's list into one, which is what the port
	// wants. Nothing to flatten here — see the dispatcher's flatMap.
	return data as T[];
}

/**
 * An aggregate read whose answer is a single value.
 *
 * With several connections the first answer stands. Nothing merges two answers to one
 * question — that is what "each resource belongs to one source" bought, and a router is
 * not the place to start reconciling.
 */
export async function fanOutSingle<T>(
	deps: RouterDeps,
	capability: Capability,
	scope: PlatformScope,
	args: string,
	call: (client: unknown, ctx: SourceContext) => Promise<T>
): Promise<T> {
	// Same trade-off as fanOut() above: `stale` is dropped because the single-value
	// ports this feeds (e.g. `readNodeCounts` returning `NodeCounts`) have nowhere to
	// carry it without changing the port interfaces, which this work must not touch.
	const { data } = await deps.cache.read(
		{
			connectionId: 'fan-out',
			capability,
			args: scopedArgs(scope, args),
			ttlSeconds: ttlFor(deps, capability)
		},
		// `all` deals in lists, so a single-valued aggregate is wrapped into a
		// one-element list and unwrapped again below. The alternative is a third
		// dispatch rule, and two is the number this design deliberately stopped at.
		async () =>
			(
				await deps.dispatcher.all<T>({
					capability,
					scope,
					call: async (client, ctx) => [await call(client, ctx)]
				})
			).data
	);

	return (data as T[])[0];
}

/**
 * An aggregate read whose answer is a set of time series, accumulated rather than cached.
 *
 * The store already holds most of a chart's history, and a closed bucket never changes —
 * so this reads what is there, asks the source only for the gap, and merges. A warm store
 * turns a twenty-four-hour chart from a day of history into a few minutes of it, which is
 * the largest single saving available against a rate limit.
 *
 * `flatten` says how the provider's answer decomposes into named series, and `rebuild`
 * puts it back together. They are declared per capability rather than inferred, because
 * the answers have genuinely different shapes — six named series here, a heatmap there —
 * and a generic decomposition would be a guess about all of them.
 *
 * With no store this is an ordinary fan-out: the provider is asked for the whole window,
 * exactly as before.
 */
export async function fanOutSeries<T>(
	deps: RouterDeps,
	capability: Capability,
	scope: PlatformScope,
	args: string,
	shape: {
		/**
		 * Decompose an answer into named series.
		 *
		 * The window is passed because the answer covers *the gap*, not the whole range —
		 * a `TimeSeries` carries axis labels rather than instants, so the only way its
		 * points become samples is to spread them across the window they were asked for.
		 */
		flatten: (
			answer: T,
			window: { from: Date; to: Date }
		) => Array<{ key: SeriesKey; points: Array<{ at: Date; value: number }> }>;
		rebuild: (groups: Map<string, StoredSample[]>, window: { from: Date; to: Date }) => T;
	},
	call: (client: unknown, ctx: SourceContext) => Promise<T>
): Promise<T> {
	const store = deps.store;
	const now = new Date();
	const span = Math.min(RANGE_SECONDS[scope.timeRange], MAX_STORED_SECONDS);
	const want = { from: new Date(now.getTime() - span * 1000), to: now };

	// Beyond the stored horizon, or with no store at all, ask for the whole window. A
	// rolled-up table is what extends that, and it is deliberately a later increment.
	if (!store || RANGE_SECONDS[scope.timeRange] > MAX_STORED_SECONDS) {
		return fanOutSingle(deps, capability, scope, args, call);
	}

	const connection = deps.registry.supporting(capability)[0];
	if (!connection) return fanOutSingle(deps, capability, scope, args, call);

	const query = {
		connectionId: connection.ref.id,
		capability,
		environment: scope.environment,
		from: want.from,
		to: want.to
	};

	const stored: StoredSample[] = await store.readSeries(query).catch(() => []);
	const gap = gapFor(stored, want, now);

	if (gap) {
		// Only the gap, at the canonical resolution — samples fetched at the query's own
		// step would not line up with what is already stored.
		const fetched = await fanOutSingle(deps, capability, scope, args, (client, ctx) =>
			call(client, { ...ctx, window: { ...gap, stepSeconds: BUCKET_SECONDS } })
		);

		const samples = toSamples(shape.flatten(fetched, gap), query, now);
		await store.appendSeries(samples).catch(() => {});

		// Merge in memory rather than re-reading: the rows were just written, and a second
		// round trip to learn what we already know is the thing being avoided.
		stored.push(...samples);
	}

	return shape.rebuild(groupSamples(stored), want);
}
