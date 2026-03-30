/**
 * Lightweight in-memory deduplication cache to prevent processing
 * the same webhook event twice (Azure DevOps can fire duplicates).
 *
 * Uses a Map with TTL-based expiry. Entries are lazily cleaned up
 * on each `has()` / `add()` call, and optionally pruned on a periodic
 * interval to keep memory tidy between traffic bursts.
 */

/** Default time-to-live for cache entries (5 minutes). */
const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** Maximum number of entries before forced eviction of oldest. */
const MAX_ENTRIES = 1000;

/** Default periodic prune interval (60 seconds). Set to 0 to disable. */
const DEFAULT_PRUNE_INTERVAL_MS = 60 * 1000;

class DedupCache {
  /**
   * @param {number} [ttlMs]             - Time-to-live for each entry in milliseconds.
   * @param {number} [pruneIntervalMs]   - Periodic prune interval (0 to disable).
   */
  constructor(ttlMs, pruneIntervalMs) {
    this.ttlMs = ttlMs || DEFAULT_TTL_MS;
    /** @type {Map<string, number>} key → expiry timestamp */
    this._cache = new Map();

    const interval =
      pruneIntervalMs !== undefined ? pruneIntervalMs : DEFAULT_PRUNE_INTERVAL_MS;
    this._pruneTimer = null;
    if (interval > 0) {
      this._pruneTimer = setInterval(() => this._prune(), interval);
      // Allow the Node process to exit even if the timer is still running.
      if (this._pruneTimer.unref) {
        this._pruneTimer.unref();
      }
    }
  }

  /**
   * Returns true if the key was seen recently (within TTL).
   * Also lazily prunes expired entries.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    this._prune();
    const expiry = this._cache.get(key);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this._cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Adds a key to the cache with TTL-based expiry.
   *
   * @param {string} key
   */
  add(key) {
    this._prune();
    // If at capacity, delete the oldest entry (first inserted).
    if (this._cache.size >= MAX_ENTRIES) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(key, Date.now() + this.ttlMs);
  }

  /** Removes all entries from the cache. */
  clear() {
    this._cache.clear();
  }

  /** Stops the periodic prune timer and clears the cache. */
  destroy() {
    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }
    this.clear();
  }

  /** @returns {number} Current number of entries. */
  get size() {
    return this._cache.size;
  }

  /** Removes expired entries. */
  _prune() {
    const now = Date.now();
    for (const [key, expiry] of this._cache) {
      if (now > expiry) {
        this._cache.delete(key);
      }
    }
  }
}

module.exports = { DedupCache, DEFAULT_TTL_MS, MAX_ENTRIES, DEFAULT_PRUNE_INTERVAL_MS };
