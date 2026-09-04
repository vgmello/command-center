<script lang="ts">
	import SectionCard from '../SectionCard.svelte';
	import { donutSegments } from '$lib/platform/geometry';
	import { accentDot, accentStroke } from '../tone';
	import type { StorageClass } from '$lib/platform/types';

	interface Props {
		totalFormatted: string;
		classes: StorageClass[];
	}

	let { totalFormatted, classes }: Props = $props();

	const size = 116;
	const thickness = 13;
	const radius = (size - thickness) / 2;

	const segments = $derived(
		donutSegments(
			classes.map((one) => ({
				status: 'unknown' as const,
				label: one.label,
				count: one.percentage,
				percentage: one.percentage
			})),
			radius
		).map((segment, index) => ({ ...segment, accent: classes[index].accent }))
	);
</script>

<SectionCard
	title="Storage Overview"
	href="/infrastructure/storage"
	viewAllLabel="View all storage"
>
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
						<title>{segment.label}: {segment.percentage}%</title>
					</circle>
				{/each}
			</svg>
			<div class="absolute inset-0 flex flex-col items-center justify-center">
				<span class="tabular text-[19px] leading-none font-semibold">{totalFormatted}</span>
				<span class="mt-1 text-[10px] text-muted-foreground">Total Used</span>
			</div>
		</div>

		<ul class="min-w-0 flex-1 space-y-2.5">
			{#each classes as one (one.id)}
				<li class="flex items-center gap-2 text-[12px]">
					<span class="size-2 shrink-0 rounded-full {accentDot(one.accent)}" aria-hidden="true"
					></span>
					<span class="min-w-0 flex-1 truncate text-muted-foreground">{one.label}</span>
					<span class="tabular shrink-0 font-medium">{one.formatted}</span>
					<span class="tabular w-[36px] shrink-0 text-right text-muted-foreground">
						{one.percentage}%
					</span>
				</li>
			{/each}
		</ul>
	</div>
</SectionCard>
