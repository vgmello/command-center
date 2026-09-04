import { kindOf, type Capability, type Panel, type SourceRef } from '$lib/platform/sources';
import { CapabilityUnavailableError, SourceFailedError } from './errors';

/**
 * Turn one source-backed read into a panel.
 *
 * This is the only place a thrown gap becomes a rendered state. Assemblers wrap each
 * source-backed read in it, so one provider failing degrades one panel rather than the
 * page — every other panel on the same screen was wrapped separately.
 *
 * Anything that is not a gap or a source failure propagates: a mapper bug must not be
 * quietly rendered as "no data".
 */
export async function panel<T>(
	capability: Capability,
	read: () => Promise<{ data: T; source: SourceRef; stale?: true }>
): Promise<Panel<T>> {
	try {
		const { data, source, stale } = await read();
		return stale ? { status: 'ok', data, source, stale } : { status: 'ok', data, source };
	} catch (cause) {
		if (cause instanceof CapabilityUnavailableError) {
			return {
				status: 'unavailable',
				capability: cause.capability,
				kind: cause.kind,
				reason: cause.reason
			};
		}

		if (cause instanceof SourceFailedError) {
			return {
				status: 'failed',
				capability: cause.capability,
				kind: cause.kind,
				source: cause.source
			};
		}

		throw cause;
	}
}

/** Re-exported so an assembler needs one import to build a panel. */
export { kindOf };
export type { Panel, SourceRef, Capability };
