import * as v from 'valibot';
import type { ProviderDefinition, SourceConnectionRef } from './provider';

/**
 * The shape of the connections file.
 *
 * Settings are `unknown` here and validated a second time against the provider's own
 * schema, because only the provider knows what it needs. Validating both at boot means a
 * missing subscription id stops startup rather than surfacing as an empty panel later.
 */
export const connectionFileSchema = v.object({
	connections: v.array(
		v.object({
			id: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
			provider: v.pipe(v.string(), v.minLength(1)),
			label: v.pipe(v.string(), v.minLength(1)),
			settings: v.record(v.string(), v.unknown())
		})
	)
});

const envReferenceSchema = v.object({ $env: v.pipe(v.string(), v.minLength(1)) });

/**
 * Replace `{ "$env": "NAME" }` with the environment's value.
 *
 * Credentials are referenced rather than inlined so the connections file stays
 * reviewable and committable while the secret lives in the environment. A reference to
 * a variable nobody set is an error, not an empty string — an empty credential fails
 * later, further from its cause.
 */
export function resolveSecrets(
	settings: unknown,
	env: Record<string, string | undefined>
): unknown {
	if (Array.isArray(settings)) return settings.map((one) => resolveSecrets(one, env));
	if (settings === null || typeof settings !== 'object') return settings;

	const reference = v.safeParse(envReferenceSchema, settings);
	if (reference.success) {
		const value = env[reference.output.$env];
		if (value === undefined || value === '') {
			throw new Error(`Connection setting references ${reference.output.$env}, which is not set.`);
		}
		return value;
	}

	return Object.fromEntries(
		Object.entries(settings as Record<string, unknown>).map(([key, value]) => [
			key,
			resolveSecrets(value, env)
		])
	);
}

/** Parse, resolve and validate every connection, or refuse to start. */
export function loadConnections(
	raw: unknown,
	providers: Map<string, ProviderDefinition<unknown>>,
	env: Record<string, string | undefined>
): SourceConnectionRef[] {
	const file = v.parse(connectionFileSchema, raw);
	const seen = new Set<string>();

	return file.connections.map((entry) => {
		if (seen.has(entry.id)) {
			throw new Error(`Two connections share the id "${entry.id}".`);
		}
		seen.add(entry.id);

		const definition = providers.get(entry.provider);
		if (!definition) {
			throw new Error(
				`Connection "${entry.id}" names provider "${entry.provider}", which is not registered. ` +
					`Available: ${[...providers.keys()].join(', ') || 'none'}`
			);
		}

		return {
			id: entry.id,
			providerId: definition.id,
			kind: definition.kind,
			label: entry.label,
			// The connection inherits the provider's icon: a connection is an instance of
			// a provider, and two Azure subscriptions should not be drawn differently.
			icon: definition.icon,
			settings: v.parse(definition.settings, resolveSecrets(entry.settings, env))
		};
	});
}
