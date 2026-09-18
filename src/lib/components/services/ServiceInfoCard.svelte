<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import type { ExternalLink, Service } from '$lib/platform/types';

	interface Props {
		service: Service;
	}

	let { service }: Props = $props();

	/*
	 * Plain facts first, then the external links. The domain row navigates now that
	 * `/domains/[slug]` exists — it was text until the destination landed.
	 */
	const facts = $derived([
		['Owner', service.owner],
		['Service Type', service.serviceType],
		['Language', service.language],
		['Runtime', service.runtime]
	] as const);

	// A row per link the catalog actually records. An absent runbook is omitted rather
	// than rendered as a link to nowhere.
	const links = $derived(
		(
			[
				['Repository', service.repository, 'git-branch'],
				['Chat Channel', service.chatChannel, 'message-square'],
				['Runbook', service.runbook, 'scroll-text']
			] as ReadonlyArray<readonly [string, ExternalLink | null, string]>
		).filter((one): one is readonly [string, ExternalLink, string] => one[1] !== null)
	);
</script>

<SectionCard title="Service Info">
	<dl class="px-4 pb-4">
		<div class="flex items-center justify-between gap-4 py-[7px]">
			<dt class="shrink-0 text-[12px] text-muted-foreground">Domain</dt>
			<dd class="min-w-0">
				<a
					href="/domains/{service.domainId}"
					class="block truncate text-[12.5px] transition-colors hover:text-primary"
				>
					{service.domainName}
				</a>
			</dd>
		</div>

		{#each facts as [label, value] (label)}
			<div class="flex items-center justify-between gap-4 py-[7px]">
				<dt class="shrink-0 text-[12px] text-muted-foreground">{label}</dt>
				<dd class="min-w-0 truncate text-[12.5px]">{value}</dd>
			</div>
		{/each}

		{#each links as [label, link, icon] (label)}
			<div class="flex items-center justify-between gap-4 py-[7px]">
				<dt class="shrink-0 text-[12px] text-muted-foreground">{label}</dt>
				<dd class="min-w-0">
					<a
						href={link.href}
						target="_blank"
						rel="noreferrer noopener"
						class="flex items-center gap-1.5 truncate text-[12.5px] text-primary transition-colors hover:text-primary/80"
					>
						<Icon name={icon} size={13} />
						<span class="truncate">{link.label}</span>
					</a>
				</dd>
			</div>
		{/each}
	</dl>
</SectionCard>
