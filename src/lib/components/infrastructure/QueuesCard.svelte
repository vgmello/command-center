<script lang="ts">
	import SectionCard from '../SectionCard.svelte';
	import { statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import type { MessageQueue } from '$lib/platform/types';

	interface Props {
		queues: MessageQueue[];
	}

	let { queues }: Props = $props();
</script>

<SectionCard
	title="Messaging Overview"
	href="/infrastructure/messaging"
	viewAllLabel="View all queues"
>
	<div class="overflow-x-auto px-4 pb-4">
		<table class="w-full">
			<thead>
				<tr class="text-[11px] text-muted-foreground">
					<th class="pb-1.5 text-left font-medium">Queue</th>
					<th class="pb-1.5 text-left font-medium">Type</th>
					<th class="pr-4 pb-1.5 text-right font-medium">Messages</th>
					<th class="pb-1.5 text-left font-medium">Status</th>
					<th class="pb-1.5 text-right font-medium">Lag</th>
				</tr>
			</thead>
			<tbody>
				{#each queues as queue (queue.id)}
					{@const tone = statusTone(queue.status)}
					<tr class="border-t border-border/60">
						<td class="py-[7px] text-[12.5px] whitespace-nowrap">{queue.name}</td>
						<td class="py-[7px] text-[12.5px] whitespace-nowrap text-muted-foreground">
							{queue.kind}
						</td>
						<td class="tabular py-[7px] pr-4 text-right text-[12.5px]">
							{queue.messages.toLocaleString('en-US')}
						</td>
						<td class="py-[7px]">
							<span class="flex items-center gap-1.5 text-[12px] {tone.text}">
								<span class="size-2 shrink-0 rounded-full {tone.dot}" aria-hidden="true"></span>
								{STATUS_LABELS[queue.status]}
							</span>
						</td>
						<!-- Lag is only worth colouring when it is the reason for the status. -->
						<td
							class="tabular py-[7px] text-right text-[12.5px] {queue.status === 'healthy'
								? ''
								: tone.text}"
						>
							{queue.lag.toLocaleString('en-US')}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</SectionCard>
