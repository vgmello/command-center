<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import type { ExternalLink, Service } from '$lib/platform/types';

	interface Props {
		service: Service;
	}

	let { service }: Props = $props();

	/*
	 * Plain facts first, then the links.
	 *
	 * The domain row is text, not a link: `/domains/<slug>` does not exist yet, and a
	 * row that navigates to a 404 is worse than a row that does not navigate.
	 */
	const facts = $derived([
		['Domain', service.domainName],
		['Owner', service.owner],
		['Service Type', service.serviceType],
		['Language', service.language],
		['Runtime', service.runtime]
	] as const);

	const links = $derived([
		['Repository', service.repository, 'git-branch'],
		['Chat Channel', service.chatChannel, 'message-square'],
		['Runbook', service.runbook, 'scroll-text']
	] as const satisfies ReadonlyArray<readonly [string, ExternalLink, string]>);
</script>

<SectionCard title="Service Info">
	<dl class="px-4 pb-4">
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
