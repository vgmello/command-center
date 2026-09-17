<script lang="ts">
	import PanelGap from '../PanelGap.svelte';
	import type { Panel } from '$lib/platform/sources';
	import SectionCard from '../SectionCard.svelte';
	import WorldMap from './WorldMap.svelte';
	import { STATUS_LABELS } from '$lib/platform/health';
	import { statusTone } from '../tone';
	import type { InfraRegion } from '$lib/platform/types';

	interface Props {
		regions: Panel<InfraRegion[]>;
		title?: string;
	}

	let { regions, title = 'Infrastructure Health' }: Props = $props();

	const rows = $derived(regions.status === 'ok' ? regions.data : []);
</script>

<SectionCard {title}>
	<PanelGap panel={regions} noun="a region inventory" class="px-4 pb-4" />
	<div class="grid gap-4 px-4 pb-4 lg:grid-cols-[1.4fr_1fr]">
		<div class="min-w-0 self-center">
			<WorldMap regions={rows} />
		</div>

		<div class="min-w-0">
			<div class="flex items-center justify-between pb-1.5 text-[11px] text-muted-foreground">
				<span>Region</span>
				<span>Health</span>
			</div>
			<ul>
				{#each rows as region (region.id)}
					{@const tone = statusTone(region.status)}
					<li class="flex items-center justify-between gap-3 border-t border-border/60 py-[7px]">
						<span class="tabular min-w-0 truncate text-[12.5px]">{region.name}</span>
						<span class="flex shrink-0 items-center gap-1.5 text-[12px] {tone.text}">
							<span class="size-2 rounded-full {tone.dot}" aria-hidden="true"></span>
							{STATUS_LABELS[region.status]}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</SectionCard>
