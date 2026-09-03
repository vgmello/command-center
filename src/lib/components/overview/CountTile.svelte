<script lang="ts">
	import Icon from '../Icon.svelte';
	import { statusTone } from '../tone';
	import type { CountTile } from '$lib/platform/types';

	interface Props {
		tile: CountTile;
	}

	let { tile }: Props = $props();

	const tone = $derived(tile.status ? statusTone(tile.status) : null);
</script>

<article class="rounded-xl border border-border bg-card px-4 py-2.5">
	<p class="text-[12px] font-medium text-muted-foreground">{tile.label}</p>
	<div class="mt-1.5 flex items-center justify-between gap-2">
		<span class="tabular text-[26px] leading-none font-semibold {tone?.text ?? 'text-foreground'}">
			{tile.value}
		</span>
		<span
			class="grid size-9 shrink-0 place-items-center rounded-lg {tone
				? `${tone.chip} border-0`
				: 'bg-muted text-muted-foreground'}"
		>
			<Icon name={tile.icon} size={18} strokeWidth={1.9} />
		</span>
	</div>
	<p class="tabular mt-2 text-[11.5px] text-muted-foreground">
		{tile.caption ?? `${tile.percentage}%`}
	</p>
</article>
