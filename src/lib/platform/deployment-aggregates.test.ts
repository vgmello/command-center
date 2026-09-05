import { describe, expect, test } from 'bun:test';
import {
	accentFor,
	breakDownByDomain,
	deployingDomains,
	statusTrendOf,
	summariseDeployments,
	trendsOf
} from './deployment-aggregates';
import type { Deployment, DeploymentStatus } from './types';

function make(
	overrides: Partial<Deployment> & { id: string; status: DeploymentStatus }
): Deployment {
	return {
		reference: `#${overrides.id}`,
		service: 'payment-api',
		version: '1.0.0',
		domainId: 'payments',
		domainName: 'Payments',
		icon: 'landmark',
		environment: 'production',
		trigger: 'ci-cd',
		deployedBy: 'build-pipeline',
		deployedAt: '2026-09-04T10:00:00.000Z',
		durationSeconds: 120,
		...overrides
	};
}

describe('summariseDeployments', () => {
	const current = [
		make({ id: '1', status: 'success', durationSeconds: 100 }),
		make({ id: '2', status: 'success', durationSeconds: 200 }),
		make({ id: '3', status: 'failed', durationSeconds: 300 }),
		make({ id: '4', status: 'in-progress', durationSeconds: null }),
		make({ id: '5', status: 'success', domainId: 'identity', domainName: 'Identity' })
	];

	test('counts each status and the domains involved', () => {
		const summary = summariseDeployments(current, []);

		expect(summary.total).toBe(5);
		expect(summary.successful).toBe(3);
		expect(summary.failed).toBe(1);
		expect(summary.inProgress).toBe(1);
		expect(summary.domainCount).toBe(2);
	});

	test('a running deployment has no duration and does not drag the mean to zero', () => {
		// 100, 200, 300 and the 120 default on #5 — the null is excluded, not counted.
		expect(summariseDeployments(current, []).meanDurationSeconds).toBe(180);
	});

	test('the failure rate is over finished runs, not over everything', () => {
		// 1 failed of 4 finished = 25%. Including the in-flight run would give 20% and
		// make the rate fall simply because a deploy happens to be running.
		expect(summariseDeployments(current, []).changeFailureRatePct).toBe(25);
	});

	test('reports change against the previous window', () => {
		const previous = [
			make({ id: 'p1', status: 'success', durationSeconds: 100 }),
			make({ id: 'p2', status: 'failed', durationSeconds: 100 })
		];

		const summary = summariseDeployments(current, previous);

		expect(summary.totalChangePct).toBe(150); // 2 -> 5
		expect(summary.meanDurationChangePct).toBe(80); // 100 -> 180
		expect(summary.changeFailureRateChangePct).toBe(-25); // 50% -> 25%
	});

	test('no baseline reports no change rather than an infinity', () => {
		const summary = summariseDeployments(current, []);

		expect(summary.totalChangePct).toBe(0);
		expect(Number.isFinite(summary.meanDurationChangePct)).toBe(true);
	});

	test('an empty window is all zeroes, not a division by zero', () => {
		const summary = summariseDeployments([], []);

		expect(summary.total).toBe(0);
		expect(summary.meanDurationSeconds).toBe(0);
		expect(summary.changeFailureRatePct).toBe(0);
	});

	test('a rollback counts against the failure rate alongside a failure', () => {
		const rolled = [make({ id: '1', status: 'success' }), make({ id: '2', status: 'rolled-back' })];

		expect(summariseDeployments(rolled, []).failed).toBe(1);
		expect(summariseDeployments(rolled, []).changeFailureRatePct).toBe(50);
	});
});

describe('breakDownByDomain', () => {
	const deployments = [
		make({ id: '1', status: 'success' }),
		make({ id: '2', status: 'success' }),
		make({ id: '3', status: 'success', domainId: 'identity', domainName: 'Identity' })
	];

	test('shares sum to the total and the percentages to 100', () => {
		const breakdown = breakDownByDomain(deployments);

		expect(breakdown.total).toBe(3);
		expect(breakdown.slices.reduce((sum, one) => sum + one.count, 0)).toBe(3);
		expect(Math.round(breakdown.slices.reduce((sum, one) => sum + one.percentage, 0))).toBe(100);
	});

	test('largest share first, so the legend reads in the order the donut does', () => {
		expect(breakDownByDomain(deployments).slices[0].domainId).toBe('payments');
	});

	test('an empty window is an empty breakdown, not a NaN percentage', () => {
		const breakdown = breakDownByDomain([]);

		expect(breakdown.total).toBe(0);
		expect(breakdown.slices).toEqual([]);
	});
});

describe('accentFor', () => {
	test('is stable for an id, so a domain does not change colour between renders', () => {
		expect(accentFor('payments')).toBe(accentFor('payments'));
	});

	test('is identity, not status — it depends only on the id', () => {
		const accents = new Set(['payments', 'identity', 'fulfilment', 'catalogue'].map(accentFor));
		expect(accents.size).toBeGreaterThan(1);
	});
});

describe('deployingDomains', () => {
	test('offers each domain with its count', () => {
		const options = deployingDomains([
			make({ id: '1', status: 'success' }),
			make({ id: '2', status: 'success', domainId: 'identity', domainName: 'Identity' })
		]);

		// Equal counts break alphabetically, so the list is stable between renders
		// rather than reflecting whichever row the upstream happened to return first.
		expect(options).toEqual([
			{ id: 'identity', label: 'Identity', count: 1 },
			{ id: 'payments', label: 'Payments', count: 1 }
		]);
	});
});

describe('trendsOf', () => {
	const from = new Date('2026-09-01T00:00:00.000Z');
	const to = new Date('2026-09-04T00:00:00.000Z');
	const deployments = [
		make({
			id: '1',
			status: 'success',
			deployedAt: '2026-09-01T09:00:00.000Z',
			durationSeconds: 60
		}),
		make({
			id: '2',
			status: 'success',
			deployedAt: '2026-09-01T15:00:00.000Z',
			durationSeconds: 120
		}),
		make({
			id: '3',
			status: 'failed',
			deployedAt: '2026-09-03T09:00:00.000Z',
			durationSeconds: 300
		})
	];

	test('a quiet day is a zero, not a missing bucket', () => {
		const { frequency } = trendsOf(deployments, 'daily', from, to);

		// 1, 2, 3, 4 September — the 2nd had no deployments and must still appear.
		expect(frequency.points.length).toBe(4);
		expect(frequency.points.map((one) => one.value)).toEqual([2, 0, 1, 0]);
	});

	test('both series share one x-axis, so they can be read side by side', () => {
		const { frequency, meanDuration } = trendsOf(deployments, 'daily', from, to);

		expect(meanDuration.points.map((one) => one.label)).toEqual(
			frequency.points.map((one) => one.label)
		);
	});

	test('the mean is over finished runs in that bucket', () => {
		const { meanDuration } = trendsOf(deployments, 'daily', from, to);
		expect(meanDuration.points[0].value).toBe(90);
	});

	test('a deployment outside the window is not counted', () => {
		const { frequency } = trendsOf(
			[
				...deployments,
				make({ id: 'x', status: 'success', deployedAt: '2025-01-01T00:00:00.000Z' })
			],
			'daily',
			from,
			to
		);

		expect(frequency.points.reduce((sum, one) => sum + one.value, 0)).toBe(3);
	});

	test('a bad timestamp is skipped rather than bucketed as NaN', () => {
		const { frequency } = trendsOf(
			[...deployments, make({ id: 'bad', status: 'success', deployedAt: 'not a date' })],
			'daily',
			from,
			to
		);

		expect(frequency.points.reduce((sum, one) => sum + one.value, 0)).toBe(3);
	});
});

describe('statusTrendOf', () => {
	const from = new Date('2026-09-01T00:00:00.000Z');
	const to = new Date('2026-09-02T00:00:00.000Z');

	test('one series per status, all on the same x-axis so they stack', () => {
		const series = statusTrendOf(
			[
				make({ id: '1', status: 'success', deployedAt: '2026-09-01T09:00:00.000Z' }),
				make({ id: '2', status: 'failed', deployedAt: '2026-09-01T10:00:00.000Z' })
			],
			'daily',
			from,
			to
		);

		expect(series.map((one) => one.id)).toEqual(['success', 'failed', 'in-progress']);
		const labels = series.map((one) => one.points.map((p) => p.label));
		expect(labels[0]).toEqual(labels[1]);
		expect(labels[1]).toEqual(labels[2]);
	});

	test('a rollback is counted as a failure', () => {
		const series = statusTrendOf(
			[make({ id: '1', status: 'rolled-back', deployedAt: '2026-09-01T09:00:00.000Z' })],
			'daily',
			from,
			to
		);

		const failed = series.find((one) => one.id === 'failed');
		expect(failed?.points[0].value).toBe(1);
	});
});
