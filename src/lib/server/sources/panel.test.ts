import { describe, expect, test } from 'bun:test';
import { CapabilityUnavailableError, SourceFailedError } from './errors';
import { panel } from './panel';
import type { SourceRef } from '$lib/platform/sources';

const ref: SourceRef = {
	connectionId: 'azure-prod',
	providerId: 'azure',
	kind: 'cloud',
	name: 'Azure — Production',
	icon: 'cloud',
	link: null
};

describe('panel', () => {
	test('a successful read carries its data and its provenance', async () => {
		const result = await panel('cloud.cost', async () => ({ data: 42, source: ref }));

		expect(result.status).toBe('ok');
		if (result.status !== 'ok') throw new Error('unreachable');
		expect(result.data).toBe(42);
		expect(result.source!.connectionId).toBe('azure-prod');
	});

	test('an unavailable capability becomes a stated gap, not an empty value', async () => {
		const result = await panel('cloud.cost', async () => {
			throw new CapabilityUnavailableError('cloud.cost', 'no-connection');
		});

		expect(result).toEqual({
			status: 'unavailable',
			capability: 'cloud.cost',
			kind: 'cloud',
			reason: 'no-connection'
		});
	});

	test('a failed read is distinct from an unavailable one', async () => {
		const result = await panel('cloud.cost', async () => {
			throw new SourceFailedError('cloud.cost', ref, new Error('timed out'));
		});

		expect(result.status).toBe('failed');
		if (result.status !== 'failed') throw new Error('unreachable');
		// The panel can still say who did not answer.
		expect(result.source!.name).toBe('Azure — Production');
	});

	test('an unexpected error is not swallowed', async () => {
		const boom = new TypeError('bug in the mapper');

		await expect(
			panel('cloud.cost', async () => {
				throw boom;
			})
		).rejects.toThrow('bug in the mapper');
	});

	test('a stale value is marked, not passed off as fresh', async () => {
		const result = await panel('cloud.cost', async () => ({
			data: 1,
			source: ref,
			stale: true as const
		}));

		expect(result.status === 'ok' && result.stale).toBe(true);
	});
});
