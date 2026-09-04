import type { PlatformSource, ServiceSource } from '../platform/source';
import { SourceCache } from './cache';
import { createDispatcher } from './dispatch';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from './fixtures';
import { SourceRegistry } from './registry';
import { createRouters } from './routers';

/**
 * Read the connections file, or nothing.
 *
 * `Bun.file` rather than `node:fs`, per the API selection order. A path that is set but
 * unreadable throws: someone meant to configure sources, and quietly falling back to
 * fixtures would serve seeded numbers in production with nothing on the page admitting
 * it — the failure the existing resolver's throw-on-unknown-name already guards against.
 */
export async function readSourceConfig(path: string | undefined): Promise<unknown | null> {
	if (!path) return null;

	const file = Bun.file(path);
	if (!(await file.exists())) {
		throw new Error(`SOURCES_CONFIG points at ${path}, which does not exist.`);
	}

	return file.json();
}

/**
 * Build the registry, the cache and the four routers.
 *
 * With no configuration the fixture providers are connected, so the app behaves exactly
 * as it does today while still exercising the routed path. That matters more than it
 * sounds: it means the routing layer is on the live path from the first commit rather
 * than being a branch nobody runs until a real provider exists.
 */
export function buildSources(options: {
	config: unknown;
	env: Record<string, string | undefined>;
	catalog: { platform: PlatformSource; service: ServiceSource };
}) {
	const registry = new SourceRegistry();
	for (const provider of FIXTURE_PROVIDERS) registry.register(provider);

	registry.load(options.config ?? FIXTURE_CONNECTIONS, options.env);

	// One cache across all four routers: two screens asking different ports for the same
	// capability should still issue one call.
	const deps = { registry, dispatcher: createDispatcher(registry), cache: new SourceCache() };

	return createRouters(deps, options.catalog);
}
