<script lang="ts">
	import PanelGap from '../PanelGap.svelte';
	import RelativeTime from '../RelativeTime.svelte';
	import SectionCard from '../SectionCard.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { SEVERITY_LABELS, severityTone } from '../tone';
	import type { Incident } from '$lib/platform/types';
	import type { Panel } from '$lib/platform/sources';

	interface Props {
		/** A panel because not every domain has an APM source that tracks incidents. */
		issues: Panel<Incident[]>;
	}

	let { issues }: Props = $props();

	const rows = $derived(issues.status === 'ok' ? issues.data : []);
</script>

<SectionCard title="Top Issues" href="/alerts" viewAllLabel="View all issues">
	<PanelGap panel={issues} noun="issues" class="px-4 pb-3" />
	<ul class="px-4 pb-3">
		{#each rows as issue (issue.id)}
			{@const tone = severityTone(issue.severity)}
			<li class="flex items-center gap-2.5 border-t border-border/60 py-2.5 first:border-t-0">
				<span class="size-2 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
				<span class="min-w-0 flex-1 truncate text-[12.5px]">{issue.title}</span>
				<StatusBadge label={SEVERITY_LABELS[issue.severity]} {tone} />
				<RelativeTime
					value={issue.openedAt}
					class="tabular w-[50px] shrink-0 text-right text-[11px] text-muted-foreground"
				/>
			</li>
		{:else}
			{#if issues.status === 'ok'}
				<li class="py-8 text-center text-[12px] text-muted-foreground">
					Nothing open against this domain.
				</li>
			{/if}
		{/each}
	</ul>
</SectionCard>
