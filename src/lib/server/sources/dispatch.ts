import { kindOf, type Capability, type SourceRef } from '$lib/platform/sources';
import type { PlatformScope } from '$lib/platform/query';
import { CapabilityUnavailableError, SourceFailedError } from './errors';
import type { ConnectedSource, SourceRegistry } from './registry';
import type { LinkView, SourceBinding, SourceContext } from './provider';

interface Call<T> {
	capability: Capability;
	scope: PlatformScope;
	/** Which view a link from this panel should open. Defaults to the overview. */
	view?: LinkView;
	call: (client: unknown, ctx: SourceContext) => Promise<T>;
}

interface OneCall<T> extends Call<T> {
	binding: SourceBinding | undefined;
}

export interface Dispatcher {
	/**
	 * Resource-scoped: route to the connection the binding names.
	 *
	 * Implemented and tested here, and adopted when bindings land on the catalog
	 * records (spec increment 6). Until then the routers fan out, because dispatching
	 * on a placeholder binding would be routing on a guess.
	 */
	one<T>(options: OneCall<T>): Promise<{ data: T; source: SourceRef }>;
	/** Aggregate: fan out across every capable connection and concatenate. */
	all<T>(options: Call<T>): Promise<{ data: T[]; source: SourceRef }>;
}

/**
 * The two dispatch rules, and deliberately no third.
 *
 * Nothing merges two connections' answers to the same question. That is what "each
 * resource belongs to one source" bought: no reconciliation, and no arbitrating which
 * of two answers is right.
 */
export function createDispatcher(registry: SourceRegistry): Dispatcher {
	const refOf = (connection: ConnectedSource, binding: SourceBinding | undefined, view: LinkView) =>
		connection.sourceRef(
			(
				connection.client as {
					resourceLink?: (b: SourceBinding | undefined, v: LinkView) => SourceRef['link'];
				}
			).resourceLink?.(binding, view) ?? null
		);

	async function invoke<T>(
		connection: ConnectedSource,
		options: Call<T>,
		binding: SourceBinding | undefined
	): Promise<T> {
		const ctx: SourceContext = { scope: options.scope, connection: connection.ref, binding };

		try {
			return await options.call(connection.client, ctx);
		} catch (cause) {
			throw new SourceFailedError(
				options.capability,
				refOf(connection, binding, options.view ?? 'overview'),
				cause
			);
		}
	}

	return {
		async one<T>(options: OneCall<T>) {
			const { capability, binding } = options;

			if (!binding) {
				throw new CapabilityUnavailableError(capability, 'no-binding');
			}

			const connection = registry.connection(binding.connectionId);
			if (!connection || connection.ref.kind !== kindOf(capability)) {
				throw new CapabilityUnavailableError(capability, 'no-connection');
			}

			if (!connection.capabilities.has(capability)) {
				throw new CapabilityUnavailableError(capability, 'no-capability');
			}

			return {
				data: await invoke(connection, options, binding),
				source: refOf(connection, binding, options.view ?? 'overview')
			};
		},

		async all<T>(options: Call<T>) {
			const connections = registry.supporting(options.capability);

			if (connections.length === 0) {
				// Distinguishing "nobody is connected" from "nobody implements it" tells a
				// reader whether to add a connection or a different provider.
				const anyOfKind = registry.connections(kindOf(options.capability)).length > 0;
				throw new CapabilityUnavailableError(
					options.capability,
					anyOfKind ? 'no-capability' : 'no-connection'
				);
			}

			const settled = await Promise.allSettled(
				connections.map((connection) => invoke(connection, options, undefined))
			);

			const answered = settled.flatMap((result, index) =>
				result.status === 'fulfilled'
					? [{ value: result.value, connection: connections[index] }]
					: []
			);

			if (answered.length === 0) {
				// Everyone failed. Report the first failure rather than an empty estate,
				// which would read as "you have no regions".
				throw (settled[0] as PromiseRejectedResult).reason;
			}

			return {
				data: answered.flatMap((one) => one.value),
				// The first connection that answered stands for the panel. With several
				// sources a panel names one console to open; picking the first that
				// answered is arbitrary but stable, and never names one that failed.
				source: refOf(answered[0].connection, undefined, options.view ?? 'overview')
			};
		}
	};
}
