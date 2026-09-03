<script lang="ts">
	import { icon } from './icon';

	interface Props {
		/** Icon key from the registry; unknown keys render a neutral box. */
		name: string;
		size?: number;
		strokeWidth?: number;
		class?: string;
	}

	let { name, size = 16, strokeWidth = 2, class: className = '' }: Props = $props();

	const Glyph = $derived(icon(name));
</script>

<Glyph {size} {strokeWidth} class={className} aria-hidden="true" />
