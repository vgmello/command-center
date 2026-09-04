import {
	kindOf,
	type Capability,
	type GapReason,
	type SourceKind,
	type SourceRef
} from '$lib/platform/sources';

/**
 * Thrown when a read cannot be served at all.
 *
 * A sentinel rather than an empty return, for the same reason `NotFoundError` is one in
 * `api/respond.ts`: "there is nothing here" and "here is nothing" are different answers,
 * and only a thrown one can be told apart from a legitimately empty list.
 */
export class CapabilityUnavailableError extends Error {
	readonly kind: SourceKind;

	constructor(
		readonly capability: Capability,
		readonly reason: GapReason
	) {
		super(`No source for ${capability} (${reason}).`);
		this.name = 'CapabilityUnavailableError';
		this.kind = kindOf(capability);
	}
}

/** Thrown when a connection exists and implements the capability, but the call failed. */
export class SourceFailedError extends Error {
	readonly kind: SourceKind;

	constructor(
		readonly capability: Capability,
		readonly source: SourceRef,
		readonly sourceCause: unknown
	) {
		super(`${source.name} could not answer ${capability}.`);
		this.name = 'SourceFailedError';
		this.kind = kindOf(capability);
	}
}
