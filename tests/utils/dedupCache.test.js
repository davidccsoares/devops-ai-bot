const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DedupCache, MAX_ENTRIES } = require("../../utils/dedupCache");

describe("DedupCache", () => {
  // Pass pruneIntervalMs=0 to disable the periodic timer in tests.

  it("returns false for unseen keys", () => {
    const cache = new DedupCache(60000, 0);
    assert.strictEqual(cache.has("key1"), false);
  });

  it("returns true for recently added keys", () => {
    const cache = new DedupCache(60000, 0);
    cache.add("key1");
    assert.strictEqual(cache.has("key1"), true);
  });

  it("expires entries after TTL", () => {
    // Use a very short TTL
    const cache = new DedupCache(1, 0);
    cache.add("key1");
    // Manually set expiry to the past
    cache._cache.set("key1", Date.now() - 100);
    assert.strictEqual(cache.has("key1"), false);
  });

  it("tracks size correctly", () => {
    const cache = new DedupCache(60000, 0);
    assert.strictEqual(cache.size, 0);
    cache.add("a");
    cache.add("b");
    assert.strictEqual(cache.size, 2);
  });

  it("evicts oldest entry when at MAX_ENTRIES", () => {
    const cache = new DedupCache(60000, 0);
    // Fill to max
    for (let i = 0; i < MAX_ENTRIES; i++) {
      cache.add(`key-${i}`);
    }
    assert.strictEqual(cache.size, MAX_ENTRIES);

    // Adding one more should evict the first
    cache.add("new-key");
    assert.strictEqual(cache.size, MAX_ENTRIES);
    assert.strictEqual(cache.has("key-0"), false); // evicted
    assert.strictEqual(cache.has("new-key"), true);
  });

  it("does not duplicate entries on re-add", () => {
    const cache = new DedupCache(60000, 0);
    cache.add("key1");
    cache.add("key1"); // re-add
    assert.strictEqual(cache.size, 1);
  });

  it("clear() removes all entries", () => {
    const cache = new DedupCache(60000, 0);
    cache.add("a");
    cache.add("b");
    cache.add("c");
    assert.strictEqual(cache.size, 3);
    cache.clear();
    assert.strictEqual(cache.size, 0);
    assert.strictEqual(cache.has("a"), false);
  });

  it("destroy() stops the timer and clears entries", () => {
    // Use a real prune interval to verify destroy stops it.
    const cache = new DedupCache(60000, 100);
    cache.add("a");
    cache.destroy();
    assert.strictEqual(cache.size, 0);
    assert.strictEqual(cache._pruneTimer, null);
  });

  it("works without periodic pruning when pruneIntervalMs is 0", () => {
    const cache = new DedupCache(60000, 0);
    assert.strictEqual(cache._pruneTimer, null);
    cache.add("key1");
    assert.strictEqual(cache.has("key1"), true);
  });
});
