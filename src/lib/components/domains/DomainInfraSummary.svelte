<script lang="ts">
	import PanelGap from '../PanelGap.svelte';
	import SectionCard from '../SectionCard.svelte';
	import type { Panel } from '$lib/platform/sources';
	import { toInfraSummaryView } from '$lib/platform/infrastructure';
	import type { InfraSummary } from '$lib/platform/types';

	/**
	 * The Infrastructure tab's headline strip: nodes, clusters, databases and storage.
	 *
	 * A four-cell echo of `StatTiles`'s tile styling rather than a reuse of `CountTile` —
	 * `CountTile` wants a `percentage`/`icon` per tile, which this strip doesn't carry, and
	 * bolting those fields on would make the summary source its own opinion about how a
	 * gapped cell should look. The labels themselves come from `toInfraSummaryView`, which
	 * already decided the dash-vs-count-vs-"100+" rule for each cell.
	 */

	interface Props {
		summary: Panel<InfraSummary>;
	}

	let { summary }: Props = $props();

	const view = $derived(summary.status === 'ok' ? toInfraSummaryView(summary.data) : null);
</script>

{#if summary.status !== 'ok'}
	<SectionCard title="Infrastructure Summary">
		<PanelGap panel={summary} noun="an infrastructure summary" class="px-4 pb-4" />
	</SectionCard>
{:else if view}
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<article class="rounded-xl border border-border bg-card px-4 py-3">
			<p class="text-[12px] font-medium text-muted-foreground">Nodes</p>
			<p class="tabular mt-2 text-[26px] leading-none font-semibold">{view.nodesLabel}</p>
		</article>
		<article class="rounded-xl border border-border bg-card px-4 py-3">
			<p class="text-[12px] font-medium text-muted-foreground">Clusters</p>
			<p class="tabular mt-2 text-[26px] leading-none font-semibold">{view.clustersLabel}</p>
		</article>
		<article class="rounded-xl border border-border bg-card px-4 py-3">
			<p class="text-[12px] font-medium text-muted-foreground">Databases</p>
			<p class="tabular mt-2 text-[26px] leading-none font-semibold">{view.databasesLabel}</p>
		</article>
		<article class="rounded-xl border border-border bg-card px-4 py-3">
			<p class="text-[12px] font-medium text-muted-foreground">Storage</p>
			<p class="tabular mt-2 text-[26px] leading-none font-semibold">{view.storageLabel}</p>
		</article>
	</div>
{/if}
