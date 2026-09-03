<script lang="ts">
	interface Props {
		size?: number;
		class?: string;
	}

	let { size = 28, class: className = '' }: Props = $props();
</script>

<!-- Inline SVG rather than an asset: it is eight path commands and it inherits
     the theme's primary colour without a second file to keep in sync. -->
<span
	class="grid shrink-0 place-items-center rounded-[9px] bg-primary text-primary-foreground {className}"
	style="width:{size}px;height:{size}px"
	aria-hidden="true"
>
	<svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} fill="none">
		<path
			d="M12 3.2 19.5 7.6v8.8L12 20.8 4.5 16.4V7.6L12 3.2Z"
			stroke="currentColor"
			stroke-width="1.7"
			stroke-linejoin="round"
		/>
		<path
			d="M12 8.2v7.6M9 10.4h6"
			stroke="currentColor"
			stroke-width="1.7"
			stroke-linecap="round"
		/>
	</svg>
</span>
