<script lang="ts">
	import Icon from '../Icon.svelte';
	import PanelGap from '../PanelGap.svelte';
	import RelativeTime from '../RelativeTime.svelte';
	import { toneFor } from '../tone';
	import { formatDuration } from '$lib/platform/deployments';
	import type { Panel } from '$lib/platform/sources';
	import type { DomainDeploymentStats } from '$lib/platform/types';

	/**
	 * The four figures above a domain's deployment history.
	 *
	 * Every one of them is a fortnight's worth, which is why `windowLabel` is a required
	 * prop rather than a nicety: "34 deploys" is a different claim from "34 deploys in the
	 * last 14 days", and only one of them is true.
	 */

	interface Props {
		stats: Panel<DomainDeploymentStats>;
		/** What the counts cover, stated by the server — see `DomainDeploymentsSnapshot`. */
		windowLabel: string;
		/** When this domain last shipped, from the newest log row. `null` when it has not. */
		lastDeployedAt: string | null;
	}

	let { stats, windowLabel, lastDeployedAt }: Props = $props();

	const data = $derived(stats.status === 'ok' ? stats.data : null);

	// Any failure at all is worth a tint here. A domain's blended rate is small by
	// construction — one bad service in ten barely moves it — so a threshold would hide
	// exactly the case the table beneath this strip exists to surface.
	const failureTone = $derived(toneFor(data && data.failures > 0 ? 'down' : 'healthy'));
</script>

{#if !data}
	<div class="rounded-xl border border-border bg-card px-4 py-6">
		<PanelGap panel={stats} noun="deployment figures" />
	</div>
{:else}
	<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
		<article class="rounded-xl border border-border bg-card px-4 py-2.5">
			<p class="text-[12px] font-medium text-muted-foreground">Deployments</p>
			<div class="mt-1.5 flex items-center justify-between gap-2">
				<span class="tabular text-[26px] leading-none font-semibold">{data.total}</span>
				<span
					class="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
				>
					<Icon name="rocket" size={18} strokeWidth={1.9} />
				</span>
			</div>
			<p class="mt-2 text-[11.5px] text-muted-foreground">{windowLabel}</p>
		</article>

		<article class="rounded-xl border border-border bg-card px-4 py-2.5">
			<p class="text-[12px] font-medium text-muted-foreground">Change Failure Rate</p>
			<div class="mt-1.5 flex items-center justify-between gap-2">
				<span class="tabular text-[26px] leading-none font-semibold {failureTone.text}">
					{data.changeFailureRatePct.toFixed(1)}%
				</span>
				<span
					class="grid size-9 shrink-0 place-items-center rounded-lg border-0 {failureTone.chip}"
				>
					<Icon name="shield" size={18} strokeWidth={1.9} />
				</span>
			</div>
			<p class="tabular mt-2 text-[11.5px] text-muted-foreground">
				{data.failures} of {data.total} failed
			</p>
		</article>

		<article class="rounded-xl border border-border bg-card px-4 py-2.5">
			<p class="text-[12px] font-medium text-muted-foreground">Mean Deploy Time</p>
			<div class="mt-1.5 flex items-center justify-between gap-2">
				<span class="tabular text-[26px] leading-none font-semibold">
					{formatDuration(data.meanDurationSeconds)}
				</span>
				<span
					class="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
				>
					<Icon name="clock" size={18} strokeWidth={1.9} />
				</span>
			</div>
			<p class="mt-2 text-[11.5px] text-muted-foreground">Across runs that finished</p>
		</article>

		<article class="rounded-xl border border-border bg-card px-4 py-2.5">
			<p class="text-[12px] font-medium text-muted-foreground">Last Deployment</p>
			<div class="mt-1.5 flex items-center justify-between gap-2">
				<span class="tabular text-[26px] leading-none font-semibold">
					{#if lastDeployedAt}
						<RelativeTime value={lastDeployedAt} />
					{:else}
						—
					{/if}
				</span>
				<span
					class="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
				>
					<Icon name="calendar" size={18} strokeWidth={1.9} />
				</span>
			</div>
			<p class="mt-2 text-[11.5px] text-muted-foreground">
				{lastDeployedAt ? 'Newest run in the log' : 'Nothing in the log'}
			</p>
		</article>
	</div>
{/if}
