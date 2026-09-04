<script lang="ts">
	import Icon from '../Icon.svelte';
	import StatusBadge from '../StatusBadge.svelte';
	import { accentTile, statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import type { Service } from '$lib/platform/types';

	interface Props {
		service: Service;
	}

	let { service }: Props = $props();

	const tone = $derived(statusTone(service.status));
</script>

<header class="flex flex-wrap items-start justify-between gap-4">
	<div class="flex items-start gap-3">
		<span
			class="grid size-11 shrink-0 place-items-center rounded-xl ring-1 {accentTile(
				service.accent
			)}"
		>
			<Icon name={service.icon} size={22} strokeWidth={1.9} />
		</span>
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2.5">
				<h1 class="text-[26px] leading-tight font-semibold tracking-tight">{service.name}</h1>
				<StatusBadge label={STATUS_LABELS[service.status]} {tone} />
			</div>
			<p class="mt-0.5 text-[13px] text-muted-foreground">{service.description}</p>
		</div>
	</div>

	<!--
		Both actions leave the app, so both are plain anchors with rel/target set. The
		catalog states the URL; nothing here constructs one. When a service has no
		dashboard recorded, the button is absent rather than disabled — there is nothing
		for a reader to enable.
	-->
	<div class="flex items-center gap-2">
		{#if service.dashboard}
			<a
				href={service.dashboard.href}
				target="_blank"
				rel="noreferrer noopener"
				class="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
			>
				<Icon name="chart-column" size={14} />
				{service.dashboard.label}
				<Icon name="external-link" size={12} />
			</a>
		{/if}
		<a
			href={service.repository.href}
			target="_blank"
			rel="noreferrer noopener"
			class="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<Icon name="settings" size={14} />
			Service settings
			<Icon name="external-link" size={12} />
		</a>
	</div>
</header>
