<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { accentTile, statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import type { Domain, DomainDependencies } from '$lib/platform/types';

	interface Props {
		domain: Domain;
		dependencies: DomainDependencies;
	}

	let { domain, dependencies }: Props = $props();

	const tone = $derived(statusTone(domain.status));

	/*
	 * Two columns of one hop with the domain between them, laid out with flexbox. Same
	 * reasoning as the service graph: this is a list with arrows, not a network, and a
	 * graph layout would bring a dependency to draw five boxes.
	 */
</script>

<SectionCard title="Domain Dependencies" href="/domains">
	<div class="px-4 pb-4">
		<div class="flex items-stretch gap-2">
			<div class="min-w-0 flex-1 rounded-lg border border-border bg-background p-3">
				<p class="text-[11px] text-muted-foreground">Upstream Domains</p>
				<ul class="mt-2 space-y-2">
					{#each dependencies.upstream as node (node.id)}
						{@const nodeTone = statusTone(node.status)}
						<li class="flex items-center gap-2">
							<span class="{nodeTone.text} shrink-0" title={STATUS_LABELS[node.status]}>
								<Icon
									name={node.status === 'healthy' ? 'circle-check' : 'triangle-alert'}
									size={14}
								/>
							</span>
							<a
								href="/domains/{node.id}"
								class="min-w-0 truncate text-[12px] transition-colors hover:text-primary"
							>
								{node.name}
							</a>
						</li>
					{:else}
						<li class="text-[11.5px] text-muted-foreground">Nothing calls this domain.</li>
					{/each}
				</ul>
			</div>

			<div class="flex shrink-0 items-center text-muted-foreground">
				<Icon name="arrow-right" size={15} />
			</div>

			<div class="flex min-w-0 flex-[0.9] items-center">
				<div class="w-full rounded-lg border-2 p-3 {tone.chip}">
					<div class="flex items-center gap-2">
						<span
							class="grid size-7 shrink-0 place-items-center rounded-md ring-1 {accentTile(
								domain.accent
							)}"
						>
							<Icon name={domain.icon} size={14} strokeWidth={2} />
						</span>
						<span class="min-w-0 truncate text-[12.5px] font-medium text-foreground">
							{domain.name}
						</span>
					</div>
					<p class="mt-2 flex items-center gap-1.5 text-[11px] {tone.text}">
						<span class="size-2 rounded-full {tone.dot}" aria-hidden="true"></span>
						{STATUS_LABELS[domain.status]}
					</p>
				</div>
			</div>

			<div class="flex shrink-0 items-center text-muted-foreground">
				<Icon name="arrow-right" size={15} />
			</div>

			<div class="min-w-0 flex-1 rounded-lg border border-border bg-background p-3">
				<p class="text-[11px] text-muted-foreground">Downstream Domains</p>
				<ul class="mt-2 space-y-2">
					{#each dependencies.downstream as node (node.id)}
						{@const nodeTone = statusTone(node.status)}
						<li class="flex items-center gap-2">
							<span class="{nodeTone.text} shrink-0" title={STATUS_LABELS[node.status]}>
								<Icon
									name={node.status === 'healthy' ? 'circle-check' : 'triangle-alert'}
									size={14}
								/>
							</span>
							<a
								href="/domains/{node.id}"
								class="min-w-0 truncate text-[12px] transition-colors hover:text-primary"
							>
								{node.name}
							</a>
						</li>
					{:else}
						<li class="text-[11.5px] text-muted-foreground">This domain calls nothing.</li>
					{/each}
				</ul>
			</div>
		</div>

		{#if dependencies.criticalPath.length > 0}
			<div class="mt-4 border-t border-border pt-3">
				<p class="text-[11px] text-muted-foreground">Critical Path</p>
				<p class="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
					{#each dependencies.criticalPath as name, index (name)}
						{#if index > 0}
							<span class="text-muted-foreground" aria-hidden="true">
								<Icon name="arrow-right" size={12} />
							</span>
						{/if}
						<span class={index === 1 ? 'font-medium' : 'text-muted-foreground'}>{name}</span>
					{/each}
				</p>
			</div>
		{/if}
	</div>
</SectionCard>
