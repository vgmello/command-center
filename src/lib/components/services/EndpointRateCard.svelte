<script lang="ts">
	import SectionCard from '../SectionCard.svelte';
	import { statusTone } from '../tone';
	import { formatLatency } from '$lib/platform/format';
	import type { ServiceEndpoint } from '$lib/platform/types';

	interface Props {
		endpoints: ServiceEndpoint[];
	}

	let { endpoints }: Props = $props();
</script>

<SectionCard
	title="Top Endpoints by Request Rate"
	href="/services"
	viewAllLabel="View all endpoints"
>
	<div class="px-4 pb-4">
		<div class="flex items-center gap-3 pb-1.5 text-[10.5px] text-muted-foreground">
			<span class="flex-1">Endpoint</span>
			<span class="w-[44px] text-right">req/s</span>
			<span class="w-[52px] text-right">% of total</span>
			<span class="w-[72px]"></span>
			<span class="w-[62px] text-right">P95 Latency</span>
		</div>

		<ul>
			{#each endpoints as endpoint (endpoint.id)}
				{@const tone = statusTone(endpoint.status)}
				{@const latency = formatLatency(endpoint.p95LatencyMs)}
				<li class="flex items-center gap-3 border-t border-border/60 py-2">
					<span class="min-w-0 flex-1 truncate text-[11.5px]">
						<span class="tabular font-medium">{endpoint.method}</span>
						<span class="text-muted-foreground">{endpoint.path}</span>
					</span>
					<span class="tabular w-[44px] shrink-0 text-right text-[11.5px]">
						{endpoint.requestsPerSecond}
					</span>
					<span class="tabular w-[52px] shrink-0 text-right text-[11.5px] text-muted-foreground">
						{endpoint.requestSharePct}%
					</span>
					<!--
						The bar is graded by latency, not by traffic: the table is already ordered
						by request rate, so a bar repeating that order would say nothing.
					-->
					<span class="h-1.5 w-[72px] shrink-0 overflow-hidden rounded-full bg-muted">
						<span
							class="block h-full rounded-full {tone.dot} transition-all duration-500"
							style="width:{endpoint.latencySharePct}%"
						></span>
					</span>
					<span class="tabular w-[62px] shrink-0 text-right text-[11.5px]">
						{latency.value}<span class="ml-0.5 text-muted-foreground">{latency.unit}</span>
					</span>
				</li>
			{/each}
		</ul>
	</div>
</SectionCard>
