const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { KVStore } = require("../../lib/kvStore");

describe("KVStore", () => {
  let kv;

  afterEach(() => {
    if (kv) kv.destroy();
  });

  it("stores and retrieves a string value", () => {
    kv = new KVStore();
    kv.put("key1", "value1");
    assert.strictEqual(kv.get("key1"), "value1");
  });

  it("returns null for missing key", () => {
    kv = new KVStore();
    assert.strictEqual(kv.get("nonexistent"), null);
  });

  it("retrieves JSON when type is 'json'", () => {
    kv = new KVStore();
    kv.put("obj", JSON.stringify({ a: 1, b: "two" }));
    const result = kv.get("obj", "json");
    assert.deepStrictEqual(result, { a: 1, b: "two" });
  });

  it("returns null for invalid JSON with type 'json'", () => {
    kv = new KVStore();
    kv.put("bad", "not-json{");
    assert.strictEqual(kv.get("bad", "json"), null);
  });

  it("expires entries after TTL", () => {
    kv = new KVStore();
    // Put with 0 TTL — should expire immediately
    kv.put("expiring", "value", { expirationTtl: 0 });
    // Force time past expiry
    const entry = kv._store.get("expiring");
    entry.expiry = Date.now() - 1;
    assert.strictEqual(kv.get("expiring"), null);
  });

  it("deletes a key", () => {
    kv = new KVStore();
    kv.put("key", "val");
    kv.delete("key");
    assert.strictEqual(kv.get("key"), null);
  });

  it("lists keys by prefix", () => {
    kv = new KVStore();
    kv.put("review:1", "a");
    kv.put("review:2", "b");
    kv.put("flaky:1", "c");
    const result = kv.list({ prefix: "review:" });
    assert.strictEqual(result.keys.length, 2);
    assert.ok(result.keys.every((k) => k.name.startsWith("review:")));
  });

  it("respects list limit", () => {
    kv = new KVStore();
    for (let i = 0; i < 10; i++) kv.put(`k${i}`, `v${i}`);
    const result = kv.list({ limit: 3 });
    assert.strictEqual(result.keys.length, 3);
    assert.strictEqual(result.list_complete, false);
  });

  it("evicts oldest when at MAX_ENTRIES", () => {
    kv = new KVStore();
    // Fill to capacity
    for (let i = 0; i < 5000; i++) kv.put(`key${i}`, `val${i}`);
    // Add one more — should evict the oldest
    kv.put("new_key", "new_val");
    assert.strictEqual(kv.get("new_key"), "new_val");
    assert.strictEqual(kv.get("key0"), null); // evicted
  });

  it("converts non-string values to string", () => {
    kv = new KVStore();
    kv.put("num", 42);
    assert.strictEqual(kv.get("num"), "42");
  });

  it("destroy clears store and stops timer", () => {
    kv = new KVStore();
    kv.put("key", "val");
    kv.destroy();
    assert.strictEqual(kv._store.size, 0);
    assert.strictEqual(kv._pruneTimer, null);
  });
});
