<script lang="ts">
	import Icon from '../Icon.svelte';
	import RelativeTime from '../RelativeTime.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { accentTile } from '../tone';
	import { HEALTH_CHANGE_LABELS } from '$lib/platform/health';
	import type { DomainChange } from '$lib/platform/types';

	interface Props {
		changes: DomainChange[];
	}

	let { changes }: Props = $props();

	/*
	 * A rising health score is good news and a falling one is bad, so this reads
	 * straight off the direction. Not every metric works that way — error rate rising
	 * is bad — which is why `TrendPolarity` exists on the ones that need it and this
	 * does not use it.
	 */
	const ARROWS = {
		up: { icon: 'arrow-up', tone: 'text-healthy' },
		down: { icon: 'arrow-down', tone: 'text-down' },
		flat: { icon: 'arrow-right', tone: 'text-muted-foreground' }
	} as const;
</script>

<SectionCard title="Recently Changed Domains" href="/domains">
	<ul class="pb-2">
		{#each changes as change (change.id)}
			{@const arrow = ARROWS[change.direction]}
			<li>
				<div class="flex items-center gap-2.5 px-4 py-[7px] transition-colors hover:bg-accent/40">
					<span
						class="grid size-7 shrink-0 place-items-center rounded-lg ring-1 {accentTile(
							change.accent
						)}"
					>
						<Icon name={change.icon} size={14} strokeWidth={1.9} />
					</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-[11.5px] font-medium">{change.name}</span>
						<span class="block truncate text-[10.5px] text-muted-foreground">
							{HEALTH_CHANGE_LABELS[change.direction]}
						</span>
					</span>
					<span class="flex shrink-0 items-center gap-1">
						<span class="tabular text-[12px] font-medium">{change.healthScore}</span>
						<span class={arrow.tone} aria-label="{change.previousScore} to {change.healthScore}">
							<Icon name={arrow.icon} size={13} strokeWidth={2.2} />
						</span>
					</span>
					<RelativeTime
						value={change.changedAt}
						class="tabular w-[48px] shrink-0 text-right text-[10.5px] text-muted-foreground"
					/>
				</div>
			</li>
		{/each}
	</ul>
</SectionCard>
