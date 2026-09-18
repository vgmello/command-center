/** Implementation name used when nothing is configured. */
export const DEFAULT_SOURCE = 'fixture';

/**
 * Picks an implementation out of a registry by name, failing loudly on a name that
 * is not there.
 *
 * A typo in `PLATFORM_SOURCE` that quietly fell back to fixtures would make
 * production serve invented numbers with nothing on the page admitting it — the
 * worst outcome available here, and worse than not starting.
 *
 * Lives apart from the resolver so the decision can be tested without `$env`, which
 * only resolves inside a SvelteKit build.
 */
export function selectSource<T>(
	variable: string,
	name: string | undefined,
	registry: Record<string, () => T>
): T {
	const chosen = name?.trim() || DEFAULT_SOURCE;
	const factory = registry[chosen];

	if (!factory) {
		throw new Error(
			`${variable}="${chosen}" is not a known source. Available: ${Object.keys(registry).join(', ')}`
		);
	}

	return factory();
}
