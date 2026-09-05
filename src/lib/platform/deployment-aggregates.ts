import type {
	Deployment,
	DeploymentSummary,
	DomainBreakdown,
	DomainAccent,
	FacetOption,
	TimeSeries,
	TrendGrain
} from './types';

/**
 * Aggregates derived from a window of deployments.
 *
 * Pure, and shared by every deployment adapter rather than reimplemented in each. A
 * provider that computed its own change-failure rate would eventually compute it
 * differently from the next one, and the two would disagree on the same screen.
 *
 * Every function takes the window it is given and the clock as an argument. Nothing here
 * fetches, and nothing calls `new Date()`.
 */

const ACCENTS: readonly DomainAccent[] = ['blue', 'green', 'amber', 'red', 'violet', 'slate'];

/**
 * A stable tint for a domain the upstream has no opinion about.
 *
 * Identity, not status: a domain's colour must not move when its health does, and it must
 * not move between renders either — so it is derived from the id rather than assigned in
 * the order rows happened to arrive.
 */
export function accentFor(domainId: string): DomainAccent {
	let hash = 0;
	for (let index = 0; index < domainId.length; index++) {
		hash = (hash * 31 + domainId.charCodeAt(index)) >>> 0;
	}
	return ACCENTS[hash % ACCENTS.length];
}

function meanOf(values: number[]): number {
	if (values.length === 0) return 0;
	return values.reduce((total, one) => total + one, 0) / values.length;
}

/** Signed percentage change, and 0 when there is no baseline to compare against. */
function changePct(current: number, previous: number): number {
	if (previous === 0) return 0;
	return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Summarise a window, against the window of equal length before it.
 *
 * The comparison period is the whole point of the change figures: "mean duration up 12%"
 * is only meaningful against a stated baseline, so the caller passes both windows rather
 * than the summary inventing one.
 */
export function summariseDeployments(
	current: Deployment[],
	previous: Deployment[]
): DeploymentSummary {
	const successful = current.filter((one) => one.status === 'success').length;
	const inProgress = current.filter((one) => one.status === 'in-progress').length;
	const failed = current.filter(
		(one) => one.status === 'failed' || one.status === 'rolled-back'
	).length;

	// Only finished runs have a duration, and only they should shape the mean — a run
	// still going has no length, and counting it as zero would drag the average down.
	const durations = current
		.map((one) => one.durationSeconds)
		.filter((seconds): seconds is number => seconds !== null);
	const previousDurations = previous
		.map((one) => one.durationSeconds)
		.filter((seconds): seconds is number => seconds !== null);

	// The rate is over runs that finished: counting in-flight runs in the denominator
	// would make the failure rate fall simply because a deploy is running right now.
	const finished = successful + failed;
	const previousFinished = previous.filter((one) => one.status !== 'in-progress').length;
	const previousFailed = previous.filter(
		(one) => one.status === 'failed' || one.status === 'rolled-back'
	).length;

	const failureRate = finished === 0 ? 0 : (failed / finished) * 100;
	const previousRate = previousFinished === 0 ? 0 : (previousFailed / previousFinished) * 100;

	return {
		total: current.length,
		domainCount: new Set(current.map((one) => one.domainId)).size,
		successful,
		inProgress,
		failed,
		meanDurationSeconds: Math.round(meanOf(durations)),
		changeFailureRatePct: Math.round(failureRate * 10) / 10,
		meanDurationChangePct: changePct(meanOf(durations), meanOf(previousDurations)),
		changeFailureRateChangePct: Math.round((failureRate - previousRate) * 10) / 10,
		totalChangePct: changePct(current.length, previous.length)
	};
}

/** How the window's deployments divide between domains, largest share first. */
export function breakDownByDomain(deployments: Deployment[]): DomainBreakdown {
	const counts = new Map<string, { label: string; count: number }>();

	for (const deployment of deployments) {
		const existing = counts.get(deployment.domainId);
		if (existing) existing.count++;
		else counts.set(deployment.domainId, { label: deployment.domainName, count: 1 });
	}

	const total = deployments.length;
	const slices = [...counts.entries()]
		.map(([domainId, { label, count }]) => ({
			domainId,
			label,
			accent: accentFor(domainId),
			count,
			percentage: total === 0 ? 0 : Math.round((count / total) * 1000) / 10
		}))
		.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

	return { total, slices };
}

/** Which domains deployed in the window, as filter options with their counts. */
export function deployingDomains(deployments: Deployment[]): FacetOption[] {
	const { slices } = breakDownByDomain(deployments);
	return slices.map((slice) => ({ id: slice.domainId, label: slice.label, count: slice.count }));
}

/** The bucket a date belongs to, and the label a reader sees on the axis. */
function bucketOf(date: Date, grain: TrendGrain): { key: string; label: string } {
	if (grain === 'monthly') {
		const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
		return { key, label: date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) };
	}

	if (grain === 'weekly') {
		// Monday-anchored, so a week's bucket does not shift with the day it is read on.
		const monday = new Date(date);
		monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
		const key = monday.toISOString().slice(0, 10);
		return {
			key,
			label: monday.toLocaleDateString('en-GB', {
				day: 'numeric',
				month: 'short',
				timeZone: 'UTC'
			})
		};
	}

	const key = date.toISOString().slice(0, 10);
	return {
		key,
		label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
	};
}

/** Every bucket between two dates, so a quiet day is a zero rather than a gap. */
function bucketsBetween(from: Date, to: Date, grain: TrendGrain): { key: string; label: string }[] {
	const step = grain === 'monthly' ? 28 : grain === 'weekly' ? 7 : 1;
	const seen = new Map<string, string>();

	for (let at = new Date(from); at <= to; at.setUTCDate(at.getUTCDate() + step)) {
		const bucket = bucketOf(at, grain);
		seen.set(bucket.key, bucket.label);
	}

	// The end of the range is always a bucket, even when the step overshoots it.
	const last = bucketOf(to, grain);
	seen.set(last.key, last.label);

	return [...seen].map(([key, label]) => ({ key, label }));
}

function seriesOf(
	id: string,
	label: string,
	points: { label: string; value: number }[]
): TimeSeries {
	const values = points.map((one) => one.value);
	return {
		id,
		label,
		points,
		min: 0,
		max: values.length ? Math.max(...values) : 0
	};
}

/**
 * How many ran, and how long they took, per bucket.
 *
 * A bucket with no finished run reports a mean of zero rather than being dropped: the
 * frequency and duration series are read side by side, and two series with different
 * x-axes cannot be.
 */
export function trendsOf(
	deployments: Deployment[],
	grain: TrendGrain,
	from: Date,
	to: Date
): { frequency: TimeSeries; meanDuration: TimeSeries } {
	const buckets = bucketsBetween(from, to, grain);
	const counts = new Map(buckets.map((one) => [one.key, 0]));
	const durations = new Map<string, number[]>(buckets.map((one) => [one.key, []]));

	for (const deployment of deployments) {
		const at = new Date(deployment.deployedAt);
		if (Number.isNaN(at.getTime())) continue;

		const { key } = bucketOf(at, grain);
		if (!counts.has(key)) continue;

		counts.set(key, (counts.get(key) ?? 0) + 1);
		if (deployment.durationSeconds !== null) durations.get(key)?.push(deployment.durationSeconds);
	}

	return {
		frequency: seriesOf(
			'frequency',
			'Deployments',
			buckets.map((one) => ({ label: one.label, value: counts.get(one.key) ?? 0 }))
		),
		meanDuration: seriesOf(
			'mean-duration',
			'Mean duration',
			buckets.map((one) => ({
				label: one.label,
				value: Math.round(meanOf(durations.get(one.key) ?? []))
			}))
		)
	};
}

/** One series per status, sharing an x-axis so they can be stacked. */
export function statusTrendOf(
	deployments: Deployment[],
	grain: TrendGrain,
	from: Date,
	to: Date
): TimeSeries[] {
	const buckets = bucketsBetween(from, to, grain);
	const statuses = ['success', 'failed', 'in-progress'] as const;
	const labels: Record<(typeof statuses)[number], string> = {
		success: 'Successful',
		failed: 'Failed',
		'in-progress': 'In progress'
	};

	const counts = new Map(
		statuses.map((status) => [status, new Map(buckets.map((one) => [one.key, 0]))])
	);

	for (const deployment of deployments) {
		const at = new Date(deployment.deployedAt);
		if (Number.isNaN(at.getTime())) continue;

		// A rollback counts as a failure here: the trend answers "did our deploys work",
		// and a rollback is the clearest possible no.
		const status = deployment.status === 'rolled-back' ? 'failed' : deployment.status;
		const { key } = bucketOf(at, grain);
		const bucket = counts.get(status);
		if (bucket?.has(key)) bucket.set(key, (bucket.get(key) ?? 0) + 1);
	}

	return statuses.map((status) =>
		seriesOf(
			status,
			labels[status],
			buckets.map((one) => ({ label: one.label, value: counts.get(status)?.get(one.key) ?? 0 }))
		)
	);
}
