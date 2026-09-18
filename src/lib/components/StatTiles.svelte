<script lang="ts">
	import HealthRing from './HealthRing.svelte';
	import Icon from './Icon.svelte';
	import Sparkline from './Sparkline.svelte';
	import { sentimentText, statusTone, toneFor } from './tone';
	import { formatInstances } from '$lib/platform/services';
	import { trendSentiment } from '$lib/platform/format';
	import type { ServiceStat } from '$lib/platform/types';

	/**
	 * The headline strip a detail screen opens with.
	 *
	 * Shared by the service view and the infrastructure view: both open with a row of
	 * readings drawn from the same five shapes, and a second component would be a second
	 * place to fix a spacing bug.
	 *
	 * The union is what makes the switch below exhaustive — a new tile shape is a type
	 * error here rather than a blank card in production.
	 */

	interface Props {
		stats: ServiceStat[];
		/** Columns at the widest breakpoint. Six tiles and seven need different grids. */
		columns?: 6 | 7;
	}

	let { stats, columns = 6 }: Props = $props();
</script>

<div
	class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 {columns === 7
		? '2xl:grid-cols-7'
		: '2xl:grid-cols-6'}"
>
	{#each stats as stat (stat.id)}
		<!--
			Read defensively: the ring and breakdown variants carry no tone of their own,
			because theirs is a consequence of the status or the parts they already state.
		-->
		{@const tone = 'tone' in stat && stat.tone ? toneFor(stat.tone) : null}
		<article class="rounded-xl border border-border bg-card px-4 py-3">
			<div class="flex items-start justify-between gap-2">
				<p class="text-[12px] font-medium text-muted-foreground">{stat.label}</p>
				{#if stat.icon}
					<span
						class="grid size-7 shrink-0 place-items-center rounded-lg {tone
							? `${tone.chip} border-0`
							: 'bg-muted text-muted-foreground'}"
					>
						<Icon name={stat.icon} size={14} strokeWidth={2} />
					</span>
				{/if}
			</div>

			{#if stat.kind === 'ring'}
				<div class="mt-2 flex items-center gap-3">
					<HealthRing score={stat.score} status={stat.status} size={62} thickness={6} />
					<span class="min-w-0">
						<span class="tabular block text-[11px] text-muted-foreground">/100</span>
						<span class="mt-0.5 block truncate text-[11.5px] {statusTone(stat.status).text}">
							{stat.caption}
						</span>
					</span>
				</div>
			{:else if stat.kind === 'breakdown'}
				<p class="tabular mt-2 text-[26px] leading-none font-semibold">{stat.total}</p>
				<p class="mt-1 text-[11px] text-muted-foreground">{stat.caption}</p>

				<!--
					One bar, split by the parts rather than one bar per part: the question is
					how the total divides, and separate bars would need a scale to compare.
				-->
				<div class="mt-2.5 flex h-1.5 gap-[2px] overflow-hidden rounded-full">
					{#each stat.parts as part (part.status)}
						{#if part.count > 0}
							<span
								class="{statusTone(part.status).dot} first:rounded-l-full last:rounded-r-full"
								style="flex:{part.count}"
							></span>
						{/if}
					{/each}
				</div>

				<ul class="mt-2 flex flex-wrap gap-x-3 gap-y-0.5">
					{#each stat.parts as part (part.status)}
						<li class="text-[10.5px]">
							<span class="tabular font-medium {statusTone(part.status).text}">{part.count}</span>
							<span class="ml-1 text-muted-foreground">{part.label}</span>
						</li>
					{/each}
				</ul>
			{:else if stat.kind === 'ratio'}
				<p class="tabular mt-2 text-[26px] leading-none font-semibold {tone?.text ?? ''}">
					{stat.value}<span class="ml-1 text-[15px] text-muted-foreground">/ {stat.total}</span>
					<span class="sr-only">{formatInstances(stat.value, stat.total)}</span>
				</p>
				<p class="mt-2.5 text-[11.5px] {tone?.text ?? 'text-muted-foreground'}">{stat.caption}</p>
			{:else if stat.kind === 'note'}
				<p class="mt-2 text-[26px] leading-none font-semibold {tone?.text ?? ''}">
					{stat.formatted}
				</p>
				<p class="mt-2.5 text-[11.5px] text-muted-foreground">{stat.caption}</p>
			{:else if stat.kind === 'link'}
				<p class="tabular mt-2 text-[26px] leading-none font-semibold {tone?.text ?? ''}">
					{stat.formatted}
				</p>
				{#if stat.action}
					<a
						href={stat.action.href}
						class="mt-2.5 flex items-center gap-1 text-[11.5px] font-medium text-primary transition-colors hover:text-primary/80"
					>
						{stat.action.label}
						<Icon name="arrow-right" size={12} />
					</a>
				{:else}
					<p class="mt-2.5 text-[11.5px] text-muted-foreground">Nothing firing</p>
				{/if}
			{:else}
				{@const sentiment = trendSentiment(stat.direction, stat.polarity)}
				<p class="tabular mt-2 text-[26px] leading-none font-semibold {tone?.text ?? ''}">
					{stat.formatted}{#if stat.unit}<span class="ml-1 text-[14px] text-muted-foreground"
							>{stat.unit}</span
						>{/if}
				</p>

				{#if stat.kind === 'trend'}
					<div class="mt-2">
						<Sparkline
							series={stat.series}
							width={200}
							height={26}
							stroke={sentiment === 'bad' ? 'stroke-down' : 'stroke-info'}
							class="h-[26px] w-full"
						/>
					</div>
				{:else}
					<div class="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
						<div
							class="h-full rounded-full bg-healthy transition-all duration-500"
							style="width:{stat.progressPct}%"
						></div>
					</div>
				{/if}

				<p class="tabular mt-2 text-[11.5px]">
					<span class={sentimentText(sentiment)}>{stat.changeFormatted}</span>
					<span class="ml-1 text-muted-foreground">{stat.comparedToLabel}</span>
				</p>
			{/if}
		</article>
	{/each}
</div>
