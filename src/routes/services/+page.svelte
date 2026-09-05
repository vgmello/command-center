<script lang="ts">
	import Icon from '$lib/components/Icon.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { accentTile, statusTone } from '$lib/components/tone';
	import { describeInstanceHealth } from '$lib/platform/services';
	import { STATUS_LABELS } from '$lib/platform/health';
	import { getScope } from '$lib/scope.svelte';
	import { getServices } from '../services.remote';

	/**
	 * The service index.
	 *
	 * Built alongside the detail page rather than left as a placeholder, because the
	 * detail page's breadcrumb points here — a trail that leads to a stub is a trail
	 * that stops working the moment someone follows it.
	 */

	const scope = getScope();
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange });
</script>

<svelte:head><title>Services · Command Center</title></svelte:head>

<div class="space-y-4 p-5">
	<div>
		<h1 class="text-[26px] leading-tight font-semibold tracking-tight">Services</h1>
		<p class="mt-0.5 text-[13px] text-muted-foreground">
			Every deployable unit across the platform, with its owner and current health
		</p>
	</div>

	<svelte:boundary>
		{@const services = await getServices(args)}
		<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{#each services as service (service.id)}
				{@const tone = statusTone(service.status)}
				<a
					href="/services/{service.slug}"
					class="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
				>
					<div class="flex items-start justify-between gap-3">
						<div class="flex min-w-0 items-center gap-2.5">
							<span
								class="grid size-9 shrink-0 place-items-center rounded-lg ring-1 {accentTile(
									service.accent
								)}"
							>
								<Icon name={service.icon} size={17} strokeWidth={1.9} />
							</span>
							<div class="min-w-0">
								<p class="truncate text-[13.5px] font-medium">{service.name}</p>
								<p class="truncate text-[11.5px] text-muted-foreground">{service.domainName}</p>
							</div>
						</div>
						<StatusBadge label={STATUS_LABELS[service.status]} {tone} />
					</div>

					<p class="mt-3 line-clamp-2 text-[12px] text-muted-foreground">{service.description}</p>

					<div class="mt-3 flex items-center justify-between gap-3 text-[11.5px]">
						<span class="truncate text-muted-foreground">{service.owner}</span>
						<span class="tabular shrink-0 text-muted-foreground">
							{describeInstanceHealth(service.instancesHealthy, service.instancesTotal)}
						</span>
					</div>
				</a>
			{/each}
		</div>

		{#snippet pending()}
			<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{#each ['a', 'b', 'c', 'd', 'e', 'f'] as key (key)}
					<Skeleton class="h-[164px] rounded-xl" />
				{/each}
			</div>
		{/snippet}
	</svelte:boundary>
</div>
