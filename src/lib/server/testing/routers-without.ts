import { SourceRegistry } from '../sources/registry';
import { createDispatcher } from '../sources/dispatch';
import { SourceCache } from '../sources/cache';
import { createRouters } from '../sources/routers';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from '../sources/fixtures';
import { FixturePlatformSource } from '../platform/fixture-source';
import { FixtureCatalogSource } from '../catalog/fixture-source';
import type { Capability } from '$lib/platform/sources';
import type { ProviderDefinition } from '../sources/provider';

/**
 * The fixture providers, minus some capabilities.
 *
 * Dropping from the declaration rather than making the client throw is what makes this a
 * test of the *gap* path: an undeclared capability is a `CapabilityUnavailableError` from
 * the dispatcher, which is exactly what a partially-capable real provider produces.
 *
 * Shared by `capability-gaps.test.ts` (the sweep) and `domain-infrastructure-view.test.ts`
 * — one helper, two callers, no copy.
 */
export function routersWithout(dropped: readonly Capability[]) {
	const registry = new SourceRegistry();

	for (const provider of FIXTURE_PROVIDERS) {
		const capabilities = new Set(provider.capabilities);
		for (const one of dropped) capabilities.delete(one);
		registry.register({ ...provider, capabilities } as ProviderDefinition<unknown>);
	}

	registry.load(FIXTURE_CONNECTIONS, {});

	return createRouters(
		{ registry, dispatcher: createDispatcher(registry), cache: new SourceCache(), store: null },
		{ platform: new FixturePlatformSource(), services: new FixtureCatalogSource() }
	);
}
