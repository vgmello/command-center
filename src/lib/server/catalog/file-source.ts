import * as v from 'valibot';
import type { CatalogDomain, CatalogService } from '$lib/platform/catalog';
import type { CatalogSource } from './source';
import { buildCatalog, catalogFileSchema } from './schema';

/**
 * A catalog read from a file.
 *
 * The first implementation of `CatalogSource`, and the one a database is expected to
 * replace. Everything file-shaped stops here: the parsing, the schema, the path. Nothing
 * above the port knows this exists.
 *
 * The file is read once and held. A catalog changes when someone merges a pull request,
 * not between two requests, so re-reading per call would be I/O bought for nothing — and
 * a `reload()` on the port would be a file concept a database would implement as a no-op.
 * Restarting is how a deployment picks up a new catalog, which is what a git-backed file
 * implies anyway.
 */
export class FileCatalogSource implements CatalogSource {
	readonly id = 'file';
	readonly #domains: CatalogDomain[];
	readonly #services: CatalogService[];

	constructor(parsed: { domains: CatalogDomain[]; services: CatalogService[] }) {
		this.#domains = parsed.domains;
		this.#services = parsed.services;
	}

	async listDomains(): Promise<CatalogDomain[]> {
		return [...this.#domains];
	}

	async findDomain(slug: string): Promise<CatalogDomain | null> {
		return this.#domains.find((one) => one.slug === slug) ?? null;
	}

	async listServices(domainId?: string): Promise<CatalogService[]> {
		return domainId
			? this.#services.filter((one) => one.domainId === domainId)
			: [...this.#services];
	}

	async findService(slug: string): Promise<CatalogService | null> {
		return this.#services.find((one) => one.slug === slug) ?? null;
	}

	async listOwners(): Promise<string[]> {
		// Domains as well as services: a domain may be owned by a team that runs nothing
		// directly, and a filter that omitted them would hide its domains.
		const owners = new Set([
			...this.#domains.map((one) => one.owner),
			...this.#services.map((one) => one.owner)
		]);

		return [...owners].sort((a, b) => a.localeCompare(b));
	}
}

/**
 * Parse catalog text into a source, or throw.
 *
 * `Bun.YAML.parse` reads JSON too, so a deployment that would rather generate JSON can,
 * and neither costs a dependency — tier 2 of the API selection order.
 *
 * A bad catalog **refuses to boot**, the same doctrine as the source resolver's
 * throw-on-unknown-name. Dropping the entries that failed to parse would leave a
 * dashboard quietly describing a smaller platform than the one that exists, and nothing
 * on the page would admit it.
 */
export function parseCatalog(text: string, path: string): FileCatalogSource {
	let document: unknown;

	try {
		document = Bun.YAML.parse(text);
	} catch (cause) {
		// The cause is kept: a YAML syntax error names the line, and without it an
		// operator is told only that their file is wrong somewhere. This is a config file
		// they wrote, read at their own boot — the same category as naming a missing path.
		throw new Error(
			`Catalog at ${path} is not valid YAML or JSON: ${cause instanceof Error ? cause.message : 'parse failed'}`,
			{ cause }
		);
	}

	const result = v.safeParse(catalogFileSchema, document);

	if (!result.success) {
		// The path of each offending key, never its value — the same rule the connection
		// loader follows, and a catalog may carry a URL with a token in its query string.
		const keys = [
			...new Set(
				result.issues.map(
					(issue) => (issue.path ?? []).map((segment) => String(segment.key)).join('.') || '(root)'
				)
			)
		].join(', ');

		throw new Error(`Catalog at ${path} is invalid: ${keys}`);
	}

	return new FileCatalogSource(buildCatalog(result.output));
}

/** Read and parse the catalog named by a path. */
export async function readCatalogFile(path: string): Promise<FileCatalogSource> {
	const file = Bun.file(path);

	if (!(await file.exists())) {
		throw new Error(`CATALOG_FILE points at ${path}, which does not exist.`);
	}

	return parseCatalog(await file.text(), path);
}
