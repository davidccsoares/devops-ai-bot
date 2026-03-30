/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Tracks timestamps of recent requests and rejects new ones when the count
 * within the sliding window exceeds the configured maximum.
 *
 * Designed for a single-instance Azure Function; not suitable for
 * multi-instance deployments (use a shared store like Redis for that).
 */

/** Default: 60 requests per window. */
const DEFAULT_MAX = 60;

/** Default window: 60 seconds. */
const DEFAULT_WINDOW_MS = 60 * 1000;

class RateLimiter {
  /**
   * @param {object} [opts]
   * @param {number} [opts.max]       - Maximum requests allowed within the window.
   * @param {number} [opts.windowMs]  - Sliding window size in milliseconds.
   */
  constructor({ max, windowMs } = {}) {
    this.max = max || DEFAULT_MAX;
    this.windowMs = windowMs || DEFAULT_WINDOW_MS;
    /** @type {number[]} Timestamps of recent requests. */
    this._timestamps = [];
  }

  /**
   * Records a request and returns whether it is allowed.
   *
   * @returns {{ allowed: boolean, remaining: number, retryAfterMs?: number }}
   */
  check() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    // Prune timestamps outside the window.
    this._timestamps = this._timestamps.filter((t) => t > windowStart);

    if (this._timestamps.length >= this.max) {
      // Oldest timestamp in the window — how long until it expires.
      const retryAfterMs = this._timestamps[0] - windowStart;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(retryAfterMs, 1),
      };
    }

    this._timestamps.push(now);
    return {
      allowed: true,
      remaining: this.max - this._timestamps.length,
    };
  }

  /** Resets the limiter (useful for testing). */
  reset() {
    this._timestamps = [];
  }

  /** @returns {number} Current number of requests in the window. */
  get count() {
    return this._timestamps.length;
  }
}

module.exports = { RateLimiter, DEFAULT_MAX, DEFAULT_WINDOW_MS };
