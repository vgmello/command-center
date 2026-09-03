import type { Series } from '$lib/platform/types';

/**
 * Deterministic pseudo-random source.
 *
 * The fixtures must produce the same numbers on the server render and on every
 * subsequent refresh, otherwise sparklines would jitter on each request and the
 * page would look like it was reporting change that never happened. mulberry32
 * is a few lines and needs no dependency.
 */
export function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Stable 32-bit hash of a string, so a slug can seed its own series. */
export function hashSeed(value: string): number {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

export interface SeriesOptions {
	/** Number of samples in the window. */
	points?: number;
	/** Fraction of `base` the walk may wander per step. */
	volatility?: number;
	/** Fraction of `base` the series drifts across the whole window. */
	drift?: number;
	/** Values are clamped at zero unless a floor is given. */
	floor?: number;
}

/**
 * A bounded random walk around `base`, ending `drift` away from where it started.
 *
 * Real metric series are neither flat nor white noise, and a sparkline that does
 * not look like a plausible metric undermines every number next to it.
 */
export function buildSeries(seed: string, base: number, options: SeriesOptions = {}): Series {
	const { points = 24, volatility = 0.12, drift = 0, floor = 0 } = options;
	const random = seededRandom(hashSeed(seed));
	const values: number[] = [];

	let current = base * (1 - drift / 2);
	const step = (base * drift) / Math.max(points - 1, 1);

	for (let i = 0; i < points; i++) {
		const jitter = (random() - 0.5) * 2 * base * volatility;
		current = Math.max(floor, current + jitter * 0.5 + step);
		values.push(round(current));
	}

	return { values, min: Math.min(...values), max: Math.max(...values) };
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
