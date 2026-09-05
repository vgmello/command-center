<script lang="ts">
	import { sparklineArea, sparklinePath } from '$lib/platform/geometry';
	import type { Series } from '$lib/platform/types';

	interface Props {
		series: Series;
		width?: number;
		height?: number;
		/** Tailwind stroke class, e.g. `stroke-healthy`. */
		stroke?: string;
		/** Tailwind fill class; set together with `area` for a gradient-less wash. */
		fill?: string;
		area?: boolean;
		class?: string;
	}

	let {
		series,
		width = 72,
		height = 22,
		stroke = 'stroke-info',
		fill = 'fill-info',
		area = false,
		class: className = ''
	}: Props = $props();

	const padding = 2;
	const line = $derived(sparklinePath(series, width, height, padding));
	const wash = $derived(area ? sparklineArea(series, width, height, padding) : '');
</script>

<!--
	Drawn with a non-uniform viewBox so the same series fills whatever box the
	layout gives it. `preserveAspectRatio="none"` is what lets a 72×22 sparkline
	and a 160×32 one share the geometry code.
-->
<svg
	viewBox="0 0 {width} {height}"
	preserveAspectRatio="none"
	class={className}
	role="presentation"
	aria-hidden="true"
>
	{#if area}
		<path d={wash} class="{fill} opacity-12" />
	{/if}
	<path
		d={line}
		fill="none"
		class={stroke}
		stroke-width="1.5"
		stroke-linecap="round"
		stroke-linejoin="round"
		vector-effect="non-scaling-stroke"
	/>
</svg>
