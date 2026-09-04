<script lang="ts">
	import Icon from './Icon.svelte';
	import { sentimentText } from './tone';
	import { trendSentiment } from '$lib/platform/format';
	import type { RateTile } from '$lib/platform/types';

	/**
	 * A tile whose headline is a rate rather than a count.
	 *
	 * Separate from `CountTile` because the two differ in what they print underneath —
	 * a share of a total, or a signed change against a previous period — and one
	 * component that branched on which would have to be told the answer anyway.
	 */

	interface Props {
		tile: RateTile;
	}

	let { tile }: Props = $props();

	// Colour follows sentiment, never direction: a falling deploy time is good news
	// even though the arrow points down.
	const sentiment = $derived(trendSentiment(tile.direction, tile.polarity));
</script>

<article class="rounded-xl border border-border bg-card px-4 py-2.5">
	<p class="text-[12px] font-medium text-muted-foreground">{tile.label}</p>
	<div class="mt-1.5 flex items-center justify-between gap-2">
		<span class="tabular text-[26px] leading-none font-semibold">
			{tile.formatted}{#if tile.unit}<span class="ml-1 text-[14px] text-muted-foreground"
					>{tile.unit}</span
				>{/if}
		</span>
		<span class="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
			<Icon name={tile.icon} size={18} strokeWidth={1.9} />
		</span>
	</div>
	<p class="tabular mt-2 text-[11.5px]">
		<span class={sentimentText(sentiment)}>{tile.changeFormatted}</span>
		<span class="ml-1 text-muted-foreground">{tile.comparedToLabel}</span>
	</p>
</article>
