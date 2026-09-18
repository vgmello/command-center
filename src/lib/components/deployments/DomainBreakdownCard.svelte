<script lang="ts">
	import SectionCard from '../SectionCard.svelte';
	import { donutSegments } from '$lib/platform/geometry';
	import { accentStroke, accentDot } from '../tone';
	import type { DomainBreakdown } from '$lib/platform/types';

	interface Props {
		breakdown: DomainBreakdown;
	}

	let { breakdown }: Props = $props();

	const size = 124;
	const thickness = 13;
	const radius = (size - thickness) / 2;

	/*
	 * `donutSegments` was written against the health distribution's slices, and this
	 * needs the same arc maths over a different shape. Mapping into that shape here
	 * keeps one implementation of the geometry rather than two that drift.
	 */
	const segments = $derived(
		donutSegments(
			breakdown.slices.map((slice) => ({
				status: 'unknown' as const,
				label: slice.label,
				count: slice.count,
				percentage: slice.percentage
			})),
			radius
		).map((segment, index) => ({ ...segment, accent: breakdown.slices[index].accent }))
	);
</script>

<SectionCard title="Deployments by Domain" href="/domains">
	<div class="flex items-center gap-4 px-4 pb-4">
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
				{#each segments as segment (segment.label)}
					<circle
						cx={size / 2}
						cy={size / 2}
						r={radius}
						fill="none"
						stroke-width={thickness}
						stroke-linecap="butt"
						stroke-dasharray="{segment.dashLength} {segment.dashGap}"
						stroke-dashoffset={segment.dashOffset}
						class="{accentStroke(segment.accent)} transition-all duration-500"
					>
						<title>{segment.label}: {segment.count} ({segment.percentage}%)</title>
					</circle>
				{/each}
			</svg>
			<div class="absolute inset-0 flex flex-col items-center justify-center">
				<span class="tabular text-[22px] leading-none font-semibold">{breakdown.total}</span>
				<span class="mt-1 text-[10.5px] text-muted-foreground">Total</span>
			</div>
		</div>

		<ul class="min-w-0 flex-1 space-y-[7px]">
			{#each breakdown.slices as slice (slice.domainId)}
				<li class="flex items-center gap-2 text-[11.5px]">
					<span class="size-2 shrink-0 rounded-full {accentDot(slice.accent)}" aria-hidden="true"
					></span>
					<span class="min-w-0 flex-1 truncate text-muted-foreground">{slice.label}</span>
					<span class="tabular font-medium">{slice.count}</span>
					<span class="tabular w-[42px] text-right text-muted-foreground">{slice.percentage}%</span>
				</li>
			{/each}
		</ul>
	</div>
</SectionCard>
