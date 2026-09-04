import type { Capability, SourceKind, SourceRef } from '$lib/platform/sources';
import type { ProviderDefinition, SourceConnectionRef } from './provider';
import { loadConnections } from './connection';

/** One configured, connected instance of a provider. */
export interface ConnectedSource {
	readonly ref: SourceConnectionRef;
	readonly definition: ProviderDefinition<unknown>;
	/** Built once per connection; a real client holds a pool or an HTTP agent. */
	readonly client: unknown;
	readonly capabilities: ReadonlySet<Capability>;
	/** The provenance a panel prints, with whatever link suits the panel. */
	sourceRef(link: SourceRef['link']): SourceRef;
}

/**
 * Which providers exist, which connections are configured, and who can answer what.
 *
 * One instance, built at boot. Clients are created once per connection and reused: a
 * real adapter holds a connection pool or an HTTP agent, and building one per request is
 * how you exhaust both — the same reasoning the existing source resolver already applies.
 */
export class SourceRegistry {
	readonly #providers = new Map<string, ProviderDefinition<unknown>>();
	readonly #connections = new Map<string, ConnectedSource>();

	register(definition: ProviderDefinition<unknown>): void {
		if (this.#providers.has(definition.id)) {
			throw new Error(`Provider "${definition.id}" is already registered.`);
		}
		this.#providers.set(definition.id, definition);
	}

	providers(): Map<string, ProviderDefinition<unknown>> {
		return this.#providers;
	}

	/** Validate the config and connect everything in it, or throw. */
	load(raw: unknown, env: Record<string, string | undefined>): void {
		this.#connections.clear();

		for (const ref of loadConnections(raw, this.#providers, env)) {
			const definition = this.#providers.get(ref.providerId)!;

			this.#connections.set(ref.id, {
				ref,
				definition,
				client: definition.connect(ref.settings),
				capabilities: definition.capabilities,
				sourceRef: (link) => ({
					connectionId: ref.id,
					providerId: ref.providerId,
					kind: ref.kind,
					name: ref.label,
					icon: ref.icon,
					link
				})
			});
		}
	}

	/** Every connection, or only those of one kind, in configuration order. */
	connections(kind?: SourceKind): ConnectedSource[] {
		const all = [...this.#connections.values()];
		return kind ? all.filter((one) => one.ref.kind === kind) : all;
	}

	connection(id: string): ConnectedSource | null {
		return this.#connections.get(id) ?? null;
	}

	/**
	 * Connections that declare a capability.
	 *
	 * The index a router actually wants: "who can answer this", not "who exists". A
	 * connection of the right kind that does not implement the capability is no use to
	 * the caller and would otherwise have to be filtered at every call site.
	 */
	supporting(capability: Capability): ConnectedSource[] {
		return this.connections().filter((one) => one.capabilities.has(capability));
	}
}
