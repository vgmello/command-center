<script lang="ts">
	import PanelGap from '../PanelGap.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { statusTone } from '../tone';
	import { formatLatency } from '$lib/platform/format';
	import type { ServiceEndpoint } from '$lib/platform/types';
	import type { Panel } from '$lib/platform/sources';

	interface Props {
		endpoints: Panel<ServiceEndpoint[]>;
	}

	let { endpoints }: Props = $props();

	const rows = $derived(endpoints.status === 'ok' ? endpoints.data : []);
</script>

<SectionCard title="Top Endpoints">
	<PanelGap panel={endpoints} noun="endpoints" class="px-4 pb-4" />
	<div class="px-4 pb-4">
		<div class="flex items-center justify-between pb-1.5 text-[11px] text-muted-foreground">
			<span>Endpoint</span>
			<span>P95 Latency</span>
		</div>

		<ul>
			{#each rows as endpoint (endpoint.id)}
				{@const tone = statusTone(endpoint.status)}
				{@const latency = formatLatency(endpoint.p95LatencyMs)}
				<li class="flex items-center gap-3 border-t border-border/60 py-2">
					<span class="min-w-0 flex-1 truncate text-[12px]">
						<span class="tabular font-medium">{endpoint.method}</span>
						<span class="text-muted-foreground">{endpoint.path}</span>
					</span>
					<!--
						The bar is a share of the slowest endpoint, not of a total: the panel
						answers "which is worst", and shares of a sum shrink the worst one as
						soon as the list grows.
					-->
					<span class="h-1.5 w-[104px] shrink-0 overflow-hidden rounded-full bg-muted">
						<span
							class="block h-full rounded-full {tone.dot} transition-all duration-500"
							style="width:{endpoint.latencySharePct}%"
						></span>
					</span>
					<span class="tabular w-[62px] shrink-0 text-right text-[12px]">
						{latency.value}<span class="ml-0.5 text-muted-foreground">{latency.unit}</span>
					</span>
				</li>
			{/each}
		</ul>
	</div>
</SectionCard>
