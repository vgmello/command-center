<script lang="ts">
	import { ringDash } from '$lib/platform/geometry';
	import { statusTone } from './tone';
	import type { HealthStatus } from '$lib/platform/types';

	interface Props {
		score: number;
		status: HealthStatus;
		size?: number;
		thickness?: number;
	}

	let { score, status, size = 44, thickness = 4 }: Props = $props();

	const radius = $derived((size - thickness) / 2);
	const dash = $derived(ringDash(score, radius));
	const tone = $derived(statusTone(status));
</script>

<div
	class="relative shrink-0"
	style="width:{size}px;height:{size}px"
	role="meter"
	aria-valuenow={score}
	aria-valuemin={0}
	aria-valuemax={100}
	aria-label="Health score"
>
	<svg viewBox="0 0 {size} {size}" class="-rotate-90" width={size} height={size}>
		<circle
			cx={size / 2}
			cy={size / 2}
			r={radius}
			fill="none"
			stroke-width={thickness}
			class="stroke-border"
		/>
		<circle
			cx={size / 2}
			cy={size / 2}
			r={radius}
			fill="none"
			stroke-width={thickness}
			stroke-linecap="round"
			stroke-dasharray="{dash.dash} {dash.gap}"
			class="{tone.stroke} transition-[stroke-dasharray] duration-500"
		/>
	</svg>
	<span
		class="tabular absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-foreground"
	>
		{score}
	</span>
</div>
