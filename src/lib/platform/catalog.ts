import type { SourceKind } from './sources';
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

/**
 * Which resource in a provider a catalog record corresponds to.
 *
 * Declared by the catalog rather than inferred on the source: a rule that claimed
 * resources by tag or naming convention silently claims the wrong ones or drops the right
 * ones, and the failure is invisible — the page simply shows less than it should and
 * nothing says why. An explicit binding is reviewable in a diff.
 *
 * `externalId` is whatever that provider addresses the resource by: an ARM resource id,
 * an Octopus project id, the label an APM source groups by.
 */
export interface CatalogBinding {
	kind: SourceKind;
	/** Which connection owns it. Empty means "whichever connection of this kind answers". */
	connectionId: string;
	externalId: string;
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
	/**
	 * At most one per kind.
	 *
	 * Two bindings of one kind would be two answers to "which resource is this", and the
	 * router would have to pick — which is the reconciliation the one-resource-one-source
	 * rule exists to avoid. The catalog schema refuses it rather than leaving it to
	 * convention.
	 */
	bindings: CatalogBinding[];
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
	/** At most one per kind, for the same reason a domain's are. */
	bindings: CatalogBinding[];
}

/** How a service is named in one source kind, falling back to its slug. */
export function identityFor(
	service: Pick<CatalogService, 'slug' | 'identity'> & { bindings?: CatalogBinding[] },
	kind: keyof SourceIdentity
): string {
	// A binding wins over `identity`, which is the same statement without a connection:
	// both name the resource, and the fuller one should not be overridden by the shorter.
	const bound = service.bindings?.find((one) => one.kind === kind);

	return bound?.externalId ?? service.identity[kind] ?? service.slug;
}

/**
 * The binding a router dispatches on, for a record that may not declare one.
 *
 * `connectionId` is empty when the catalog does not say which connection owns the
 * resource, and that is a legitimate answer rather than a missing one: with a single
 * connection of a kind there is nothing to choose between, and demanding the id would make
 * every catalog entry carry a fact only a multi-source deployment needs.
 */
export function bindingFor(
	record: { slug: string; identity?: SourceIdentity; bindings?: CatalogBinding[] },
	kind: SourceKind
): CatalogBinding {
	const declared = record.bindings?.find((one) => one.kind === kind);
	if (declared) return declared;

	return {
		kind,
		connectionId: '',
		externalId: record.identity?.[kind] ?? record.slug
	};
}
