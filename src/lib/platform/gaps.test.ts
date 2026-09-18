import { describe, expect, test } from 'bun:test';
import { collapseUnbound, gapSentence } from './gaps';
import type { Panel } from './sources';

import type { GapReason, SourceRef } from './sources';
// Check `SourceRef`'s exact fields in src/lib/platform/sources.ts:60-70 first; the literal must satisfy the type without a cast.
const source: SourceRef = {
	connectionId: 'x',
	name: 'x',
	providerId: 'x',
	kind: 'cloud',
	icon: 'cloud',
	link: null
};
const gap = (reason: GapReason): Panel<unknown> => ({
	status: 'unavailable',
	capability: 'cloud.nodes',
	kind: 'cloud',
	reason
});
const ok: Panel<unknown> = { status: 'ok', data: 1, source };

describe('gapSentence', () => {
	test("the two configuration reasons keep today's wording", () => {
		for (const r of ['no-connection', 'no-capability'] as const) {
			expect(gapSentence(r, 'cloud', 'regions')).toBe(
				'No connected cloud source provides regions.'
			);
		}
	});
	test('an unbuilt narrowing is not "no connected source" — the estate answers the same read', () => {
		const sentence = gapSentence('not-implemented', 'cloud', 'queues');
		expect(sentence).not.toContain('No connected');
		expect(sentence).toBe(
			'Narrowing queues to one domain is not implemented for cloud sources yet.'
		);
	});
	test('an unbound domain is not "no connected source" — the cloud is connected', () => {
		expect(gapSentence('no-binding', 'cloud', 'regions')).toBe(
			'Not bound to a cloud — no resources are tagged for this domain.'
		);
	});
	test('several connections need a named binding', () => {
		expect(gapSentence('ambiguous-connection', 'cloud', 'regions')).toBe(
			"Several cloud connections are configured; this domain's binding must name one."
		);
	});
	test('APM reads as "APM", matching the component\'s existing label table', () => {
		expect(gapSentence('no-connection', 'apm', 'incidents')).toBe(
			'No connected APM source provides incidents.'
		);
	});
});

describe('collapseUnbound', () => {
	test('seven no-binding gaps collapse', () => {
		expect(collapseUnbound(Array(7).fill(gap('no-binding')))).toBe(true);
	});
	test('six ok and one capability gap do not', () => {
		expect(collapseUnbound([...Array(6).fill(ok), gap('no-capability')])).toBe(false);
	});
	test('mixed reasons never collapse', () => {
		expect(collapseUnbound([...Array(6).fill(gap('no-binding')), gap('no-capability')])).toBe(
			false
		);
	});
	test('an empty list is not unbound', () => {
		expect(collapseUnbound([])).toBe(false);
	});
});
