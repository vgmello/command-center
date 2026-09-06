<script lang="ts">
	import Icon from '../Icon.svelte';
	import SectionCard from '../SectionCard.svelte';
	import { accentDot, accentStroke, accentTile, statusTone } from '../tone';
	import { STATUS_LABELS } from '$lib/platform/health';
	import { formatCompact, formatLatency, formatPercent } from '$lib/platform/format';
	import { layoutDependencyGraph } from '$lib/platform/dependency-graph';
	import type {
		DependencyKind,
		Domain,
		DomainAccent,
		DomainDependencies
	} from '$lib/platform/types';

	interface Props {
		domain: Domain;
		dependencies: DomainDependencies;
	}

	let { domain, dependencies }: Props = $props();

	/**
	 * Which identity tint each family is drawn in.
	 *
	 * The accent vocabulary rather than new colours, so the graph cannot drift from the rest
	 * of the app — and identity, not health, for the same reason a domain's accent is: a
	 * datastore is a datastore whether or not it is currently on fire.
	 */
	const FAMILY_ACCENT: Record<DependencyKind, DomainAccent> = {
		service: 'blue',
		datastore: 'green',
		queue: 'violet',
		external: 'amber'
	};

	const layout = $derived(layoutDependencyGraph(dependencies));

	/** Every node plus the hub, so the inspector can be told one id and find its subject. */
	const nodes = $derived(new Map(layout.groups.flatMap((g) => g.nodes.map((n) => [n.id, n.node]))));

	let selected = $state<string | null>(null);

	const focused = $derived(selected !== null);
	const subject = $derived(selected === null ? null : (nodes.get(selected) ?? null));

	/**
	 * Is this node lit, or dimmed because something else has focus?
	 *
	 * The hub never dims. Every wire runs to it, so dimming it while lighting one edge
	 * would leave the lit wire running from nowhere — the picture reads as "from here to
	 * there", and "here" has to stay visible for that to mean anything.
	 */
	const lit = (id: string) => !focused || selected === id;

	function toggle(id: string) {
		selected = selected === id ? null : id;
	}

	const hubTone = $derived(statusTone(domain.status));

	/** A reading a reader can scan: 1.2k, 430 ms, 0.42%. */
	const reading = (one: { requestRate: number; latencyMs: number; errorRatePct: number }) => {
		const latency = formatLatency(one.latencyMs);
		return [
			`${formatCompact(one.requestRate)} req/s`,
			`${latency.value} ${latency.unit}`,
			formatPercent(one.errorRatePct)
		];
	};
</script>

<SectionCard title="Domain Dependencies">
	{#snippet icon()}
		<Icon name="share-2" size={15} />
	{/snippet}

	{#if layout.edges.length === 0}
		<p class="px-4 pt-2 pb-6 text-center text-[12px] text-muted-foreground">
			This domain neither calls nor is called by another.
		</p>
	{:else}
		<div class="overflow-x-auto px-4 pb-2">
			<div class="relative mx-auto" style="width:{layout.width}px; height:{layout.height}px">
				<!--
					The wires sit under the boxes and never take a pointer event: a curve
					passing behind a node must not swallow the click meant for it.
				-->
				<svg
					class="pointer-events-none absolute inset-0 overflow-visible"
					width={layout.width}
					height={layout.height}
					aria-hidden="true"
				>
					{#each layout.edges as edge (edge.id)}
						{@const node = nodes.get(edge.id)}
						{@const accent = node ? FAMILY_ACCENT[node.kind] : 'slate'}
						{@const on = lit(edge.id)}
						<path
							id="dep-wire-{edge.id}"
							d={edge.d}
							fill="none"
							stroke-width={edge.weight}
							class="transition-opacity {on ? accentStroke(accent) : 'stroke-border'} {on
								? 'opacity-70'
								: 'opacity-20'}"
						/>
						<!--
							Two packets per wire, offset by half a period, so a busy edge reads
							as a stream rather than a single dot going round. `animateMotion` is
							SVG's own — no library, and it keeps running without the main thread.
						-->
						{#each [0, 1] as offset (offset)}
							<circle r="2.4" class="{accentDot(accent)} fill-current" opacity={on ? 0.85 : 0.12}>
								<animateMotion
									dur="{edge.pulseSeconds}s"
									repeatCount="indefinite"
									begin="{(offset * edge.pulseSeconds) / 2}s"
								>
									<mpath href="#dep-wire-{edge.id}" />
								</animateMotion>
							</circle>
						{/each}
					{/each}
				</svg>

				{#each layout.columns as column (column.side)}
					<p
						class="absolute flex items-center gap-1.5 text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase"
						style="left:{column.box.x}px; top:{column.box.y}px; width:{column.box
							.width}px; height:{column.box.height}px"
					>
						{#if column.side === 'upstream'}
							<Icon name="arrow-right" size={11} />
						{/if}
						{column.label}
						{#if column.side === 'downstream'}
							<Icon name="arrow-right" size={11} />
						{/if}
					</p>
				{/each}

				{#each layout.groups as group (group.side + group.kind)}
					{@const accent = FAMILY_ACCENT[group.kind]}
					<p
						class="absolute flex items-center gap-1.5 text-[11px] font-medium"
						style="left:{group.header.x}px; top:{group.header.y}px; width:{group.header
							.width}px; height:{group.header.height}px"
					>
						<span class="grid size-4 place-items-center rounded {accentTile(accent)}">
							<Icon name={group.kind === 'external' ? 'cloud' : 'layers'} size={10} />
						</span>
						<span class="text-muted-foreground">{group.label}</span>
						<span class="tabular ml-auto text-[10.5px] text-muted-foreground">
							{group.nodes.length}
						</span>
					</p>

					{#each group.nodes as box (box.id)}
						{@const tone = statusTone(box.node.status)}
						<button
							type="button"
							aria-pressed={selected === box.id}
							onclick={() => toggle(box.id)}
							class="absolute flex items-center gap-2.5 rounded-lg border bg-card px-2.5 text-left transition-[opacity,border-color,background-color] hover:bg-accent/40 {selected ===
							box.id
								? 'border-primary bg-accent/50'
								: 'border-border'} {lit(box.id) ? 'opacity-100' : 'opacity-35'}"
							style="left:{box.x}px; top:{box.y}px; width:{box.width}px; height:{box.height}px"
						>
							<span class="grid size-7 shrink-0 place-items-center rounded-md {accentTile(accent)}">
								<Icon name={box.node.icon} size={14} />
							</span>
							<span class="min-w-0 flex-1">
								<span class="flex items-center gap-1.5">
									<span class="truncate text-[12px] font-medium">{box.node.name}</span>
									<span
										class="size-1.5 shrink-0 rounded-full {tone.dot}"
										title={STATUS_LABELS[box.node.status]}
									></span>
								</span>
								<span class="tabular mt-0.5 flex gap-2 text-[10.5px] text-muted-foreground">
									{#each reading(box.node) as value (value)}
										<span>{value}</span>
									{/each}
								</span>
							</span>
						</button>
					{/each}
				{/each}

				<button
					type="button"
					aria-pressed={selected === 'hub'}
					onclick={() => toggle('hub')}
					class="absolute flex items-center gap-3 rounded-xl border-2 px-3 text-left transition-opacity {hubTone.chip} {selected ===
					'hub'
						? 'ring-2 ring-primary'
						: ''}"
					style="left:{layout.hub.x}px; top:{layout.hub.y}px; width:{layout.hub
						.width}px; height:{layout.hub.height}px"
				>
					<span
						class="grid size-9 shrink-0 place-items-center rounded-lg ring-1 {accentTile(
							domain.accent
						)}"
					>
						<Icon name={domain.icon} size={17} strokeWidth={2} />
					</span>
					<span class="min-w-0">
						<span class="flex items-center gap-1.5">
							<span class="truncate text-[13px] font-semibold text-foreground">{domain.name}</span>
							<span class="size-1.5 rounded-full {hubTone.dot}"></span>
						</span>
						<span class="tabular mt-1 flex gap-2 text-[10.5px] {hubTone.text}">
							{#each reading(dependencies.self) as value (value)}
								<span>{value}</span>
							{/each}
						</span>
					</span>
				</button>
			</div>
		</div>

		<!--
			The inspector reads the domain until something is selected. A panel that emptied
			itself on deselect would flicker its own height every time a reader let go.
		-->
		<div
			class="mx-4 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-background px-4 py-3"
		>
			<div class="min-w-[220px] flex-1">
				<p class="text-[12.5px] font-semibold">{subject?.name ?? domain.name}</p>
				<p class="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
					{subject?.role ?? `Fans out to ${layout.edges.length} dependencies in the request path.`}
				</p>
			</div>

			{#each [['Throughput', 0], ['Latency', 1], ['Error rate', 2]] as [label, index] (label)}
				<div class="min-w-[84px]">
					<p class="text-[10.5px] text-muted-foreground">{label}</p>
					<p class="tabular mt-0.5 text-[13.5px] font-medium">
						{reading(subject ?? dependencies.self)[index as number]}
					</p>
				</div>
			{/each}
		</div>

		{#if dependencies.criticalPath.length > 0}
			<div class="mx-4 mb-4 border-t border-border pt-3">
				<p class="text-[11px] text-muted-foreground">Critical Path</p>
				<p class="mt-1 flex flex-wrap items-center gap-1.5 text-[12px]">
					{#each dependencies.criticalPath as name, index (name)}
						{#if index > 0}
							<span class="text-muted-foreground" aria-hidden="true">
								<Icon name="arrow-right" size={12} />
							</span>
						{/if}
						<span class={index === 1 ? 'font-medium' : 'text-muted-foreground'}>{name}</span>
					{/each}
				</p>
			</div>
		{/if}
	{/if}
</SectionCard>
