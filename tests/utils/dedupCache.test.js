const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { DedupCache, MAX_ENTRIES } = require("../../utils/dedupCache");

describe("DedupCache", () => {
  it("returns false for unseen keys", () => {
    const cache = new DedupCache(60000);
    assert.strictEqual(cache.has("key1"), false);
  });

  it("returns true for recently added keys", () => {
    const cache = new DedupCache(60000);
    cache.add("key1");
    assert.strictEqual(cache.has("key1"), true);
  });

  it("expires entries after TTL", () => {
    // Use a very short TTL
    const cache = new DedupCache(1);
    cache.add("key1");
    // Manually set expiry to the past
    cache._cache.set("key1", Date.now() - 100);
    assert.strictEqual(cache.has("key1"), false);
  });

  it("tracks size correctly", () => {
    const cache = new DedupCache(60000);
    assert.strictEqual(cache.size, 0);
    cache.add("a");
    cache.add("b");
    assert.strictEqual(cache.size, 2);
  });

  it("evicts oldest entry when at MAX_ENTRIES", () => {
    const cache = new DedupCache(60000);
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
    const cache = new DedupCache(60000);
    cache.add("key1");
    cache.add("key1"); // re-add
    assert.strictEqual(cache.size, 1);
  });
});
