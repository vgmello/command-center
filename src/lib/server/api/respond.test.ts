import { describe, expect, test } from 'bun:test';
import { errorResponse, NotFoundError } from './error-response';
import { CapabilityUnavailableError, SourceFailedError } from '../sources/errors';

describe('a capability nobody implements', () => {
	test('is 501, not 500 — nothing is broken and retrying will not help', async () => {
		const response = errorResponse(
			new CapabilityUnavailableError('apm.dependencies', 'no-capability')
		)!;

		expect(response.status).toBe(501);
	});

	test('names the capability, so a caller can stop asking for it', async () => {
		const response = errorResponse(
			new CapabilityUnavailableError('apm.dependencies', 'no-capability')
		)!;
		const body = (await response.json()) as Record<string, string>;

		expect(body.error).toBe('capability_unavailable');
		expect(body.capability).toBe('apm.dependencies');
		expect(body.kind).toBe('apm');
		expect(body.reason).toBe('no-capability');
	});

	test('distinguishes nothing connected from nothing capable', async () => {
		// "Configure a source" and "this source cannot do it" are different actions.
		const response = errorResponse(
			new CapabilityUnavailableError('cloud.regions', 'no-connection')
		)!;

		expect(((await response.json()) as Record<string, string>).reason).toBe('no-connection');
	});
});

describe('a source that did not answer', () => {
	test('is 502 — upstream failed, not us', async () => {
		const response = errorResponse(
			new SourceFailedError(
				'apm.metricSeries',
				{
					connectionId: 'cx',
					providerId: 'coralogix',
					kind: 'apm',
					name: 'Coralogix',
					icon: 'activity',
					link: null
				},
				new Error('timeout')
			)
		)!;

		expect(response.status).toBe(502);

		const body = (await response.json()) as Record<string, unknown>;
		expect(body.error).toBe('source_failed');
		expect((body.source as Record<string, string>).name).toBe('Coralogix');
	});

	test('never carries the upstream’s own error text', async () => {
		// A source error can quote the request, and a request is built from settings.
		const response = errorResponse(
			new SourceFailedError(
				'apm.metricSeries',
				{
					connectionId: 'cx',
					providerId: 'coralogix',
					kind: 'apm',
					name: 'Coralogix',
					icon: 'activity',
					link: null
				},
				new Error('token=secret-looking-value')
			)
		)!;

		expect(await response.text()).not.toContain('secret-looking-value');
	});
});

describe('the other outcomes still hold', () => {
	test('a missing resource is 404', async () => {
		const response = errorResponse(new NotFoundError('service called nope'))!;

		expect(response.status).toBe(404);
	});

	test('an error that is genuinely ours is not mapped, so it surfaces as a 500', () => {
		// A bug here must not be dressed up as somebody else's fault.
		expect(errorResponse(new Error('null is not an object'))).toBeNull();
	});
});
