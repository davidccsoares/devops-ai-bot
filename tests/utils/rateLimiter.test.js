const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { RateLimiter } = require("../../utils/rateLimiter");

describe("RateLimiter", () => {
  it("allows requests under the limit", () => {
    const limiter = new RateLimiter({ max: 5, windowMs: 60000 });
    const result = limiter.check();
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 4);
  });

  it("rejects requests over the limit", () => {
    const limiter = new RateLimiter({ max: 3, windowMs: 60000 });
    limiter.check();
    limiter.check();
    limiter.check();
    const result = limiter.check();
    assert.equal(result.allowed, false);
    assert.equal(result.remaining, 0);
    assert.ok(result.retryAfterMs > 0);
  });

  it("tracks count correctly", () => {
    const limiter = new RateLimiter({ max: 10, windowMs: 60000 });
    assert.equal(limiter.count, 0);
    limiter.check();
    limiter.check();
    assert.equal(limiter.count, 2);
  });

  it("resets the limiter", () => {
    const limiter = new RateLimiter({ max: 2, windowMs: 60000 });
    limiter.check();
    limiter.check();
    assert.equal(limiter.count, 2);
    limiter.reset();
    assert.equal(limiter.count, 0);
    const result = limiter.check();
    assert.equal(result.allowed, true);
  });

  it("uses default max and windowMs", () => {
    const limiter = new RateLimiter();
    // Should allow at least one request with defaults
    const result = limiter.check();
    assert.equal(result.allowed, true);
    assert.equal(result.remaining, 59); // DEFAULT_MAX is 60
  });

  it("remaining counts down correctly", () => {
    const limiter = new RateLimiter({ max: 3, windowMs: 60000 });
    assert.equal(limiter.check().remaining, 2);
    assert.equal(limiter.check().remaining, 1);
    assert.equal(limiter.check().remaining, 0);
  });
});
