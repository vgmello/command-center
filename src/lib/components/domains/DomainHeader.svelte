<script lang="ts">
	import Icon from '../Icon.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { accentTile, statusTone } from '../tone';
	import { CRITICALITY_LABELS, STATUS_LABELS } from '$lib/platform/health';
	import type { Domain } from '$lib/platform/types';

	interface Props {
		domain: Domain;
	}

	let { domain }: Props = $props();

	const tone = $derived(statusTone(domain.status));

	/*
	 * The description is derived from what the domain already states — its tier and its
	 * name — rather than being a second field somebody has to keep accurate. A domain
	 * whose criticality changes should not keep a sentence that says otherwise.
	 */
	const description = $derived(
		`${CRITICALITY_LABELS[domain.criticality]} domain owned by ${domain.owner}, running ${domain.serviceCount} services`
	);
</script>

<header class="flex flex-wrap items-start justify-between gap-4">
	<div class="flex items-start gap-3">
		<span
			class="grid size-11 shrink-0 place-items-center rounded-xl ring-1 {accentTile(domain.accent)}"
		>
			<Icon name={domain.icon} size={22} strokeWidth={1.9} />
		</span>
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2.5">
				<h1 class="text-[26px] leading-tight font-semibold tracking-tight">{domain.name}</h1>
				<StatusBadge label={STATUS_LABELS[domain.status]} {tone} />
			</div>
			<p class="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
		</div>
	</div>

	<!--
		The favourite control reports rather than acts: pins live in the workspace source
		and there is no mutation behind them yet. A button that looks like it toggles and
		does not is worse than one that states what is already true.
	-->
	<div class="flex items-center gap-2">
		<span
			class="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[12.5px] font-medium text-muted-foreground"
		>
			<Icon name="star" size={14} />
			{domain.favorite ? 'In favorites' : 'Not in favorites'}
		</span>
	</div>
</header>
