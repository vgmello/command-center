<script lang="ts">
	import SectionCard from '../SectionCard.svelte';
	import { donutSegments } from '$lib/platform/geometry';
	import { statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import type { ClusterLoad, HealthStatus, NodeCounts } from '$lib/platform/types';

	interface Props {
		nodes: NodeCounts;
		clusters: ClusterLoad[];
	}

	let { nodes, clusters }: Props = $props();

	const size = 116;
	const thickness = 13;
	const radius = (size - thickness) / 2;

	const total = $derived(nodes.healthy + nodes.warning + nodes.down);

	/*
	 * "Warning" is the estate's word for a degraded node, so the legend prints it while
	 * the tone still comes from the shared status vocabulary. The label is domain
	 * language; the colour is not the domain's to choose.
	 */
	const rows = $derived(
		[
			{ status: 'healthy' as HealthStatus, label: 'Healthy', count: nodes.healthy },
			{ status: 'degraded' as HealthStatus, label: 'Warning', count: nodes.warning },
			{ status: 'down' as HealthStatus, label: 'Down', count: nodes.down }
		].map((row) => ({
			...row,
			percentage: total === 0 ? 0 : Math.round((row.count / total) * 100)
		}))
	);

	const segments = $derived(donutSegments(rows, radius));
</script>

<SectionCard
	title="Compute Overview"
	href="/infrastructure/compute"
	viewAllLabel="View all clusters"
>
	<div class="grid gap-5 px-4 pb-4 lg:grid-cols-[1fr_1fr]">
		<div class="flex items-center gap-4">
			<div class="relative shrink-0" style="width:{size}px;height:{size}px">
				<svg viewBox="0 0 {size} {size}" width={size} height={size} class="-rotate-90">
					<circle
						cx={size / 2}
						cy={size / 2}
						r={radius}
						fill="none"
						stroke-width={thickness}
						class="stroke-muted"
					/>
					{#each segments as segment (segment.status)}
						<circle
							cx={size / 2}
							cy={size / 2}
							r={radius}
							fill="none"
							stroke-width={thickness}
							stroke-linecap="butt"
							stroke-dasharray="{segment.dashLength} {segment.dashGap}"
							stroke-dashoffset={segment.dashOffset}
							class="{statusTone(segment.status).stroke} transition-all duration-500"
						>
							<title>{segment.label}: {segment.count} ({segment.percentage}%)</title>
						</circle>
					{/each}
				</svg>
				<div class="absolute inset-0 flex flex-col items-center justify-center">
					<span class="tabular text-[22px] leading-none font-semibold">{total}</span>
					<span class="mt-1 text-[10px] text-muted-foreground">Total Nodes</span>
				</div>
			</div>

			<ul class="min-w-0 flex-1 space-y-2">
				{#each rows as row (row.status)}
					<li class="flex items-center gap-2 text-[12px]">
						<span
							class="size-2 shrink-0 rounded-full {statusTone(row.status).dot}"
							aria-hidden="true"
						></span>
						<span class="text-muted-foreground">{row.label}</span>
						<span class="tabular ml-auto font-medium">{row.count}</span>
						<span class="tabular w-[38px] text-right text-muted-foreground">{row.percentage}%</span>
					</li>
				{/each}
			</ul>
		</div>

		<div class="min-w-0">
			<p class="pb-2 text-[12px] font-medium">Top Clusters by CPU</p>
			<ul class="space-y-2.5">
				{#each clusters as cluster (cluster.id)}
					{@const tone = statusTone(cluster.status)}
					<li class="flex items-center gap-2.5">
						<span class="min-w-0 flex-1 truncate text-[11.5px]" title={cluster.name}>
							{cluster.name}
						</span>
						<span class="h-1.5 w-[92px] shrink-0 overflow-hidden rounded-full bg-muted">
							<span
								class="block h-full rounded-full {tone.dot} transition-all duration-500"
								style="width:{cluster.cpuPct}%"
							></span>
						</span>
						<span class="tabular w-[34px] shrink-0 text-right text-[11.5px]">
							{cluster.cpuPct}%
						</span>
					</li>
				{/each}
			</ul>
			<p class="sr-only">{STATUS_LABELS.healthy} clusters are under 70% CPU.</p>
		</div>
	</div>
</SectionCard>
