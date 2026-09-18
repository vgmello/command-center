<script lang="ts">
	import Icon from '../Icon.svelte';
	import * as Avatar from '$lib/components/ui/avatar/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type {
		CurrentUser,
		EnvironmentId,
		EnvironmentOption,
		TimeRangeId,
		TimeRangeOption
	} from '$lib/platform/types';

	interface Props {
		environments: EnvironmentOption[];
		timeRanges: TimeRangeOption[];
		environment: EnvironmentId;
		timeRange: TimeRangeId;
		autoRefresh: boolean;
		user: CurrentUser;
		onEnvironmentChange: (value: EnvironmentId) => void;
		onTimeRangeChange: (value: TimeRangeId) => void;
		onToggleAutoRefresh: () => void;
	}

	let {
		environments,
		timeRanges,
		environment,
		timeRange,
		autoRefresh,
		user,
		onEnvironmentChange,
		onTimeRangeChange,
		onToggleAutoRefresh
	}: Props = $props();

	const environmentLabel = $derived(
		environments.find((option) => option.id === environment)?.label ?? environment
	);
	const timeRangeLabel = $derived(
		timeRanges.find((option) => option.id === timeRange)?.label ?? timeRange
	);

	let searchTerm = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);

	/*
	 * ⌘K / Ctrl-K focuses search. Bound on the window rather than the input for
	 * the obvious reason that the input does not have focus when the shortcut is
	 * pressed — that is the entire point of the shortcut.
	 */
	function handleShortcut(event: KeyboardEvent) {
		if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
			event.preventDefault();
			searchInput?.focus();
		}
	}
</script>

<svelte:window onkeydown={handleShortcut} />

<header class="flex h-[60px] shrink-0 items-center gap-3 border-b border-border bg-background px-5">
	<div class="relative w-full max-w-[440px]">
		<span
			class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
		>
			<Icon name="search" size={15} />
		</span>
		<Input
			bind:ref={searchInput}
			bind:value={searchTerm}
			type="search"
			placeholder="Search services, domains, logs, traces..."
			aria-label="Search the platform"
			class="h-10 rounded-xl border-border bg-card pr-16 pl-9 text-[13px] dark:bg-card"
		/>
		<kbd
			class="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] font-medium text-muted-foreground"
		>
			⌘ K
		</kbd>
	</div>

	<div class="ml-auto flex items-center gap-2">
		<Select.Root
			type="single"
			value={environment}
			onValueChange={(value) => onEnvironmentChange(value as EnvironmentId)}
		>
			<Select.Trigger
				aria-label="Environment"
				class="h-11 gap-2.5 rounded-xl border-border bg-card px-3 dark:bg-card dark:hover:bg-accent/50"
			>
				<span class="text-healthy"><Icon name="cloud" size={16} /></span>
				<span class="flex flex-col items-start leading-tight">
					<span class="text-[10.5px] text-muted-foreground">Environment</span>
					<span class="text-[13px] font-medium text-foreground">{environmentLabel}</span>
				</span>
			</Select.Trigger>
			<Select.Content align="end">
				{#each environments as option (option.id)}
					<Select.Item value={option.id} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root
			type="single"
			value={timeRange}
			onValueChange={(value) => onTimeRangeChange(value as TimeRangeId)}
		>
			<Select.Trigger
				aria-label="Time range"
				class="h-11 gap-2.5 rounded-xl border-border bg-card px-3 dark:bg-card dark:hover:bg-accent/50"
			>
				<span class="text-muted-foreground"><Icon name="layers" size={16} /></span>
				<span class="flex flex-col items-start leading-tight">
					<span class="text-[10.5px] text-muted-foreground">Time range</span>
					<span class="text-[13px] font-medium text-foreground">{timeRangeLabel}</span>
				</span>
			</Select.Trigger>
			<Select.Content align="end">
				{#each timeRanges as option (option.id)}
					<Select.Item value={option.id} label={option.label} />
				{/each}
			</Select.Content>
		</Select.Root>

		<button
			type="button"
			onclick={onToggleAutoRefresh}
			aria-pressed={autoRefresh}
			class="flex h-11 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-[13px] font-medium transition-colors hover:bg-accent/50"
		>
			<span
				class="size-2 rounded-full {autoRefresh
					? 'animate-pulse bg-healthy'
					: 'bg-muted-foreground/50'}"
				aria-hidden="true"
			></span>
			Auto-refresh
			<span class="text-muted-foreground"><Icon name="chevron-down" size={14} /></span>
		</button>

		<button
			type="button"
			class="relative grid size-10 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
			aria-label="{user.unreadNotifications} unread notifications"
		>
			<Icon name="bell" size={18} />
			{#if user.unreadNotifications > 0}
				<span
					class="tabular absolute top-1 right-1 grid size-4 place-items-center rounded-full bg-down text-[9px] font-semibold text-white"
				>
					{user.unreadNotifications}
				</span>
			{/if}
		</button>

		<button
			type="button"
			class="flex items-center gap-1.5 rounded-xl p-0.5 transition-colors hover:bg-accent/50"
			aria-label="Account menu"
		>
			<Avatar.Root class="size-9">
				<Avatar.Fallback class="bg-primary/15 text-[12px] font-semibold text-primary">
					{user.initials}
				</Avatar.Fallback>
			</Avatar.Root>
			<span class="text-muted-foreground"><Icon name="chevron-down" size={15} /></span>
		</button>
	</div>
</header>
