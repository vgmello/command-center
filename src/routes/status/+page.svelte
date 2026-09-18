<script lang="ts">
	import { getHealth, getServiceDetail } from './status.remote';
	import type { ServiceStatus } from '$lib/server/health';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';

	const statusVariant: Record<ServiceStatus, 'default' | 'secondary' | 'destructive'> = {
		ok: 'default',
		degraded: 'secondary',
		down: 'destructive'
	};
</script>

<svelte:head>
	<title>Command Center</title>
</svelte:head>

<main class="mx-auto max-w-3xl p-6">
	<svelte:boundary>
		{@const health = await getHealth()}

		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-3">
					Command Center
					<Badge variant={statusVariant[health.status]}>{health.status}</Badge>
				</Card.Title>
				<Card.Description>Running on {health.runtime}</Card.Description>
				<Card.Action>
					<Button variant="outline" size="sm" onclick={() => getHealth().refresh()}>
						<RefreshCw class="size-4" />
						Refresh
					</Button>
				</Card.Action>
			</Card.Header>

			<Separator />

			<Card.Content>
				<Table.Root>
					<Table.Caption>Batched through a single `query.batch` request.</Table.Caption>
					<Table.Header>
						<Table.Row>
							<Table.Head>Service</Table.Head>
							<Table.Head>Status</Table.Head>
							<Table.Head class="text-right">Latency</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each health.services as service (service.name)}
							{@const detail = await getServiceDetail(service.name)}
							<Table.Row>
								<Table.Cell class="font-medium">{service.name}</Table.Cell>
								<Table.Cell>
									{#if detail}
										<Badge variant={statusVariant[detail.status]}>{detail.status}</Badge>
									{:else}
										<Badge variant="outline">unknown</Badge>
									{/if}
								</Table.Cell>
								<Table.Cell class="text-right text-muted-foreground tabular-nums">
									{detail ? `${detail.latencyMs}ms` : '—'}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</Card.Content>
		</Card.Root>

		{#snippet pending()}
			<Card.Root>
				<Card.Header>
					<Card.Title>Command Center</Card.Title>
					<Card.Description>Checking services…</Card.Description>
				</Card.Header>
			</Card.Root>
		{/snippet}

		{#snippet failed(error: unknown, reset: () => void)}
			<Card.Root>
				<Card.Header>
					<Card.Title>Health check failed</Card.Title>
					<Card.Description>{(error as Error).message}</Card.Description>
					<Card.Action>
						<Button variant="outline" size="sm" onclick={reset}>Retry</Button>
					</Card.Action>
				</Card.Header>
			</Card.Root>
		{/snippet}
	</svelte:boundary>
</main>
