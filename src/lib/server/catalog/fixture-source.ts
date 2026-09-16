import type { CatalogDomain, CatalogService } from '$lib/platform/catalog';
import { listDomains } from '../platform/fixtures';
import { listServices } from '../platform/service-fixtures';
import { boundDomains } from '$lib/platform/ownership';
import type { CatalogSource } from './source';

/**
 * The catalog the app runs on with no configuration at all.
 *
 * Derived from the seeds the rest of the fixtures already use, rather than being a second
 * hand-written copy of the same eight services. When two fixtures describe one quantity,
 * one of them derives from the other; seeding both is how a dashboard ends up telling two
 * stories.
 *
 * It carries the declared half only. The readings the seeds also hold — status, instance
 * counts, error rates — are deliberately dropped here, because a catalog does not know
 * them and letting them through would make this implementation able to answer a question
 * the file and the database cannot.
 */
export class FixtureCatalogSource implements CatalogSource {
	readonly id = 'fixture';

	#domains(): CatalogDomain[] {
		return listDomains().map((domain) => ({
			id: domain.id,
			slug: domain.slug,
			name: domain.name,
			shortName: domain.shortName,
			icon: domain.icon,
			accent: domain.accent,
			criticality: domain.criticality,
			owner: domain.owner,
			// A cloud binding for every domain the ownership table assigns resources to, and
			// none for the rest: "unbound" has to be the common case under fixtures or the
			// stated-gap path is never exercised. The externalId is the tag VALUE.
			bindings: boundDomains('fixture').includes(domain.slug)
				? [{ kind: 'cloud', connectionId: '', externalId: domain.slug }]
				: []
		}));
	}

	#services(): CatalogService[] {
		return listServices().map((service) => ({
			id: service.id,
			slug: service.slug,
			name: service.name,
			description: service.description,
			domainId: service.domainId,
			owner: service.owner,
			serviceType: service.serviceType,
			language: service.language,
			runtime: service.runtime,
			icon: service.icon,
			accent: service.accent,
			repository: service.repository,
			chatChannel: service.chatChannel,
			runbook: service.runbook,
			dashboard: service.dashboard,
			// The seeds name each service the same way everywhere, so nothing is declared
			// and every lookup falls back to the slug.
			identity: {},
			bindings: []
		}));
	}

	async listDomains(): Promise<CatalogDomain[]> {
		return this.#domains();
	}

	async findDomain(slug: string): Promise<CatalogDomain | null> {
		return this.#domains().find((one) => one.slug === slug) ?? null;
	}

	async listServices(domainId?: string): Promise<CatalogService[]> {
		const all = this.#services();
		return domainId ? all.filter((one) => one.domainId === domainId) : all;
	}

	async findService(slug: string): Promise<CatalogService | null> {
		return this.#services().find((one) => one.slug === slug) ?? null;
	}

	async listOwners(): Promise<string[]> {
		const owners = new Set([
			...this.#domains().map((one) => one.owner),
			...this.#services().map((one) => one.owner)
		]);

		return [...owners].sort((a, b) => a.localeCompare(b));
	}
}
