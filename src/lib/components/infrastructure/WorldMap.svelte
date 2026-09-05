<script lang="ts">
	import { WORLD_COLUMNS, WORLD_ROWS, worldDots } from '$lib/platform/world';
	import { projectLatLon } from '$lib/platform/chart';
	import { statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import type { InfraRegion } from '$lib/platform/types';

	/**
	 * Regions plotted on a dot-matrix world.
	 *
	 * The land is a coarse mask in `$lib/platform/world.ts` and the projection is four
	 * lines of arithmetic — no map library, because nothing here is measured. The
	 * markers are the content; the dots only say "world".
	 */

	interface Props {
		regions: InfraRegion[];
	}

	let { regions }: Props = $props();

	const cell = 6;
	const width = WORLD_COLUMNS * cell;
	const height = WORLD_ROWS * cell;

	const land = worldDots();
	const markers = $derived(
		regions.map((region) => ({
			region,
			...projectLatLon(region.latitude, region.longitude, width, height)
		}))
	);
</script>

<svg
	viewBox="0 0 {width} {height}"
	class="h-auto w-full"
	role="img"
	aria-label="Regions on a world map"
>
	{#each land as dot (`${dot.column}:${dot.row}`)}
		<circle
			cx={dot.column * cell + cell / 2}
			cy={dot.row * cell + cell / 2}
			r={cell * 0.28}
			class="fill-muted-foreground/25"
		/>
	{/each}

	{#each markers as marker (marker.region.id)}
		{@const tone = statusTone(marker.region.status)}
		<g>
			<circle cx={marker.x} cy={marker.y} r={cell * 1.4} class="{tone.fill} opacity-20" />
			<circle cx={marker.x} cy={marker.y} r={cell * 0.6} class={tone.fill}>
				<title>
					{marker.region.name}: {STATUS_LABELS[marker.region.status]} ({marker.region.nodeCount} nodes)
				</title>
			</circle>
		</g>
	{/each}
</svg>
