<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import PanelGap from '../PanelGap.svelte';
	import { statusTone } from '../tone';
	import type { Panel } from '$lib/platform/sources';
	import type { InfrastructureGroup } from '$lib/platform/types';

	interface Props {
		/**
		 * A panel, and the reason this whole mechanism earned itself: the estate's groups
		 * are one read spanning four capabilities, so a source that reports nodes but not
		 * queues used to cost the reader the entire dashboard rather than this one tile.
		 */
		groups: Panel<InfrastructureGroup[]>;
	}

	let { groups }: Props = $props();

	const rows = $derived(groups.status === 'ok' ? groups.data : []);
</script>

<SectionCard title="Infrastructure Summary" href="/infrastructure">
	<PanelGap panel={groups} noun="an infrastructure inventory" class="px-4 pb-4" />
	<div class="grid grid-cols-4 gap-1.5 px-4 pb-4">
		{#each rows as group (group.id)}
			<div class="min-w-0">
				<div class="flex items-center gap-1 text-muted-foreground">
					<span class="text-primary"><Icon name={group.icon} size={13} strokeWidth={1.9} /></span>
					<span class="truncate text-[11px]">{group.label}</span>
				</div>
				<p class="tabular mt-2 text-[19px] leading-none font-semibold">{group.count}</p>
				<p class="mt-1.5 text-[11px] {statusTone(group.status).text}">{group.statusLabel}</p>
			</div>
		{/each}
	</div>
</SectionCard>
