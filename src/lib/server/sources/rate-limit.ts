/**
 * A token bucket per connection.
 *
 * Caching lowers how often we ask; it does not cap it. Eight instances starting cold
 * after a deploy miss on everything at once, and a cache only helps when it happens to be
 * warm — so a limiter is what makes exceeding a documented rate limit *impossible* rather
 * than merely unlikely.
 *
 * Waits rather than rejects. A panel that renders a second late is a far better outcome
 * than one that fails, and than an upstream that starts returning 429 to everything
 * because we spent the budget in the first hundred milliseconds.
 */

export interface RateLimitOptions {
	/** Sustained calls allowed per second. */
	perSecond: number;
	/**
	 * How much unused budget can accumulate.
	 *
	 * A burst is what makes a page of eight panels load at once rather than over eight
	 * seconds — the sustained rate is what the upstream cares about.
	 */
	burst?: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

interface Bucket {
	tokens: number;
	at: number;
}

export class RateLimiter {
	readonly #buckets = new Map<string, Bucket>();
	readonly #perSecond: number;
	readonly #burst: number;
	readonly #now: () => number;
	readonly #sleep: (ms: number) => Promise<void>;

	constructor(options: RateLimitOptions) {
		this.#perSecond = Math.max(options.perSecond, 0.001);
		this.#burst = options.burst ?? Math.max(Math.ceil(options.perSecond), 1);
		this.#now = options.now ?? Date.now;
		this.#sleep = options.sleep ?? Bun.sleep;
	}

	/** Tokens available now, refilled for the time that has passed. */
	#refill(connectionId: string): Bucket {
		const now = this.#now();
		const bucket = this.#buckets.get(connectionId) ?? { tokens: this.#burst, at: now };

		const gained = ((now - bucket.at) / 1000) * this.#perSecond;
		bucket.tokens = Math.min(this.#burst, bucket.tokens + gained);
		bucket.at = now;

		this.#buckets.set(connectionId, bucket);
		return bucket;
	}

	/**
	 * Take a token, waiting for one if the bucket is empty.
	 *
	 * Deliberately not fair: several waiters wake in whatever order their timers fire.
	 * Fairness would need a queue, and the thing being protected is a rate, not an order.
	 */
	async take(connectionId: string): Promise<void> {
		for (;;) {
			const bucket = this.#refill(connectionId);

			if (bucket.tokens >= 1) {
				bucket.tokens -= 1;
				return;
			}

			// Sleep for exactly as long as one token takes to appear, so a caller neither
			// spins nor overshoots.
			const waitMs = Math.ceil(((1 - bucket.tokens) / this.#perSecond) * 1000);
			await this.#sleep(Math.max(waitMs, 1));
		}
	}

	/** Tokens currently available. For tests and diagnostics. */
	available(connectionId: string): number {
		return this.#refill(connectionId).tokens;
	}
}

/**
 * Limiters keyed by connection, each with its own budget.
 *
 * Per connection rather than global: two Coralogix accounts have two separate quotas, and
 * one busy dashboard must not spend the other's.
 */
export class ConnectionLimits {
	readonly #limiters = new Map<string, RateLimiter>();
	readonly #defaults: RateLimitOptions;

	constructor(defaults: RateLimitOptions) {
		this.#defaults = defaults;
	}

	/** Give one connection its own budget, overriding the default. */
	configure(connectionId: string, options: RateLimitOptions): void {
		this.#limiters.set(connectionId, new RateLimiter(options));
	}

	async take(connectionId: string): Promise<void> {
		let limiter = this.#limiters.get(connectionId);

		if (!limiter) {
			limiter = new RateLimiter(this.#defaults);
			this.#limiters.set(connectionId, limiter);
		}

		await limiter.take(connectionId);
	}
}
