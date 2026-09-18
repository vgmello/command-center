import type { DeploymentStatus, DeploymentTrigger, EnvironmentId } from '$lib/platform/types';

/** The task states an Octopus server reports. Taken from its own Swagger enum. */
export type OctopusTaskState =
	'Queued' | 'Executing' | 'Failed' | 'Canceled' | 'TimedOut' | 'Success' | 'Cancelling';

/**
 * What an Octopus task state means to us.
 *
 * A cancelled or timed-out run is a failure: it did not deploy, and counting it as a
 * success would flatter the change-failure rate the summary reports. `Cancelling` is
 * still running, so it is in progress rather than already failed.
 *
 * **`rolled-back` is never returned.** Octopus has no such state — a rollback there is an
 * ordinary deployment of an earlier release, indistinguishable at this layer. Inferring
 * one from a version comparison would misreport a deliberate downgrade, and inferring it
 * from a name containing "rollback" would depend on a customer's naming convention.
 *
 * A missing task means the deployment was created and its task has not been read yet, so
 * it is in progress. Treating an absent task as a success would invent an outcome.
 */
export function statusOf(state: OctopusTaskState | undefined): DeploymentStatus {
	switch (state) {
		case 'Success':
			return 'success';
		case 'Failed':
		case 'TimedOut':
		case 'Canceled':
			return 'failed';
		default:
			return 'in-progress';
	}
}

const ENVIRONMENT_WORDS: ReadonlyArray<readonly [EnvironmentId, readonly string[]]> = [
	['production', ['production', 'prod', 'prd', 'live']],
	['staging', ['staging', 'stage', 'stg', 'uat', 'qa']],
	['development', ['development', 'dev', 'test']]
];

/**
 * Place a free-text Octopus environment name in our fixed set.
 *
 * Octopus environments are whatever an instance called them — `Production`, `Prod`,
 * `PRD`. Matching on a substring of the normalised name covers the spellings a real
 * instance uses without demanding one.
 *
 * A name that matches nothing returns `null` rather than a default: filing a deployment
 * under a scope it may not belong to is worse than leaving it out, because the reader
 * cannot tell the difference.
 */
export function normaliseEnvironmentName(name: string): EnvironmentId | null {
	const cleaned = name.toLowerCase().replace(/[^a-z0-9]/g, '');
	if (!cleaned) return null;

	for (const [id, words] of ENVIRONMENT_WORDS) {
		if (words.some((word) => cleaned.includes(word))) return id;
	}

	return null;
}

/**
 * Which of our environments an Octopus environment id belongs to.
 *
 * The connection's explicit map wins, because no normaliser survives contact with every
 * customer's naming and an operator must be able to state the answer outright.
 */
export function environmentOf(
	environmentId: string,
	names: ReadonlyMap<string, string>,
	overrides: Readonly<Record<string, EnvironmentId>>
): EnvironmentId | null {
	const override = overrides[environmentId];
	if (override) return override;

	const name = names.get(environmentId);
	return name ? normaliseEnvironmentName(name) : null;
}

/**
 * What kind of thing ran this deployment.
 *
 * Octopus records *who*, not *what kind*: a user account is someone clicking deploy, and
 * anything else — a service account, a runbook, an automated process — is a pipeline.
 * `gitops` and `rollback` are never returned, because the API carries nothing that
 * distinguishes them and a guessed label is worse than a coarse one.
 */
export function triggerOf(deployedById: string | undefined): DeploymentTrigger {
	return deployedById?.startsWith('Users-') ? 'manual' : 'ci-cd';
}

/**
 * How long a finished run took, in whole seconds.
 *
 * `null` while it is still going, and `null` for a completion that precedes its start —
 * a clock skew between server nodes should not produce a negative duration that then
 * drags a mean below zero.
 */
export function durationSeconds(
	startTime: string | undefined,
	completedTime: string | undefined
): number | null {
	if (!startTime || !completedTime) return null;

	const started = Date.parse(startTime);
	const completed = Date.parse(completedTime);
	if (Number.isNaN(started) || Number.isNaN(completed) || completed < started) return null;

	return Math.round((completed - started) / 1000);
}

/**
 * `Deployments-17892` reads as `#17892`, which is how an operator says it aloud.
 *
 * Only a numeric tail is stripped. Splitting on the last dash unconditionally would turn
 * an id that is not shaped this way into a fragment of itself — `odd-id` becoming `#id` —
 * and a reference that silently loses half its identity is worse than a verbose one.
 */
export function deploymentReference(id: string): string {
	return `#${/-(\d+)$/.exec(id)?.[1] ?? id}`;
}
