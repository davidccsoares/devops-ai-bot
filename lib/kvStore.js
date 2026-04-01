/**
 * In-memory key-value store with per-key TTL.
 *
 * Replaces Cloudflare Workers KV for data that doesn't need cross-restart
 * persistence (review issue tracking, doc caching, rate counters).
 *
 * For truly persistent data (flaky-detective 14-day window), consider
 * swapping this out for Azure Table Storage — the API surface is identical.
 */

const DEFAULT_TTL_SEC = 3600; // 1 hour
const PRUNE_INTERVAL_MS = 60_000;
const MAX_ENTRIES = 5000;

class KVStore {
  constructor() {
    /** @type {Map<string, { value: string, expiry: number }>} */
    this._store = new Map();

    this._pruneTimer = setInterval(() => this._prune(), PRUNE_INTERVAL_MS);
    if (this._pruneTimer.unref) this._pruneTimer.unref();
  }

  /**
   * Get a value by key. Returns null if expired or missing.
   * @param {string} key
   * @param {"json"|"text"} [type="text"]
   * @returns {*}
   */
  get(key, type) {
    const entry = this._store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this._store.delete(key);
      return null;
    }
    if (type === "json") {
      try {
        return JSON.parse(entry.value);
      } catch {
        return null;
      }
    }
    return entry.value;
  }

  /**
   * Set a value with optional TTL.
   * @param {string} key
   * @param {string} value
   * @param {{ expirationTtl?: number }} [opts]
   */
  put(key, value, opts = {}) {
    const ttlSec = opts.expirationTtl || DEFAULT_TTL_SEC;
    // Evict oldest if at capacity.
    if (this._store.size >= MAX_ENTRIES && !this._store.has(key)) {
      const oldest = this._store.keys().next().value;
      this._store.delete(oldest);
    }
    this._store.set(key, {
      value: typeof value === "string" ? value : String(value),
      expiry: Date.now() + ttlSec * 1000,
    });
  }

  /**
   * List keys matching a prefix.
   * @param {{ prefix?: string, limit?: number }} [opts]
   * @returns {{ keys: Array<{ name: string }>, list_complete: boolean }}
   */
  list(opts = {}) {
    const { prefix = "", limit = 1000 } = opts;
    this._prune();
    const keys = [];
    for (const key of this._store.keys()) {
      if (key.startsWith(prefix)) {
        keys.push({ name: key });
        if (keys.length >= limit) {
          return { keys, list_complete: false, cursor: key };
        }
      }
    }
    return { keys, list_complete: true };
  }

  /**
   * Delete a key.
   * @param {string} key
   */
  delete(key) {
    this._store.delete(key);
  }

  /** Remove all expired entries. */
  _prune() {
    const now = Date.now();
    for (const [key, entry] of this._store) {
      if (now > entry.expiry) this._store.delete(key);
    }
  }

  /** Destroy the store and stop the prune timer. */
  destroy() {
    if (this._pruneTimer) {
      clearInterval(this._pruneTimer);
      this._pruneTimer = null;
    }
    this._store.clear();
  }
}

// Singleton instance — shared across all functions in the same process.
const kvStore = new KVStore();

module.exports = { KVStore, kvStore };
