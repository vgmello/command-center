import { env } from '$env/dynamic/private';
import { selectSource } from '../platform/select-source';
import { FixtureCatalogSource } from './fixture-source';
import { readCatalogFile } from './file-source';
import type { CatalogSource } from './source';

/**
 * Which catalog the app runs against.
 *
 * `CATALOG_SOURCE=file` reads the path in `CATALOG_FILE`; anything else fails at startup
 * rather than falling back, for the reason every other resolver here does — a typo that
 * quietly served the fixtures would put invented services on a production dashboard with
 * nothing admitting it.
 *
 * **Adding a database is one class and one entry in this registry.** Nothing above
 * `CatalogSource` changes, because the port speaks in domain types, carries no path or
 * format, and returns only the declared half.
 */
const sources: Record<string, () => Promise<CatalogSource>> = {
	fixture: async () => new FixtureCatalogSource(),
	file: async () => {
		if (!env.CATALOG_FILE) {
			throw new Error('CATALOG_SOURCE=file requires CATALOG_FILE to name a catalog.');
		}

		return readCatalogFile(env.CATALOG_FILE);
	}
};

/**
 * Read once at module load.
 *
 * A catalog changes when someone merges a pull request, not between two requests, so
 * re-reading per call would be I/O bought for nothing. Restarting is how a deployment
 * picks up a new one — which is what a git-backed file implies anyway.
 */
const catalog: CatalogSource = await selectSource('CATALOG_SOURCE', env.CATALOG_SOURCE, sources);

export function catalogSource(): CatalogSource {
	return catalog;
}

export { FixtureCatalogSource } from './fixture-source';
export { FileCatalogSource, parseCatalog, readCatalogFile } from './file-source';
export type { CatalogSource } from './source';
