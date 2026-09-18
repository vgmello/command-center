<script lang="ts">
	import RelativeTime from './RelativeTime.svelte';
	import SectionCard from './SectionCard.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import PanelGap from './PanelGap.svelte';
	import { SEVERITY_LABELS, severityTone } from './tone';
	import type { Panel } from '$lib/platform/sources';
	import type { Incident } from '$lib/platform/types';

	interface Props {
		/** A panel because not every deployment has an APM source that tracks incidents. */
		incidents: Panel<Incident[]>;
	}

	let { incidents }: Props = $props();

	const rows = $derived(incidents.status === 'ok' ? incidents.data : []);
</script>

<SectionCard title="Top Active Incidents" href="/alerts">
	<PanelGap panel={incidents} noun="incidents" class="px-4 pb-4" />
	<ul class="pb-2">
		{#each rows as incident (incident.id)}
			{@const tone = severityTone(incident.severity)}
			<li>
				<div class="flex items-start gap-2 px-4 py-[7px] transition-colors hover:bg-accent/40">
					<span class="mt-1.5 size-2 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-[11.5px] font-medium">{incident.title}</span>
						<span class="block truncate text-[10.5px] text-muted-foreground">
							{incident.domainName}
						</span>
					</span>
					<span class="flex shrink-0 items-center gap-1.5 pt-px">
						<StatusBadge label={SEVERITY_LABELS[incident.severity]} {tone} />
						<RelativeTime
							value={incident.openedAt}
							class="tabular w-[46px] text-right text-[10.5px] text-muted-foreground"
						/>
					</span>
				</div>
			</li>
		{/each}
	</ul>
</SectionCard>
