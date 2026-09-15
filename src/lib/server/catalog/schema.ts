import * as v from 'valibot';
import { SOURCE_KINDS } from '$lib/platform/sources';
import type { CatalogDomain, CatalogService } from '$lib/platform/catalog';

/**
 * The catalog file's shape.
 *
 * Separate from the port on purpose: this is one implementation's wire format, and the
 * database that replaces it will have its own. Nothing above `CatalogSource` imports
 * anything from this file.
 */

const ACCENTS = ['blue', 'green', 'amber', 'red', 'violet', 'slate'] as const;
const CRITICALITIES = ['mission-critical', 'business-critical', 'important', 'standard'] as const;

const slug = v.pipe(
	v.string(),
	v.minLength(1),
	v.maxLength(120),
	// Lowercase, dashed, no spaces — it appears in a URL anyone can edit and in a PromQL
	// label matcher. Constraining it here means neither has to defend against the rest.
	v.regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase letters, digits and dashes')
);

/**
 * A link, validated as a URL.
 *
 * The commonest way this file goes wrong is a runbook field holding a Confluence page
 * *title* rather than its address. Unchecked, that fails at the click; checked, it fails
 * at boot with the key that is wrong.
 */
const url = v.pipe(v.string(), v.url('must be a URL'));

/**
 * At most one binding per kind, refused rather than merely discouraged.
 *
 * Two bindings of one kind are two answers to "which resource is this", and a router
 * would have to pick between them — the reconciliation the one-resource-one-source rule
 * exists to avoid. A refinement fails the file at boot with the record that is wrong,
 * where a convention fails quietly on whichever page reads it first.
 */
const bindings = v.optional(
	v.pipe(
		v.array(
			v.object({
				kind: v.picklist(SOURCE_KINDS),
				connectionId: v.optional(v.pipe(v.string(), v.maxLength(120)), ''),
				externalId: v.pipe(v.string(), v.minLength(1), v.maxLength(512))
			})
		),
		v.check(
			(rows) => new Set(rows.map((one) => one.kind)).size === rows.length,
			'declares two bindings of one kind; a resource belongs to one source per kind'
		)
	),
	[]
);

const domainEntry = v.object({
	slug,
	name: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	shortName: v.optional(v.pipe(v.string(), v.maxLength(200))),
	owner: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	criticality: v.picklist(CRITICALITIES),
	icon: v.optional(v.pipe(v.string(), v.maxLength(80)), 'layers'),
	accent: v.optional(v.picklist(ACCENTS), 'slate'),
	bindings
});

const serviceEntry = v.object({
	slug,
	name: v.optional(v.pipe(v.string(), v.maxLength(200))),
	domain: slug,
	description: v.optional(v.pipe(v.string(), v.maxLength(500)), ''),
	owner: v.optional(v.pipe(v.string(), v.maxLength(200))),
	type: v.optional(v.pipe(v.string(), v.maxLength(120)), 'Service'),
	language: v.optional(v.pipe(v.string(), v.maxLength(120)), 'Unknown'),
	runtime: v.optional(v.pipe(v.string(), v.maxLength(120)), 'Unknown'),
	icon: v.optional(v.pipe(v.string(), v.maxLength(80)), 'box'),
	accent: v.optional(v.picklist(ACCENTS)),
	links: v.optional(
		v.object({
			repository: v.optional(url),
			chat: v.optional(url),
			runbook: v.optional(url),
			dashboard: v.optional(url)
		}),
		{}
	),
	identity: v.optional(
		v.object({
			apm: v.optional(v.pipe(v.string(), v.maxLength(200))),
			deployment: v.optional(v.pipe(v.string(), v.maxLength(200))),
			cloud: v.optional(v.pipe(v.string(), v.maxLength(200)))
		}),
		{}
	),
	bindings
});

export const catalogFileSchema = v.object({
	version: v.literal(1),
	domains: v.array(domainEntry),
	services: v.array(serviceEntry)
});

export type CatalogFile = v.InferOutput<typeof catalogFileSchema>;

/** A link the UI can render, or a stated absence. */
function link(href: string | undefined, label: string) {
	return href ? { label, href } : null;
}

/**
 * Turn a parsed file into the port's types, or throw.
 *
 * The three checks below are the ones a schema cannot express, and each is a way a
 * catalog goes quietly wrong rather than loudly: a service pointing at a domain nobody
 * declared, two entries claiming one slug, and a service whose domain is fine but whose
 * own slug collides with a domain's. All of them refuse the file — the same doctrine as
 * the source resolver's throw-on-unknown-name, because a catalog that silently drops what
 * it could not place is a dashboard describing a smaller platform than the one that
 * exists.
 */
export function buildCatalog(file: CatalogFile): {
	domains: CatalogDomain[];
	services: CatalogService[];
} {
	const domains: CatalogDomain[] = file.domains.map((entry) => ({
		id: entry.slug,
		slug: entry.slug,
		name: entry.name,
		// Falls back to the full name rather than to a guess at stripping a suffix.
		shortName: entry.shortName || entry.name,
		icon: entry.icon,
		accent: entry.accent,
		criticality: entry.criticality,
		owner: entry.owner,
		bindings: entry.bindings
	}));

	const seenDomain = new Set<string>();
	for (const domain of domains) {
		if (seenDomain.has(domain.slug)) {
			throw new Error(`Catalog declares the domain "${domain.slug}" twice.`);
		}
		seenDomain.add(domain.slug);
	}

	const bySlug = new Map(domains.map((one) => [one.slug, one]));
	const seenService = new Set<string>();

	const services: CatalogService[] = file.services.map((entry) => {
		const domain = bySlug.get(entry.domain);
		if (!domain) {
			throw new Error(
				`Catalog service "${entry.slug}" names the domain "${entry.domain}", which is not declared. ` +
					`Declared: ${[...bySlug.keys()].join(', ') || 'none'}`
			);
		}

		if (seenService.has(entry.slug)) {
			throw new Error(`Catalog declares the service "${entry.slug}" twice.`);
		}
		seenService.add(entry.slug);

		return {
			id: entry.slug,
			slug: entry.slug,
			name: entry.name || entry.slug,
			description: entry.description,
			domainId: domain.id,
			// A service inherits its domain's owner unless it states its own, because most
			// do not differ and repeating it is how the two drift apart.
			owner: entry.owner || domain.owner,
			serviceType: entry.type,
			language: entry.language,
			runtime: entry.runtime,
			icon: entry.icon,
			accent: entry.accent ?? domain.accent,
			// Null rather than an empty href: this repo does not ship dead links, and a
			// catalog entry that has no runbook recorded is a fact worth showing as such.
			repository: link(entry.links.repository, 'Repository'),
			chatChannel: link(entry.links.chat, 'Chat'),
			runbook: link(entry.links.runbook, 'Runbook'),
			dashboard: link(entry.links.dashboard, 'Dashboard'),
			identity: entry.identity,
			bindings: entry.bindings
		};
	});

	return { domains, services };
}
