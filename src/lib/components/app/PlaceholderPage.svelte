<script lang="ts">
	import Icon from '../Icon.svelte';

	interface Props {
		title: string;
		icon: string;
		description: string;
	}

	let { title, icon, description }: Props = $props();
</script>

<svelte:head><title>{title} · Command Center</title></svelte:head>

<div class="flex min-h-[70vh] flex-col items-center justify-center gap-3 p-8 text-center">
	<span class="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
		<Icon name={icon} size={22} strokeWidth={1.8} />
	</span>
	<h1 class="text-[20px] font-semibold tracking-tight">{title}</h1>
	<p class="max-w-sm text-[13px] text-muted-foreground">{description}</p>
</div>
