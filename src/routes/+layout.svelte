<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import AppSidebar from '$lib/components/app/AppSidebar.svelte';
	import TopBar from '$lib/components/app/TopBar.svelte';
	import { getShell, getSystemStatus } from './shell.remote';
	import { setScope } from '$lib/scope.svelte';

	let { children } = $props();

	// One scope per render, shared with every panel through context.
	const scope = setScope();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="flex h-svh overflow-hidden bg-background">
	<svelte:boundary>
		{@const shell = await getShell()}
		{@const system = await getSystemStatus({
			environment: scope.environment,
			timeRange: scope.timeRange
		})}

		<AppSidebar nav={shell.nav} favorites={shell.favorites} user={shell.user} {system} />

		<div class="flex min-w-0 flex-1 flex-col">
			<TopBar
				environments={shell.environments}
				timeRanges={shell.timeRanges}
				environment={scope.environment}
				timeRange={scope.timeRange}
				autoRefresh={scope.autoRefresh}
				user={shell.user}
				onEnvironmentChange={(value) => (scope.environment = value)}
				onTimeRangeChange={(value) => (scope.timeRange = value)}
				onToggleAutoRefresh={() => (scope.autoRefresh = !scope.autoRefresh)}
			/>
			<main class="min-w-0 flex-1 overflow-y-auto">
				{@render children()}
			</main>
		</div>

		{#snippet pending()}
			<!-- The shell is chrome: a bare frame reads better than a spinner while it loads. -->
			<div class="w-[212px] shrink-0 border-r border-sidebar-border bg-sidebar"></div>
			<div class="flex-1">
				<div class="h-[60px] border-b border-border"></div>
			</div>
		{/snippet}

		{#snippet failed(error, reset)}
			<div class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<p class="text-sm font-medium">Could not load the workspace.</p>
				<p class="max-w-md text-xs text-muted-foreground">{(error as Error).message}</p>
				<button
					type="button"
					onclick={reset}
					class="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
				>
					Try again
				</button>
			</div>
		{/snippet}
	</svelte:boundary>
</div>
