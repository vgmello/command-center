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

const envReferenceSchema = v.strictObject({ $env: v.pipe(v.string(), v.minLength(1)) });

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

/**
 * Turn a valibot issue's `path` into a dotted string.
 *
 * Used only to name the failing key — never the value, which is what carries the
 * secret. `'(root)'` covers the case where the schema itself is not an object.
 */
function pathOf(issue: { path?: readonly { key?: unknown }[] }): string {
	if (!issue.path || issue.path.length === 0) return '(root)';
	return issue.path.map((segment) => String(segment.key)).join('.');
}

/** Parse, resolve and validate every connection, or refuse to start. */
export function loadConnections(
	raw: unknown,
	providers: Map<string, ProviderDefinition<unknown>>,
	env: Record<string, string | undefined>
): SourceConnectionRef[] {
	const file = v.parse(connectionFileSchema, raw);
	const seen = new Set<string>();

	const loaded: SourceConnectionRef[] = file.connections.map((entry) => {
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

		const result = v.safeParse(definition.settings, resolveSecrets(entry.settings, env));
		if (!result.success) {
			// The issues carry the received value verbatim, and a resolved setting is a
			// secret — so the keys travel and the values never do.
			const keys = [...new Set(result.issues.map((issue) => pathOf(issue)))].join(', ');
			throw new Error(`Connection "${entry.id}" has invalid settings: ${keys}.`);
		}

		return {
			id: entry.id,
			providerId: definition.id,
			kind: definition.kind,
			label: entry.label,
			// The connection inherits the provider's icon: a connection is an instance of
			// a provider, and two Azure subscriptions should not be drawn differently.
			icon: definition.icon,
			settings: result.output
		};
	});

	refuseMixedFixtures(loaded, providers);

	return loaded;
}

/**
 * A synthetic provider may be the only connection of its kind.
 *
 * Two connections of one kind is a supported arrangement — two Azure subscriptions, two
 * Octopus spaces — and the aggregate rule concatenates their answers deliberately. That is
 * exactly what makes mixing a fixture in dangerous: the estate would be real regions plus
 * invented ones, merged, with nothing on the page admitting it and every total wrong.
 *
 * Refused at boot rather than rendered, for the same reason the resolver throws on an
 * unknown source name. A misconfiguration that shows plausible numbers is worse than one
 * that will not start.
 */
function refuseMixedFixtures(
	loaded: SourceConnectionRef[],
	providers: ReadonlyMap<string, ProviderDefinition<unknown>>
): void {
	const synthetic = (ref: SourceConnectionRef) => providers.get(ref.providerId)?.synthetic === true;

	for (const ref of loaded.filter(synthetic)) {
		const others = loaded.filter((one) => one.kind === ref.kind && one.id !== ref.id);
		if (others.length === 0) continue;

		throw new Error(
			`Connection "${ref.id}" invents its data, so it must be the only ${ref.kind} source. ` +
				`Also connected: ${others.map((one) => `"${one.id}"`).join(', ')}. ` +
				`Remove one — a fixture beside a real source merges invented rows into real ones.`
		);
	}
}
