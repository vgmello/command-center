import type { CoralogixEstate, MockSeries } from './data';

/**
 * A small PromQL evaluator, for the subset this provider actually sends.
 *
 * The mock holds series and evaluates queries against them, rather than matching query
 * strings to canned answers. That distinction is the whole value: a lookup table would
 * return the right shape for a query that means the wrong thing, and the adapter's PromQL
 * would never be checked at all. Here, a mistake in a selector or a missing `by (le)`
 * produces a wrong number, which a test can catch.
 *
 * It is deliberately not a complete implementation. It supports what
 * `promql.ts` emits — selectors, `rate`, `increase`, `sum`, `avg`, `by`,
 * `histogram_quantile`, `clamp_min`, `or vector(0)`, and arithmetic — and throws on
 * anything else rather than guessing, so an unsupported expression fails loudly in a test
 * instead of quietly returning zero.
 */

export interface EvalPoint {
	at: number;
	value: number;
}

/** One output series: its identifying labels and its samples. */
export interface EvalSeries {
	labels: Record<string, string>;
	points: EvalPoint[];
}

class Tokens {
	#text: string;
	#at = 0;

	constructor(text: string) {
		this.#text = text;
	}

	get rest(): string {
		return this.#text.slice(this.#at);
	}

	skip(): void {
		while (this.#at < this.#text.length && /\s/.test(this.#text[this.#at])) this.#at++;
	}

	peek(token: string): boolean {
		this.skip();
		return this.rest.startsWith(token);
	}

	take(token: string): boolean {
		if (!this.peek(token)) return false;
		this.#at += token.length;
		return true;
	}

	expect(token: string): void {
		if (!this.take(token)) throw new Error(`Expected "${token}" at: ${this.rest.slice(0, 40)}`);
	}

	/** Read to the matching close paren, respecting nesting and quotes. */
	takeBalanced(): string {
		this.skip();
		this.expect('(');

		let depth = 1;
		let quoted = false;
		const start = this.#at;

		while (this.#at < this.#text.length) {
			const char = this.#text[this.#at];

			if (quoted) {
				if (char === '\\') this.#at++;
				else if (char === '"') quoted = false;
			} else if (char === '"') quoted = true;
			else if (char === '(') depth++;
			else if (char === ')' && --depth === 0) {
				const inner = this.#text.slice(start, this.#at);
				this.#at++;
				return inner;
			}

			this.#at++;
		}

		throw new Error('Unbalanced parentheses.');
	}

	/** Consume a `{...}` selector body, quotes respected, or nothing. */
	takeBraces(): string {
		this.skip();
		if (!this.rest.startsWith('{')) return '';

		let quoted = false;
		const start = this.#at;

		for (this.#at++; this.#at < this.#text.length; this.#at++) {
			const char = this.#text[this.#at];

			if (quoted) {
				if (char === '\\') this.#at++;
				else if (char === '"') quoted = false;
			} else if (char === '"') quoted = true;
			else if (char === '}') {
				this.#at++;
				return this.#text.slice(start, this.#at);
			}
		}

		throw new Error('Unterminated selector.');
	}

	takeWhile(pattern: RegExp): string {
		this.skip();
		let taken = '';

		while (this.#at < this.#text.length && pattern.test(this.#text[this.#at])) {
			taken += this.#text[this.#at++];
		}

		return taken;
	}

	get done(): boolean {
		this.skip();
		return this.#at >= this.#text.length;
	}
}

/** Parse `{a="b",c=~"d"}` into matchers. */
function parseSelector(text: string): { name?: string; matchers: [string, string, string][] } {
	const braceAt = text.indexOf('{');
	const name = (braceAt === -1 ? text : text.slice(0, braceAt)).trim() || undefined;
	const matchers: [string, string, string][] = [];

	if (braceAt !== -1) {
		const inner = text.slice(braceAt + 1, text.lastIndexOf('}'));
		const pattern = /(\w+)\s*(=~|!~|!=|=)\s*"((?:[^"\\]|\\.)*)"/g;
		let found: RegExpExecArray | null;

		while ((found = pattern.exec(inner))) {
			matchers.push([found[1], found[2], found[3].replace(/\\(.)/g, '$1')]);
		}
	}

	return { name, matchers };
}

function matches(
	series: MockSeries,
	name: string | undefined,
	matchers: [string, string, string][]
): boolean {
	if (name && series.labels.__name__ !== name) return false;

	for (const [key, operator, value] of matchers) {
		const actual = series.labels[key] ?? '';

		if (operator === '=' && actual !== value) return false;
		if (operator === '!=' && actual === value) return false;
		if (operator === '=~' && !new RegExp(`^(?:${value})$`).test(actual)) return false;
		if (operator === '!~' && new RegExp(`^(?:${value})$`).test(actual)) return false;
	}

	return true;
}

function labelsWithout(labels: Record<string, string>, drop: string[]): Record<string, string> {
	const kept: Record<string, string> = {};
	for (const [key, value] of Object.entries(labels)) {
		if (!drop.includes(key)) kept[key] = value;
	}
	return kept;
}

function groupKey(labels: Record<string, string>, by: string[]): string {
	return by.map((key) => `${key}=${labels[key] ?? ''}`).join(',');
}

/**
 * Linear interpolation across a cumulative histogram — what `histogram_quantile` does.
 *
 * Implemented rather than approximated because the p95 the app prints comes out of it,
 * and a mock that returned a bucket bound instead of an interpolated value would make
 * every latency figure land on one of eight numbers.
 */
function quantile(q: number, buckets: { le: number; count: number }[]): number {
	const sorted = buckets.slice().sort((a, b) => a.le - b.le);
	const total = sorted.at(-1)?.count ?? 0;
	if (total <= 0) return NaN;

	const target = q * total;
	let previousLe = 0;
	let previousCount = 0;

	for (const bucket of sorted) {
		if (bucket.count >= target) {
			if (!Number.isFinite(bucket.le)) return previousLe;

			const span = bucket.count - previousCount;
			const within = span > 0 ? (target - previousCount) / span : 0;
			return previousLe + (bucket.le - previousLe) * within;
		}

		previousLe = bucket.le;
		previousCount = bucket.count;
	}

	return sorted.at(-1)?.le ?? 0;
}

export class PromEvaluator {
	readonly #estate: CoralogixEstate;
	readonly #timestamps: number[];

	constructor(estate: CoralogixEstate) {
		this.#estate = estate;

		const end = Math.floor(estate.now.getTime() / 1000);
		this.#timestamps = Array.from(
			{ length: estate.points },
			(_, index) => end - (estate.points - 1 - index) * estate.stepSeconds
		);
	}

	/** Evaluate over a range, returning one series per output group. */
	evaluate(query: string, from: number, to: number, step: number): EvalSeries[] {
		const wanted = [];
		for (let at = from; at <= to; at += step) wanted.push(at);

		const tokens = new Tokens(query);
		const result = this.#expression(tokens, wanted);

		if (!tokens.done) throw new Error(`Unparsed input: ${tokens.rest.slice(0, 40)}`);

		return result;
	}

	/** Evaluate at one instant. */
	evaluateAt(query: string, at: number): EvalSeries[] {
		return this.evaluate(query, at, at, 60);
	}

	/**
	 * Additive level: `or`, `+`, `-`.
	 *
	 * Split from the multiplicative level so that PromQL's precedence holds. Parsed
	 * flat and left to right, `1 - errors / total` becomes `(1 - errors) / total`, which
	 * turns an availability of 99% into a negative number — a bug that reached a test
	 * before it reached a screen.
	 */
	#expression(tokens: Tokens, at: number[]): EvalSeries[] {
		let left = this.#product(tokens, at);

		for (;;) {
			if (tokens.take('or')) {
				const right = this.#product(tokens, at);
				// `or` fills in only where the left side has nothing, which is exactly why
				// the provider writes `... or vector(0)`.
				left = left.length > 0 ? left : right;
			} else if (tokens.take('-')) {
				left = this.#combine(left, this.#product(tokens, at), (a, b) => a - b);
			} else if (tokens.take('+')) {
				left = this.#combine(left, this.#product(tokens, at), (a, b) => a + b);
			} else {
				return left;
			}
		}
	}

	/** Multiplicative level: `*` and `/`, which bind tighter than `+` and `-`. */
	#product(tokens: Tokens, at: number[]): EvalSeries[] {
		let left = this.#term(tokens, at);

		for (;;) {
			if (tokens.take('/')) {
				left = this.#combine(left, this.#term(tokens, at), (a, b) => (b === 0 ? 0 : a / b));
			} else if (tokens.take('*')) {
				left = this.#combine(left, this.#term(tokens, at), (a, b) => a * b);
			} else {
				return left;
			}
		}
	}

	/** Pair two sides by label set, falling back to a scalar broadcast. */
	#combine(
		left: EvalSeries[],
		right: EvalSeries[],
		operate: (a: number, b: number) => number
	): EvalSeries[] {
		if (right.length === 1 && right[0].labels.__scalar__) {
			const scalar = right[0];
			return left.map((series) => ({
				labels: series.labels,
				points: series.points.map((point, index) => ({
					at: point.at,
					value: operate(point.value, scalar.points[index]?.value ?? scalar.points[0]?.value ?? 0)
				}))
			}));
		}

		if (left.length === 1 && left[0].labels.__scalar__) {
			const scalar = left[0];
			return right.map((series) => ({
				labels: series.labels,
				points: series.points.map((point, index) => ({
					at: point.at,
					value: operate(scalar.points[index]?.value ?? scalar.points[0]?.value ?? 0, point.value)
				}))
			}));
		}

		const byKey = new Map(right.map((series) => [JSON.stringify(series.labels), series]));

		return left.flatMap((series) => {
			const other = byKey.get(JSON.stringify(series.labels)) ?? right[0];
			if (!other) return [];

			return [
				{
					labels: series.labels,
					points: series.points.map((point, index) => ({
						at: point.at,
						value: operate(point.value, other.points[index]?.value ?? 0)
					}))
				}
			];
		});
	}

	#term(tokens: Tokens, at: number[]): EvalSeries[] {
		tokens.skip();

		if (tokens.peek('(')) {
			const inner = tokens.takeBalanced();
			const nested = new Tokens(inner);
			const result = this.#expression(nested, at);
			if (!nested.done) throw new Error(`Unparsed group: ${nested.rest.slice(0, 40)}`);
			return result;
		}

		const number = tokens.takeWhile(/[\d.]/);
		if (number) return [this.#scalar(Number(number), at)];

		const name = tokens.takeWhile(/[a-zA-Z_:]/);

		switch (name) {
			case 'vector':
				return [this.#scalar(Number(tokens.takeBalanced().trim()), at)];

			case 'clamp_min': {
				const [expression, floor] = splitTop(tokens.takeBalanced());
				const series = this.#evaluateInner(expression, at);
				const minimum = Number(floor);

				return series.map((one) => ({
					labels: one.labels,
					points: one.points.map((point) => ({
						at: point.at,
						value: Math.max(point.value, minimum)
					}))
				}));
			}

			case 'histogram_quantile': {
				const [q, inner] = splitTop(tokens.takeBalanced());
				return this.#histogramQuantile(Number(q), this.#evaluateInner(inner, at), at);
			}

			case 'sum':
			case 'avg': {
				const by = tokens.take('by') ? splitLabels(tokens.takeBalanced()) : [];
				const series = this.#evaluateInner(tokens.takeBalanced(), at);
				return this.#aggregate(series, by, name === 'avg', at);
			}

			case 'rate':
			case 'increase': {
				const inner = tokens.takeBalanced();
				return this.#rangeFunction(inner, at, name === 'rate');
			}

			default: {
				// A bare selector, e.g. `up{service="x"}`.
				if (!name) throw new Error(`Unsupported expression at: ${tokens.rest.slice(0, 40)}`);
				return this.#selector(name + tokens.takeBraces(), at);
			}
		}
	}

	#evaluateInner(text: string, at: number[]): EvalSeries[] {
		const tokens = new Tokens(text);
		const result = this.#expression(tokens, at);
		if (!tokens.done) throw new Error(`Unparsed inner: ${tokens.rest.slice(0, 40)}`);
		return result;
	}

	#scalar(value: number, at: number[]): EvalSeries {
		return { labels: { __scalar__: 'true' }, points: at.map((one) => ({ at: one, value })) };
	}

	/** Sample a stored series at a wall-clock second, holding the last known value. */
	#sampleAt(series: MockSeries, second: number): number {
		const first = this.#timestamps[0];
		const index = Math.round((second - first) / this.#estate.stepSeconds);
		const clamped = Math.min(Math.max(index, 0), series.values.length - 1);
		return series.values[clamped] ?? 0;
	}

	#selector(text: string, at: number[]): EvalSeries[] {
		const { name, matchers } = parseSelector(text);

		return this.#estate.series
			.filter((series) => matches(series, name, matchers))
			.map((series) => ({
				labels: labelsWithout(series.labels, ['__name__']),
				points: at.map((second) => ({ at: second, value: this.#sampleAt(series, second) }))
			}));
	}

	/**
	 * `rate` and `increase` over a stored counter.
	 *
	 * The mock's counters are stored as per-interval values rather than as monotonic
	 * totals, so a rate is the value itself scaled to per-second and an increase is the
	 * value across the window. That is a simplification of Prometheus, and it is stated
	 * here rather than hidden: what the adapter is being tested on is whether it asks for
	 * the right series with the right grouping, not whether it can re-derive counters.
	 */
	#rangeFunction(inner: string, at: number[], perSecond: boolean): EvalSeries[] {
		const windowAt = inner.lastIndexOf('[');
		const selectorText = inner.slice(0, windowAt);
		const window = inner.slice(windowAt + 1, inner.lastIndexOf(']'));
		const seconds = durationSeconds(window);

		return this.#selector(selectorText, at).map((series) => ({
			labels: series.labels,
			points: series.points.map((point) => ({
				at: point.at,
				value: perSecond ? point.value / 60 : point.value * (seconds / 60)
			}))
		}));
	}

	#aggregate(series: EvalSeries[], by: string[], mean: boolean, at: number[]): EvalSeries[] {
		if (series.length === 0) return [];

		const groups = new Map<string, EvalSeries[]>();

		for (const one of series) {
			const key = groupKey(one.labels, by);
			const existing = groups.get(key);
			if (existing) existing.push(one);
			else groups.set(key, [one]);
		}

		return [...groups.values()].map((members) => {
			const labels: Record<string, string> = {};
			for (const key of by) labels[key] = members[0].labels[key] ?? '';

			return {
				labels,
				points: at.map((second, index) => {
					const total = members.reduce((sum, one) => sum + (one.points[index]?.value ?? 0), 0);
					return { at: second, value: mean ? total / members.length : total };
				})
			};
		});
	}

	#histogramQuantile(q: number, series: EvalSeries[], at: number[]): EvalSeries[] {
		// Everything except `le` identifies the output group, which is how
		// `sum by (le, http_route)` yields one quantile per route.
		const groups = new Map<string, EvalSeries[]>();

		for (const one of series) {
			const key = JSON.stringify(labelsWithout(one.labels, ['le']));
			const existing = groups.get(key);
			if (existing) existing.push(one);
			else groups.set(key, [one]);
		}

		return [...groups.entries()].map(([key, members]) => ({
			labels: JSON.parse(key) as Record<string, string>,
			points: at.map((second, index) => ({
				at: second,
				value: quantile(
					q,
					members.map((one) => ({
						le: Number(one.labels.le === '+Inf' ? Infinity : one.labels.le),
						count: one.points[index]?.value ?? 0
					}))
				)
			}))
		}));
	}
}

/** Split `a, b` at the top level, respecting parens and quotes. */
function splitTop(text: string): [string, string] {
	let depth = 0;
	let quoted = false;

	for (let index = 0; index < text.length; index++) {
		const char = text[index];

		if (quoted) {
			if (char === '\\') index++;
			else if (char === '"') quoted = false;
		} else if (char === '"') quoted = true;
		else if (char === '(' || char === '{') depth++;
		else if (char === ')' || char === '}') depth--;
		else if (char === ',' && depth === 0) {
			return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
		}
	}

	return [text.trim(), ''];
}

function splitLabels(text: string): string[] {
	return text
		.split(',')
		.map((one) => one.trim())
		.filter(Boolean);
}

function durationSeconds(window: string): number {
	const found = /^(\d+)([smhd])$/.exec(window.trim());
	if (!found) throw new Error(`Unsupported duration: ${window}`);

	const size = Number(found[1]);
	return size * { s: 1, m: 60, h: 3600, d: 86_400 }[found[2] as 's' | 'm' | 'h' | 'd'];
}
