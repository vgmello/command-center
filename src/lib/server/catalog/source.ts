import type { CatalogDomain, CatalogService } from '$lib/platform/catalog';

/**
 * Where the domains and services themselves come from.
 *
 * A fifth port, resolved from `CATALOG_SOURCE` the way `WorkspaceSource` is — **not**
 * through the router and dispatcher. Fan-out is wrong here: the dispatcher exists to ask
 * which connection owns a resource and to merge answers from several, while a catalog
 * answers "what is payment-api" and there is exactly one right answer. Routing it would
 * mean deciding what to do when two catalogs disagree about an owner, which is a question
 * with no good answer and one nobody asked.
 *
 * The file implementation is the first; a database is expected to replace it. Everything
 * about this interface is shaped so that swap is one class and one resolver entry:
 *
 * - it speaks in domain types, never rows or documents
 * - it carries no file, path, format or `reload()` — a reload is a file concept that a
 *   database would have to implement as a no-op
 * - it takes no `PlatformScope`, because a catalog describes what exists and whether
 *   something is running in staging is a reading
 * - ids are provider-assigned, so nothing above depends on their shape
 *
 * Every method is `async` even where the file resolves immediately, for the same reason
 * the data-source ports are: a synchronous port would have to be rewritten, along with
 * every caller, the first time real I/O appeared.
 *
 * Read-only on purpose. `createService` would be an editing surface designed against a
 * file that cannot implement it; that shape belongs with a real store and a real form.
 */
export interface CatalogSource {
	/** Which implementation answered. Surfaced in diagnostics, never in a payload. */
	readonly id: string;

	listDomains(): Promise<CatalogDomain[]>;
	findDomain(slug: string): Promise<CatalogDomain | null>;

	/**
	 * Every service, or every service in one domain.
	 *
	 * The one filter a catalog can genuinely answer, so the only one the port takes.
	 * Sorting and paging are absent deliberately: the domain table sorts by health score,
	 * which the catalog does not hold, so pushing that down is impossible in principle —
	 * and giving a database an interface it cannot honour is worse than not offering it.
	 */
	listServices(domainId?: string): Promise<CatalogService[]>;
	findService(slug: string): Promise<CatalogService | null>;

	/** Every distinct owner, for the filter's option list. */
	listOwners(): Promise<string[]>;
}
