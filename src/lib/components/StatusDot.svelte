<script lang="ts">
	import { statusTone } from './tone';
	import type { HealthStatus } from '$lib/platform/types';

	interface Props {
		status: HealthStatus;
		size?: number;
		/** Adds the slow pulse used to mark something still changing. */
		pulse?: boolean;
		class?: string;
	}

	let { status, size = 8, pulse = false, class: className = '' }: Props = $props();

	const tone = $derived(statusTone(status));
</script>

<span
	class="inline-block shrink-0 rounded-full {tone.dot} {pulse ? 'animate-pulse' : ''} {className}"
	style="width:{size}px;height:{size}px"
	aria-hidden="true"
></span>
