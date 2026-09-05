<script lang="ts">
	import type { Panel, SourceKind } from '$lib/platform/sources';

	/**
	 * Why a panel has nothing to draw.
	 *
	 * Six panels on the overview alone each hand-rolled this two-branch conditional, which
	 * is how the copy drifted: two of them said "source" where the rest named the kind.
	 * One component, and `noun` is the only thing a caller has to decide.
	 *
	 * `unavailable` and `failed` stay separate sentences on purpose — "nothing is
	 * connected" and "Azure did not answer" call for different actions, and collapsing
	 * them would tell an on-call engineer to configure a source that is already configured.
	 */
	let {
		panel,
		noun,
		class: className = ''
	}: {
		/** The panel that came back with no data. `ok` renders nothing. */
		panel: Panel<unknown>;
		/** What this panel would have shown: "incidents", "recent deployments". */
		noun: string;
		class?: string;
	} = $props();

	const KIND_LABEL: Record<SourceKind, string> = {
		cloud: 'cloud',
		apm: 'APM',
		deployment: 'deployment'
	};
</script>

{#if panel.status === 'unavailable'}
	<p class="text-[12px] text-muted-foreground {className}">
		No connected {KIND_LABEL[panel.kind]} source provides {noun}.
	</p>
{:else if panel.status === 'failed'}
	<p class="text-[12px] text-muted-foreground {className}">
		{panel.source?.name ?? `The ${KIND_LABEL[panel.kind]} source`} did not answer.
	</p>
{/if}
