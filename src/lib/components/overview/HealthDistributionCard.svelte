<script lang="ts">
	import { donutSegments } from '$lib/platform/geometry';
	import { statusTone } from '../tone';
	import type { HealthDistribution } from '$lib/platform/types';

	interface Props {
		distribution: HealthDistribution;
	}

	let { distribution }: Props = $props();

	const size = 132;
	const thickness = 14;
	const radius = (size - thickness) / 2;

	const segments = $derived(donutSegments(distribution.slices, radius));
</script>

<section class="rounded-xl border border-border bg-card p-4">
	<h2 class="text-[14.5px] font-semibold tracking-tight">Health Distribution</h2>

	<div class="mt-3 flex items-center gap-5">
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
				<span class="tabular text-[24px] leading-none font-semibold">{distribution.total}</span>
				<span class="mt-1 text-[11px] text-muted-foreground">Total</span>
			</div>
		</div>

		<ul class="min-w-0 flex-1 space-y-2.5">
			{#each distribution.slices as slice (slice.status)}
				<li class="flex items-center gap-2 text-[12.5px]">
					<span
						class="size-2.5 shrink-0 rounded-full {statusTone(slice.status).dot}"
						aria-hidden="true"
					></span>
					<span class="tabular font-medium">{slice.count}</span>
					<span class="text-muted-foreground">{slice.label}</span>
					<span class="tabular ml-auto text-muted-foreground">{slice.percentage}%</span>
				</li>
			{/each}
		</ul>
	</div>
</section>
