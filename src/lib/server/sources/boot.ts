import type { PlatformSource } from '../platform/source';
import type { CatalogSource } from '../catalog/source';
import { SourceCache } from './cache';
import type { ConnectionLimits } from './rate-limit';
import type { SourceStore } from '../store/source-store';
import { createDispatcher } from './dispatch';
import { FIXTURE_CONNECTIONS, FIXTURE_PROVIDERS } from './fixtures';
import type { ProviderDefinition } from './provider';
import { REAL_PROVIDERS } from './providers';
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
 * Which providers a configuration may name.
 *
 * With no configuration at all, the fixtures — the app runs as it always has.
 *
 * With a configuration, the real providers only. A connections file naming
 * `fixture-cloud` is refused rather than serving seeded numbers with nothing on the page
 * admitting it, which is the failure the port resolver's throw-on-unknown-name exists to
 * prevent.
 *
 * `SOURCES_ALLOW_FIXTURES` re-admits the fixtures alongside the real ones. That is a
 * genuine local-development need — one real provider configured, the other kinds still
 * seeded, because nothing yet renders a capability gap as anything but a broken page.
 * It is an environment variable rather than a flag in the config file on purpose: which
 * data a deployment is allowed to invent is a deployment decision, and the config file
 * is the thing most likely to be copied from a laptop to a server by mistake.
 */
function providersFor(options: {
	config: unknown;
	env: Record<string, string | undefined>;
	providers?: readonly ProviderDefinition<unknown>[];
}): readonly ProviderDefinition<unknown>[] {
	if (options.providers) return options.providers;
	if (options.config == null) return FIXTURE_PROVIDERS;

	return options.env.SOURCES_ALLOW_FIXTURES === 'true'
		? [...REAL_PROVIDERS, ...FIXTURE_PROVIDERS]
		: REAL_PROVIDERS;
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
	catalog: { platform: PlatformSource; services: CatalogSource };
	/**
	 * Which providers may be named.
	 *
	 * With no configuration this is the fixtures, so the app runs as it always has. With
	 * a configuration it is the real providers ONLY — a connections file naming
	 * "fixture-cloud" is refused rather than serving seeded numbers with nothing on the
	 * page admitting it.
	 */
	providers?: readonly ProviderDefinition<unknown>[];
	/**
	 * Where answers outlive the process.
	 *
	 * Absent means memory only, which is correct and simply asks the upstream far more
	 * often — a deployment with no database still works.
	 */
	store?: SourceStore | null;
	/** What bounds how often the sources may be asked. Absent means unbounded. */
	limits?: ConnectionLimits | null;
}) {
	const registry = new SourceRegistry();
	for (const provider of providersFor(options)) registry.register(provider);

	registry.load(options.config ?? FIXTURE_CONNECTIONS, options.env);

	// One cache across all four routers: two screens asking different ports for the same
	// capability should still issue one call.
	//
	// The store and the limiter are optional. With neither, this is exactly the behaviour
	// it has always had — memory only, and the upstream asked whenever it misses.
	const deps = {
		registry,
		dispatcher: createDispatcher(registry),
		cache: new SourceCache({ store: options.store ?? null, limits: options.limits ?? null })
	};

	return createRouters(deps, options.catalog);
}
