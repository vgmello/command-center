import { describe, expect, test } from 'bun:test';
import { gapSentence } from '$lib/platform/gaps';
import type { Panel } from '$lib/platform/sources';
import { errorResponse, NotFoundError, requirePanel } from './error-response';
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

	test('the message is the same sentence the page prints', async () => {
		// One sentence on the page and on the wire — `gapSentence` is the single source,
		// so this pins the wording via the function rather than a copy of its output.
		const response = errorResponse(
			new CapabilityUnavailableError('apm.dependencies', 'no-capability')
		)!;
		const body = (await response.json()) as Record<string, string>;

		expect(body.message).toBe(gapSentence('no-capability', 'apm', 'apm.dependencies'));
	});

	test('an unbound domain gets its own sentence, not "no connected source"', async () => {
		const response = errorResponse(new CapabilityUnavailableError('cloud.regions', 'no-binding'))!;
		const body = (await response.json()) as Record<string, string>;

		expect(body.reason).toBe('no-binding');
		expect(body.message).toBe(gapSentence('no-binding', 'cloud', 'cloud.regions'));
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

describe('unwrapping a panel for the public API', () => {
	test('a resolved panel gives back its data', () => {
		const panel: Panel<number> = { status: 'ok', data: 42 };

		expect(requirePanel(panel)).toBe(42);
	});

	test('an unavailable panel becomes a CapabilityUnavailableError, which maps to 501', () => {
		const panel: Panel<number> = {
			status: 'unavailable',
			capability: 'apm.domainVitals',
			kind: 'apm',
			reason: 'no-capability'
		};

		expect(() => requirePanel(panel)).toThrow(CapabilityUnavailableError);

		try {
			requirePanel(panel);
		} catch (cause) {
			expect(errorResponse(cause)!.status).toBe(501);
		}
	});

	test('a failed panel becomes a SourceFailedError, which maps to 502', () => {
		const panel: Panel<number> = {
			status: 'failed',
			capability: 'deployment.serviceTrends',
			kind: 'deployment',
			source: {
				connectionId: 'cx',
				providerId: 'octopus',
				kind: 'deployment',
				name: 'Octopus',
				icon: 'rocket',
				link: null
			}
		};

		expect(() => requirePanel(panel)).toThrow(SourceFailedError);

		try {
			requirePanel(panel);
		} catch (cause) {
			expect(errorResponse(cause)!.status).toBe(502);
		}
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
