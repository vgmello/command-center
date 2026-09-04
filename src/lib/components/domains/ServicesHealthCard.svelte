<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import Sparkline from '../Sparkline.svelte';
	import { accentTile, statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import { formatLatency, formatPercent } from '$lib/platform/format';
	import { SERVICE_ROWS_COLLAPSED, describeHiddenServices } from '$lib/platform/domains';
	import type { ServiceVitals } from '$lib/platform/types';

	interface Props {
		services: ServiceVitals[];
	}

	let { services }: Props = $props();

	let expanded = $state(false);

	const shown = $derived(expanded ? services : services.slice(0, SERVICE_ROWS_COLLAPSED));
	const hiddenLabel = $derived(describeHiddenServices(services.length, SERVICE_ROWS_COLLAPSED));
</script>

<SectionCard title="Services Health" href="/services" viewAllLabel="View all services">
	<div class="overflow-x-auto px-4 pb-2">
		<table class="w-full">
			<thead>
				<tr class="text-[11px] text-muted-foreground">
					<th class="pb-1.5 text-left font-medium">Service</th>
					<th class="pb-1.5 text-left font-medium">Health</th>
					<th class="w-[64px] pb-1.5 text-left font-medium"></th>
					<th class="pb-1.5 text-right font-medium">Req/s</th>
					<th class="pb-1.5 text-right font-medium">Error Rate</th>
					<th class="pb-1.5 text-right font-medium">P95 Latency</th>
					<th class="pb-1.5 text-right font-medium">Instances</th>
				</tr>
			</thead>
			<tbody>
				{#each shown as service (service.id)}
					{@const tone = statusTone(service.status)}
					{@const latency = formatLatency(service.p95LatencyMs)}
					{@const healthy = service.status === 'healthy'}
					<tr class="border-t border-border/60">
						<td class="py-2">
							<a href="/services/{service.slug}" class="flex items-center gap-2.5">
								<span
									class="grid size-8 shrink-0 place-items-center rounded-lg ring-1 {accentTile(
										service.accent
									)}"
								>
									<Icon name={service.icon} size={15} strokeWidth={1.9} />
								</span>
								<span class="min-w-0">
									<span class="block truncate text-[12.5px] font-medium">{service.name}</span>
									<span class="block truncate text-[10.5px] text-muted-foreground">
										{service.kind}
									</span>
								</span>
							</a>
						</td>
						<td class="py-2">
							<span class="flex items-center gap-1.5 text-[12px] {tone.text}">
								<Icon
									name={healthy ? 'circle-check' : 'triangle-alert'}
									size={13}
									strokeWidth={2.2}
								/>
								{STATUS_LABELS[service.status]}
							</span>
						</td>
						<td class="py-2">
							<Sparkline
								series={service.trend}
								width={58}
								height={18}
								stroke={tone.stroke}
								class="h-[18px] w-[58px]"
							/>
						</td>
						<td class="tabular py-2 text-right text-[12.5px] whitespace-nowrap">
							{service.requestsPerSecond} req/s
						</td>
						<!-- Coloured only when it is the reason the row is not healthy. -->
						<td class="tabular py-2 text-right text-[12.5px] {healthy ? '' : tone.text}">
							{formatPercent(service.errorRatePct, 1)}
						</td>
						<td
							class="tabular py-2 text-right text-[12.5px] whitespace-nowrap {healthy
								? ''
								: tone.text}"
						>
							{latency.value}
							{latency.unit}
						</td>
						<td class="tabular py-2 text-right text-[12.5px] whitespace-nowrap">
							{service.instancesHealthy}/{service.instancesTotal}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if hiddenLabel}
		<div class="px-4 pb-3">
			<button
				type="button"
				onclick={() => (expanded = !expanded)}
				class="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[12px] font-medium text-primary transition-colors hover:bg-accent/40"
			>
				{expanded ? 'Show fewer services' : hiddenLabel}
				<span class="transition-transform {expanded ? 'rotate-180' : ''}">
					<Icon name="chevron-down" size={14} />
				</span>
			</button>
		</div>
	{/if}
</SectionCard>
