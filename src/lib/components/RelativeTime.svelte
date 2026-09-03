<script lang="ts">
	import { formatRelativeTime } from '$lib/platform/format';

	interface Props {
		/** ISO 8601 timestamp. */
		value: string;
		class?: string;
	}

	let { value, class: className = '' }: Props = $props();

	/*
	 * The clock is state, not a constant. Rendering `formatRelativeTime` once
	 * would freeze "2m ago" at whatever the server thought when it built the
	 * page; ticking it here keeps the label honest without refetching anything.
	 */
	let now = $state(new Date());

	$effect(() => {
		const timer = setInterval(() => (now = new Date()), 30_000);
		return () => clearInterval(timer);
	});

	const label = $derived(formatRelativeTime(value, now));
</script>

<time datetime={value} class={className}>{label}</time>
