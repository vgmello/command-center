<script lang="ts">
	import HealthRing from './HealthRing.svelte';
	import Icon from './Icon.svelte';
	import Sparkline from './Sparkline.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import { accentTile, statusTone } from './tone';
	import { CRITICALITY_LABELS, STATUS_LABELS } from '$lib/platform/health';
	import { formatLatency, formatPercent } from '$lib/platform/format';
	import type { Domain } from '$lib/platform/types';

	interface Props {
		domain: Domain;
	}

	let { domain }: Props = $props();

	const tone = $derived(statusTone(domain.status));
	const latency = $derived(formatLatency(domain.p95LatencyMs));
</script>

<article
	class="flex flex-col gap-3 rounded-xl border border-border bg-background/40 p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
>
	<div class="flex items-start gap-3">
		<span
			class="grid size-9 shrink-0 place-items-center rounded-lg ring-1 {accentTile(domain.accent)}"
		>
			<Icon name={domain.icon} size={17} strokeWidth={1.9} />
		</span>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-[13px] font-medium">{domain.name}</span>
			<span class="block truncate text-[11px] text-muted-foreground">
				{CRITICALITY_LABELS[domain.criticality]}
			</span>
		</span>
		<HealthRing score={domain.healthScore} status={domain.status} size={40} />
	</div>

	<div class="flex items-center justify-between">
		<StatusBadge label={STATUS_LABELS[domain.status]} {tone} />
		<span class="text-[11px] text-muted-foreground">{domain.serviceCount} services</span>
	</div>

	<dl class="tabular grid grid-cols-3 gap-2 text-[11px]">
		<div>
			<dt class="text-muted-foreground">Errors</dt>
			<dd class="mt-0.5 font-medium">{formatPercent(domain.errorRatePct)}</dd>
		</div>
		<div>
			<dt class="text-muted-foreground">P95</dt>
			<dd class="mt-0.5 font-medium">{latency.value} {latency.unit}</dd>
		</div>
		<div>
			<dt class="text-muted-foreground">Incidents</dt>
			<dd class="mt-0.5 font-medium {domain.activeIncidents > 0 ? 'text-down' : ''}">
				{domain.activeIncidents}
			</dd>
		</div>
	</dl>

	<Sparkline
		series={domain.healthTrend}
		width={200}
		height={28}
		stroke={domain.status === 'down' ? 'stroke-down' : 'stroke-info'}
		fill={domain.status === 'down' ? 'fill-down' : 'fill-info'}
		area
		class="h-7 w-full"
	/>
</article>
