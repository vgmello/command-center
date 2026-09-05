import type { TrendDirection, TrendPolarity } from './types';

/** 18_700 → "18.7k", 1_240_000 → "1.24M". Keeps metric tiles a fixed width. */
export function formatCompact(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1_000_000) return `${trimZeros(value / 1_000_000, 2)}M`;
	if (abs >= 1_000) return `${trimZeros(value / 1_000, 1)}k`;
	return trimZeros(value, abs >= 100 ? 0 : 1);
}

/** 1.384 → "1.38%". Two decimals is the resolution an SRE actually reads. */
export function formatPercent(value: number, decimals = 2): string {
	return `${value.toFixed(decimals)}%`;
}

/**
 * Latency in the unit that keeps it under four characters: milliseconds up to a
 * second, then seconds. 412 → "412 ms", 1820 → "1.82 s".
 */
export function formatLatency(ms: number): { value: string; unit: string } {
	if (ms >= 1000) return { value: trimZeros(ms / 1000, 2), unit: 's' };
	return { value: Math.round(ms).toString(), unit: 'ms' };
}

/** Prefixes an arrow and sign: 8.4 → "↑ 8.4%". */
export function formatChange(change: number, unit: string, decimals = 2): string {
	const arrow = change > 0 ? '↑' : change < 0 ? '↓' : '→';
	return `${arrow} ${trimZeros(Math.abs(change), decimals)}${unit}`;
}

/**
 * Whether a movement should read as good, bad, or neutral.
 *
 * Colour follows this, not the direction: error rate falling is `good` even
 * though the arrow points down.
 */
export function trendSentiment(
	direction: TrendDirection,
	polarity: TrendPolarity
): 'good' | 'bad' | 'neutral' {
	if (direction === 'flat' || polarity === 'neutral') return 'neutral';
	const better = polarity === 'higher-is-better' ? 'up' : 'down';
	return direction === better ? 'good' : 'bad';
}

/**
 * "2m ago" / "1h ago" / "3d ago".
 *
 * Deliberately computed against a caller-supplied `now` so the caller controls
 * the clock: the server would otherwise bake a timestamp into SSR output that is
 * stale by the time it reaches the browser.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
	const then = new Date(iso).getTime();
	if (!Number.isFinite(then)) return '—';

	const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
	if (seconds < 60) return `${seconds}s ago`;

	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	return `${Math.round(hours / 24)}d ago`;
}

function trimZeros(value: number, decimals: number): string {
	return value
		.toFixed(decimals)
		.replace(/\.0+$/, '')
		.replace(/(\.\d*[1-9])0+$/, '$1');
}

/**
 * "$4k" / "$850" — a money axis label.
 *
 * Compact because an axis has four labels and no room for thousands separators, and
 * rounded because nobody reads a tick mark to the dollar.
 */
export function formatMoneyAxis(amount: number): string {
	if (amount >= 1000) return `$${trimZeros(amount / 1000, 1)}k`;
	return `$${Math.round(amount)}`;
}
