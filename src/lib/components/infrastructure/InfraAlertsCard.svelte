<script lang="ts">
	import Icon from '../Icon.svelte';
	import RelativeTime from '../RelativeTime.svelte';
	import SectionCard from '../SectionCard.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { SEVERITY_LABELS, severityTone } from '../tone';
	import type { InfraAlert } from '$lib/platform/types';

	interface Props {
		alerts: InfraAlert[];
	}

	let { alerts }: Props = $props();

	const ICONS = { critical: 'circle-alert', warning: 'triangle-alert', info: 'info' } as const;
</script>

<SectionCard title="Recent Alerts" href="/alerts" viewAllLabel="View all alerts">
	<ul class="px-4 pb-3">
		{#each alerts as alert (alert.id)}
			{@const tone = severityTone(alert.severity)}
			<li class="flex items-start gap-2.5 border-t border-border/60 py-2 first:border-t-0">
				<span class="grid size-6 shrink-0 place-items-center rounded-md {tone.chip} border-0">
					<Icon name={ICONS[alert.severity]} size={13} strokeWidth={2.2} />
				</span>
				<span class="min-w-0 flex-1">
					<span class="flex flex-wrap items-center gap-1.5">
						<StatusBadge label={SEVERITY_LABELS[alert.severity]} {tone} />
						<span class="min-w-0 flex-1 truncate text-[12px] font-medium">{alert.title}</span>
					</span>
					<span class="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
						{alert.subject}
					</span>
				</span>
				<RelativeTime
					value={alert.raisedAt}
					class="tabular w-[48px] shrink-0 pt-0.5 text-right text-[10.5px] text-muted-foreground"
				/>
			</li>
		{:else}
			<li class="py-8 text-center text-[12px] text-muted-foreground">Nothing firing.</li>
		{/each}
	</ul>
</SectionCard>
