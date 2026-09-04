<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { STATUS_LABELS } from '$lib/platform/health';
	import { accentTile, statusTone } from '../tone';
	import type { Service, ServiceDependencies, HealthStatus } from '$lib/platform/types';
	import type { Panel } from '$lib/platform/sources';

	interface Props {
		service: Service;
		dependencies: Panel<ServiceDependencies>;
	}

	let { service, dependencies }: Props = $props();

	// An empty graph would say "this service talks to nothing", which is a much stronger
	// claim than "no connected source can see the call graph".
	const graph = $derived(
		dependencies.status === 'ok' ? dependencies.data : { upstream: [], downstream: [] }
	);

	/*
	 * Laid out with flexbox rather than drawn as a graph.
	 *
	 * Two columns of one hop each is a list with arrows, not a network — and a real
	 * graph layout would bring a dependency, canvas maths and hit-testing to render
	 * five boxes. If this ever grows to transitive edges it becomes a real graph and
	 * earns that cost then.
	 */
	const LEGEND: HealthStatus[] = ['healthy', 'degraded', 'down', 'unknown'];

	const serviceTone = $derived(statusTone(service.status));
</script>

<SectionCard title="Dependencies">
	{#snippet icon()}
		<Icon name="share-2" size={15} />
	{/snippet}

	{#if dependencies.status !== 'ok'}
		<p class="px-4 pt-2 pb-6 text-center text-[12px] text-muted-foreground">
			{#if dependencies.status === 'unavailable'}
				No connected APM source maps service dependencies.
			{:else}
				{dependencies.source?.name ?? 'The APM source'} did not answer.
			{/if}
		</p>
	{:else}
		<div class="px-4 pb-4">
			<div class="flex items-stretch gap-2">
				<div class="flex min-w-0 flex-1 flex-col gap-2">
					<p class="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
						Upstream
					</p>
					{#each graph.upstream as node (node.id)}
						{@const tone = statusTone(node.status)}
						<div class="rounded-lg border border-border bg-background px-2.5 py-2">
							<div class="flex items-center justify-between gap-2">
								<span class="min-w-0 truncate text-[11.5px] font-medium">{node.name}</span>
								<span class="{tone.text} shrink-0" title={STATUS_LABELS[node.status]}>
									<Icon name="circle-check" size={13} />
								</span>
							</div>
							<p class="text-[10px] text-muted-foreground">{node.protocol}</p>
						</div>
					{/each}
				</div>

				<div class="flex shrink-0 items-center pt-5 text-muted-foreground">
					<Icon name="arrow-right" size={14} />
				</div>

				<div class="flex min-w-0 flex-[1.15] items-center pt-5">
					<div class="w-full rounded-lg border border-border bg-background p-2.5">
						<div class="flex items-center gap-2">
							<span
								class="grid size-6 shrink-0 place-items-center rounded-md ring-1 {accentTile(
									service.accent
								)}"
							>
								<Icon name={service.icon} size={12} strokeWidth={2} />
							</span>
							<span class="min-w-0 truncate text-[11.5px] font-medium">{service.name}</span>
						</div>
						<p class="mt-1.5 text-[10px] text-muted-foreground">
							{service.instancesTotal} instance{service.instancesTotal === 1 ? '' : 's'}
						</p>
						<p class="mt-1 flex items-center gap-1.5 text-[10.5px] {serviceTone.text}">
							<span class="size-1.5 rounded-full {serviceTone.dot}" aria-hidden="true"></span>
							{STATUS_LABELS[service.status]}
						</p>
					</div>
				</div>

				<div class="flex shrink-0 items-center pt-5 text-muted-foreground">
					<Icon name="arrow-right" size={14} />
				</div>

				<div class="flex min-w-0 flex-1 flex-col gap-2">
					<p class="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
						Downstream
					</p>
					{#each graph.downstream as node (node.id)}
						{@const tone = statusTone(node.status)}
						<div class="rounded-lg border border-border bg-background px-2.5 py-2">
							<div class="flex items-center justify-between gap-2">
								<span class="min-w-0 truncate text-[11.5px] font-medium">{node.name}</span>
								<span class="{tone.text} shrink-0" title={STATUS_LABELS[node.status]}>
									<Icon
										name={node.status === 'healthy' ? 'circle-check' : 'triangle-alert'}
										size={13}
									/>
								</span>
							</div>
							<p class="text-[10px] text-muted-foreground">{node.protocol}</p>
						</div>
					{/each}
				</div>
			</div>

			<ul class="mt-4 flex flex-wrap items-center gap-3.5 border-t border-border pt-3">
				{#each LEGEND as status (status)}
					<li class="flex items-center gap-1.5 text-[11px] text-muted-foreground">
						<span class="size-2 rounded-full {statusTone(status).dot}" aria-hidden="true"></span>
						{STATUS_LABELS[status]}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</SectionCard>
