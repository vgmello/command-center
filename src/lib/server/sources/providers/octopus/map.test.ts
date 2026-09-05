import { describe, expect, test } from 'bun:test';
import {
	deploymentReference,
	durationSeconds,
	environmentOf,
	normaliseEnvironmentName,
	statusOf,
	triggerOf
} from './map';

describe('statusOf', () => {
	test('maps every Octopus task state, so none falls through to a default', () => {
		expect(statusOf('Success')).toBe('success');
		expect(statusOf('Failed')).toBe('failed');
		expect(statusOf('TimedOut')).toBe('failed');
		expect(statusOf('Canceled')).toBe('failed');
		expect(statusOf('Queued')).toBe('in-progress');
		expect(statusOf('Executing')).toBe('in-progress');
		expect(statusOf('Cancelling')).toBe('in-progress');
	});

	test('a cancelled run is a failure, not a success', () => {
		// Counting it as success would flatter the change-failure rate.
		expect(statusOf('Canceled')).not.toBe('success');
	});

	test('never reports rolled-back, because Octopus has no such state', () => {
		const states = [
			'Success',
			'Failed',
			'TimedOut',
			'Canceled',
			'Queued',
			'Executing',
			'Cancelling'
		] as const;

		for (const state of states) {
			expect(statusOf(state), state).not.toBe('rolled-back');
		}
	});

	test('a task that is missing entirely is still running, not silently successful', () => {
		expect(statusOf(undefined)).toBe('in-progress');
	});
});

describe('normaliseEnvironmentName', () => {
	test('matches the spellings a real instance uses', () => {
		expect(normaliseEnvironmentName('Production')).toBe('production');
		expect(normaliseEnvironmentName('Prod')).toBe('production');
		expect(normaliseEnvironmentName('PRD ')).toBe('production');
		expect(normaliseEnvironmentName('Live')).toBe('production');
		expect(normaliseEnvironmentName('Staging')).toBe('staging');
		expect(normaliseEnvironmentName('UAT')).toBe('staging');
		expect(normaliseEnvironmentName('QA')).toBe('staging');
		expect(normaliseEnvironmentName('Development')).toBe('development');
		expect(normaliseEnvironmentName('Dev')).toBe('development');
		expect(normaliseEnvironmentName('Test')).toBe('development');
	});

	test('strips punctuation and case rather than demanding an exact spelling', () => {
		expect(normaliseEnvironmentName('  pre-PRODUCTION ')).toBe('production');
	});

	test('returns null for a name it cannot place, rather than guessing', () => {
		// A guess would file a deployment under a scope it may not belong to.
		expect(normaliseEnvironmentName('Sandbox')).toBeNull();
		expect(normaliseEnvironmentName('')).toBeNull();
	});
});

describe('environmentOf', () => {
	const names = new Map([
		['Environments-1', 'Production'],
		['Environments-9', 'Sandbox']
	]);

	test('an explicit override wins over the normaliser', () => {
		expect(environmentOf('Environments-9', names, { 'Environments-9': 'staging' })).toBe('staging');
	});

	test('falls back to the name when no override is configured', () => {
		expect(environmentOf('Environments-1', names, {})).toBe('production');
	});

	test('an unplaceable environment is null, so its rows can be dropped', () => {
		expect(environmentOf('Environments-9', names, {})).toBeNull();
	});

	test('an id the instance never returned is null rather than a crash', () => {
		expect(environmentOf('Environments-404', names, {})).toBeNull();
	});
});

describe('triggerOf', () => {
	test('a user account is a manual deployment', () => {
		expect(triggerOf('Users-42')).toBe('manual');
	});

	test('anything else is automated', () => {
		expect(triggerOf('ServiceAccounts-3')).toBe('ci-cd');
		expect(triggerOf(undefined)).toBe('ci-cd');
	});

	test('never reports gitops or rollback, which the API cannot distinguish', () => {
		for (const id of ['Users-1', 'ServiceAccounts-1', undefined]) {
			expect(['manual', 'ci-cd']).toContain(triggerOf(id));
		}
	});
});

describe('durationSeconds', () => {
	test('measures the finished run in whole seconds', () => {
		expect(durationSeconds('2026-09-04T10:00:00.000Z', '2026-09-04T10:02:30.000Z')).toBe(150);
	});

	test('a run still going has no duration, and is not zero', () => {
		// Zero would sort and average as though it were instantaneous.
		expect(durationSeconds('2026-09-04T10:00:00.000Z', undefined)).toBeNull();
		expect(durationSeconds(undefined, undefined)).toBeNull();
	});

	test('a completion before its start is null rather than negative', () => {
		expect(durationSeconds('2026-09-04T10:02:00.000Z', '2026-09-04T10:00:00.000Z')).toBeNull();
	});
});

describe('deploymentReference', () => {
	test('prints the id tail the way an operator reads it', () => {
		expect(deploymentReference('Deployments-17892')).toBe('#17892');
	});

	test('falls back to the whole id when it has no numeric tail', () => {
		expect(deploymentReference('odd-id')).toBe('#odd-id');
	});
});
