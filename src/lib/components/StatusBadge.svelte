<script lang="ts">
	import type { Tone } from './tone';

	interface Props {
		label: string;
		tone: Tone;
	}

	let { label, tone }: Props = $props();
</script>

<span
	class="inline-flex items-center rounded-md border px-1.5 py-[3px] text-[10.5px] leading-none font-medium {tone.chip}"
>
	{label}
</span>
