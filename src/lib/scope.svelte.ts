import { getContext, setContext } from 'svelte';
import type { EnvironmentId, TimeRangeId } from './platform/types';

/**
 * The scope every panel on the page is read through: which environment, over
 * what window, and whether the view keeps itself current.
 *
 * Held in component context rather than module scope. Module-level `$state`
 * would be a single instance shared by every concurrent SSR request on the
 * server — one user's environment switch would leak into another's render.
 * Context is created per render, so it cannot.
 */
export class Scope {
	environment = $state<EnvironmentId>('production');
	timeRange = $state<TimeRangeId>('15m');
	autoRefresh = $state(true);

	/** How often an auto-refreshing view refetches, in milliseconds. */
	readonly refreshIntervalMs = 15_000;
}

const KEY = Symbol('command-center:scope');

export function setScope(): Scope {
	return setContext(KEY, new Scope());
}

export function getScope(): Scope {
	const scope = getContext<Scope | undefined>(KEY);
	if (!scope) throw new Error('getScope() called outside a component tree with setScope()');
	return scope;
}
