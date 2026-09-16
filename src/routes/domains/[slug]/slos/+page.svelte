<script lang="ts">
	import Breadcrumb from '$lib/components/app/Breadcrumb.svelte';
	import DomainHeader from '$lib/components/domains/DomainHeader.svelte';
	import DomainSloTable from '$lib/components/domains/DomainSloTable.svelte';
	import DomainTabs from '$lib/components/domains/DomainTabs.svelte';
	import PanelGap from '$lib/components/PanelGap.svelte';
	import SectionCard from '$lib/components/SectionCard.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { formatPercent } from '$lib/platform/format';
	import { getScope } from '$lib/scope.svelte';
	import { getDomainHeader, getDomainSlos } from '../../../domains.remote';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * A domain's SLO compliance, and the budget behind each of its services.
	 *
	 * The headline card prints `DomainVitals.sloCompliancePct`/`sloWindowLabel` exactly as
	 * the domain header does — never a figure derived from the table beneath it, so a
	 * reader moving between the header and this tab cannot watch compliance move for no
	 * reason. The two panels are read independently; see `domain-tabs-view.ts` for what
	 * each gap means and why they are not symmetric.
	 */

	const scope = getScope();
	const slug = $derived(page.params.slug ?? '');
	const args = $derived({ environment: scope.environment, timeRange: scope.timeRange, slug });
</script>

<svelte:head><title>SLOs · {slug} · Command Center</title></svelte:head>

<div class="space-y-4 p-5">
	<svelte:boundary>
		{@const domain = await getDomainHeader(args)}

		{#if !domain}
			<div class="flex flex-col items-center justify-center gap-2 py-24 text-center">
				<p class="text-[15px] font-medium">No domain called “{slug}”.</p>
				<a
					href={resolve('/domains')}
					class="text-[13px] font-medium text-primary hover:text-primary/80"
				>
					Back to all domains
				</a>
			</div>
		{:else}
			{@const snapshot = await getDomainSlos(args)}

			<Breadcrumb
				trail={[
					{ label: 'Domains', href: '/domains' },
					{ label: domain.name, href: `/domains/${domain.slug}` },
					{ label: 'SLOs' }
				]}
			/>

			<DomainHeader {domain} />
			<DomainTabs slug={domain.slug} active="slos" badges={{ alerts: domain.activeIncidents }} />

			{#if snapshot}
				{@const headline = snapshot.headline}
				{@const rows = snapshot.services.status === 'ok' ? snapshot.services.data : []}
				{@const targets = new Set(rows.map((row) => row.budget.targetPct))}

				<SectionCard title="SLO Compliance">
					<div class="px-4 pb-4">
						<PanelGap panel={headline} noun="the domain's SLO compliance" />
						{#if headline.status === 'ok'}
							<div class="flex flex-wrap items-baseline justify-between gap-2">
								<span class="tabular text-[26px] leading-none font-semibold">
									{formatPercent(headline.data.compliancePct)}
								</span>
								<span class="tabular text-[11.5px] text-muted-foreground">
									{headline.data.windowLabel}
									<!-- Only shown when every service reports the same objective — a target
									     that disagreed with itself would be worse than no target at all. -->
									{#if targets.size === 1}
										· Target: {formatPercent([...targets][0])}
									{/if}
								</span>
							</div>
						{/if}
					</div>
				</SectionCard>

				<SectionCard title="Service Budgets">
					<div class="px-4 pb-4">
						<PanelGap panel={snapshot.services} noun="per-service SLO budgets" />
					</div>
					{#if snapshot.services.status === 'ok'}
						<div class="px-4 pb-4">
							<DomainSloTable {rows} />
						</div>
					{/if}
				</SectionCard>
			{/if}
		{/if}

		{#snippet pending()}
			<Skeleton class="h-5 w-[300px] rounded" />
			<Skeleton class="h-[52px] rounded-xl" />
			<Skeleton class="h-[38px] rounded-lg" />
			<Skeleton class="h-[120px] rounded-xl" />
			<Skeleton class="h-[320px] rounded-xl" />
		{/snippet}
	</svelte:boundary>
</div>
