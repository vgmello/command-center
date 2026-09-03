<script lang="ts">
	import { getHealth, getServiceDetail } from './status.remote';
</script>

<svelte:head>
	<title>Command Center</title>
</svelte:head>

<h1>Command Center</h1>

<svelte:boundary>
	{@const health = await getHealth()}

	<p class="runtime">{health.runtime}</p>
	<p class="status" data-status={health.status}>system: {health.status}</p>

	<ul>
		{#each health.services as service (service.name)}
			{@const detail = await getServiceDetail(service.name)}
			<li>
				<span>{service.name}</span>
				<span data-status={detail?.status}>{detail?.status ?? 'unknown'}</span>
				<span>{detail?.latencyMs ?? '—'}ms</span>
			</li>
		{/each}
	</ul>

	<button onclick={() => getHealth().refresh()}>Refresh</button>

	{#snippet pending()}
		<p>Checking services…</p>
	{/snippet}

	{#snippet failed(error, reset)}
		<p>Health check failed: {(error as Error).message}</p>
		<button onclick={reset}>Retry</button>
	{/snippet}
</svelte:boundary>

<style>
	[data-status='ok'] {
		color: green;
	}
	[data-status='degraded'] {
		color: darkorange;
	}
	[data-status='down'] {
		color: crimson;
	}
	ul {
		list-style: none;
		padding: 0;
	}
	li {
		display: flex;
		gap: 1rem;
	}
</style>
