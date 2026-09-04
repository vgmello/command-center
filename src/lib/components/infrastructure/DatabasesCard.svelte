<script lang="ts">
	import SectionCard from '../SectionCard.svelte';
	import { statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import type { DatabaseInstance } from '$lib/platform/types';

	interface Props {
		databases: DatabaseInstance[];
	}

	let { databases }: Props = $props();
</script>

<SectionCard
	title="Database Overview"
	href="/infrastructure/databases"
	viewAllLabel="View all databases"
>
	<div class="overflow-x-auto px-4 pb-4">
		<table class="w-full">
			<thead>
				<tr class="text-[11px] text-muted-foreground">
					<th class="pb-1.5 text-left font-medium">Database</th>
					<th class="pb-1.5 text-left font-medium">Engine</th>
					<th class="pb-1.5 text-left font-medium">Status</th>
					<th class="pb-1.5 text-right font-medium">CPU</th>
					<th class="pb-1.5 text-right font-medium">Connections</th>
					<th class="pb-1.5 text-right font-medium">Storage</th>
				</tr>
			</thead>
			<tbody>
				{#each databases as database (database.id)}
					{@const tone = statusTone(database.status)}
					<tr class="border-t border-border/60">
						<td class="py-[7px] text-[12.5px] whitespace-nowrap">{database.name}</td>
						<td class="py-[7px] text-[12.5px] whitespace-nowrap text-muted-foreground">
							{database.engine}
						</td>
						<td class="py-[7px]">
							<span class="flex items-center gap-1.5 text-[12px] {tone.text}">
								<span class="size-2 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
								{STATUS_LABELS[database.status]}
							</span>
						</td>
						<td class="tabular py-[7px] text-right text-[12.5px]">{database.cpuPct}%</td>
						<td class="tabular py-[7px] text-right text-[12.5px] whitespace-nowrap">
							{database.connections} / {database.connectionLimit}
						</td>
						<td class="tabular py-[7px] text-right text-[12.5px] whitespace-nowrap">
							{database.storageFormatted}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</SectionCard>
