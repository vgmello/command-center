import * as v from 'valibot';
import { kindOf, type Capability, type SourceKind } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';

/** A connection as a provider sees it: identity plus its own validated settings. */
export interface SourceConnectionRef {
	id: string;
	providerId: string;
	kind: SourceKind;
	label: string;
	icon: string;
	settings: unknown;
}

/** What ties a resource in this app to a resource in a provider. */
export interface SourceBinding {
	kind: SourceKind;
	connectionId: string;
	externalId: string;
}

/**
 * Everything a provider needs to answer one call.
 *
 * `binding` is present for resource-scoped reads and absent for aggregates, which is
 * the only difference between the two dispatch rules as a provider experiences them.
 */
export interface SourceContext {
	scope: PlatformScope;
	connection: SourceConnectionRef;
	binding?: SourceBinding;
	/**
	 * An explicit window, overriding the one `scope.timeRange` implies.
	 *
	 * Present when the caller wants a *gap* rather than a whole range — the store already
	 * holds most of a chart's history, and re-fetching twenty-four hours of settled
	 * buckets to draw the newest one is the single largest waste against a rate limit.
	 *
	 * `stepSeconds` travels with it because the resolution has to be canonical: samples
	 * fetched at whatever step a query happened to ask for would not line up with samples
	 * already stored, and a fifteen-minute view and a twenty-four-hour view would share
	 * no rows at all.
	 */
	window?: { from: Date; to: Date; stepSeconds: number };
}

/** Which view of a resource a deep link should open. */
export type LinkView = 'overview' | 'metrics' | 'logs' | 'cost';

export interface ProviderDefinition<Client> {
	readonly id: string;
	readonly kind: SourceKind;
	readonly name: string;
	/** Icon key. A provider never hands a component to anything. */
	readonly icon: string;
	readonly capabilities: ReadonlySet<Capability>;
	/** What a connection must supply. Validated at boot, not on first read. */
	readonly settings: v.GenericSchema;
	/** Per-capability TTL in seconds, where the provider knows better than the default. */
	readonly ttl?: Partial<Record<Capability, number>>;
	connect(settings: unknown): Client;
}

interface ProviderInput<Client> extends Omit<ProviderDefinition<Client>, 'capabilities'> {
	readonly capabilities: readonly Capability[];
}

/** A set that prevents any mutations by throwing on mutation attempts. */
class FrozenSet<T> extends Set<T> {
	private _frozen = false;

	seal(): void {
		this._frozen = true;
	}

	add(value: T): this {
		if (this._frozen) {
			throw new TypeError('Cannot mutate a frozen set');
		}
		return super.add(value);
	}

	clear(): void {
		throw new TypeError('Cannot mutate a frozen set');
	}

	delete(_value: T): boolean {
		throw new TypeError('Cannot mutate a frozen set');
	}
}

/**
 * Build a provider definition, checking what a type cannot.
 *
 * The capability list is verified against the provider's own kind: a cloud provider
 * declaring `apm.slo` would sit in the cloud index answering a call no router will ever
 * send it, and nothing downstream would notice.
 */
export function defineProvider<Client>(input: ProviderInput<Client>): ProviderDefinition<Client> {
	for (const capability of input.capabilities) {
		if (kindOf(capability) !== input.kind) {
			throw new Error(
				`Provider "${input.id}" is of kind ${input.kind} but declares ${capability}.`
			);
		}
	}

	const frozen = new FrozenSet(input.capabilities);
	frozen.seal();

	return {
		...input,
		capabilities: frozen as ReadonlySet<Capability>
	};
}
