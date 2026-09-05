<script lang="ts">
	import Icon from './Icon.svelte';
	import type { Tone } from './tone';

	interface Props {
		label: string;
		tone: Tone;
		/** Icon key to print before the label. Omitted where the colour alone carries it. */
		icon?: string;
	}

	let { label, tone, icon }: Props = $props();
</script>

<span
	class="inline-flex items-center gap-1 rounded-md border px-1.5 py-[3px] text-[10.5px] leading-none font-medium {tone.chip}"
>
	{#if icon}
		<Icon name={icon} size={11} strokeWidth={2.4} />
	{/if}
	{label}
</span>
