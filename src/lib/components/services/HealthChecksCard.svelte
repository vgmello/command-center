<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import Sparkline from '../Sparkline.svelte';
	import { statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import type { HealthCheck } from '$lib/platform/types';

	interface Props {
		checks: HealthCheck[];
	}

	let { checks }: Props = $props();
</script>

<SectionCard title="Service Health">
	{#snippet icon()}
		<Icon name="shield" size={15} />
	{/snippet}

	<table class="w-full">
		<thead>
			<tr class="text-[11px] text-muted-foreground">
				<th class="px-4 pb-1.5 text-left font-medium">Check</th>
				<th class="w-[92px] pb-1.5 text-left font-medium">Status</th>
				<th class="w-[76px] pb-1.5 text-left font-medium">Last 15m</th>
				<th class="w-[72px] px-4 pb-1.5 text-right font-medium">Value</th>
			</tr>
		</thead>
		<tbody>
			{#each checks as check (check.id)}
				{@const tone = statusTone(check.status)}
				<tr class="border-t border-border/60">
					<td class="px-4 py-[7px]">
						<span class="flex items-center gap-2">
							<span class="{tone.text} shrink-0"><Icon name={check.icon} size={14} /></span>
							<span class="truncate text-[12.5px]">{check.label}</span>
						</span>
					</td>
					<td class="py-[7px]">
						<span class="flex items-center gap-1.5 text-[12px] {tone.text}">
							<span class="size-2 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
							{STATUS_LABELS[check.status]}
						</span>
					</td>
					<td class="py-[7px]">
						<Sparkline
							series={check.series}
							width={62}
							height={18}
							stroke={tone.stroke}
							class="h-[18px] w-[62px]"
						/>
					</td>
					<td class="tabular px-4 py-[7px] text-right text-[12.5px] whitespace-nowrap">
						{check.formatted}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</SectionCard>
