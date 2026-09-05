import type { Criticality, DomainAccent, ExternalLink } from './types';

/**
 * What the catalog declares, as opposed to what the sources report.
 *
 * These are deliberately **not** `Domain` and `Service`. Those carry readings — a status,
 * an error rate, an instance count — that no catalog can produce, and a port returning
 * them would force every implementation to invent one. The file cannot know a health
 * status; neither can the database that replaces it. Keeping the declared half in its own
 * types makes that impossible to express, so the merge with live readings happens once,
 * above the port, rather than being fudged inside each implementation.
 */

/**
 * How a service is named in each connected source.
 *
 * Declared, not discovered: only a person knows that Octopus calls it `Payment API` while
 * Coralogix calls it `payment-api`. Absent means "the same as the slug", which is the
 * common case and not worth writing out.
 */
export interface SourceIdentity {
	apm?: string;
	deployment?: string;
	cloud?: string;
}

export interface CatalogDomain {
	id: string;
	slug: string;
	name: string;
	/**
	 * The name without its category suffix — "Payment", not "Payment Domain".
	 *
	 * Declared rather than derived by stripping the word: a domain is called what its
	 * owners call it, and a client that guesses gets it wrong the first time one is
	 * named "Domain Registry".
	 */
	shortName: string;
	icon: string;
	/** Identity tint. A property of the domain, like its name — never a reading. */
	accent: DomainAccent;
	criticality: Criticality;
	owner: string;
}

export interface CatalogService {
	id: string;
	slug: string;
	name: string;
	description: string;
	domainId: string;
	owner: string;
	/** What kind of thing it is — "API Gateway", "Worker". Free text. */
	serviceType: string;
	language: string;
	runtime: string;
	icon: string;
	accent: DomainAccent;
	/**
	 * Links, each of which may genuinely be absent.
	 *
	 * Nullable rather than an empty href: a catalog entry with no runbook recorded is a
	 * fact, and rendering it as a link to nowhere is the dead link this codebase refuses
	 * to ship. It also spares the database that replaces the file from inventing one for
	 * a null column.
	 */
	repository: ExternalLink | null;
	chatChannel: ExternalLink | null;
	runbook: ExternalLink | null;
	/** Observability console, if the catalog records one. */
	dashboard: ExternalLink | null;
	identity: SourceIdentity;
}

/** How a service is named in one source kind, falling back to its slug. */
export function identityFor(
	service: Pick<CatalogService, 'slug' | 'identity'>,
	kind: keyof SourceIdentity
): string {
	return service.identity[kind] ?? service.slug;
}
