import type { Capability } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';
import { DEFAULT_TTL_SECONDS, type SourceCache } from '../cache';
import type { Dispatcher } from '../dispatch';
import type { SourceContext } from '../provider';
import type { SourceRegistry } from '../registry';

export interface RouterDeps {
	registry: SourceRegistry;
	dispatcher: Dispatcher;
	cache: SourceCache;
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
