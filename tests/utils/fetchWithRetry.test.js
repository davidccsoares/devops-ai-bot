const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("fetchWithRetry", () => {
  let fetchWithRetry;
  let originalFetch;

  beforeEach(() => {
    // Save original global fetch
    originalFetch = global.fetch;
    // Clear module cache so each test gets fresh state
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ fetchWithRetry } = require("../../utils/fetchWithRetry"));
  });

  afterEach(() => {
    // Restore
    global.fetch = originalFetch;
  });

  it("returns the response on a successful first attempt", async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
    });

    const res = await fetchWithRetry("http://example.com", {}, {
      maxRetries: 3,
      timeoutMs: 5000,
    });
    assert.equal(res.status, 200);
  });

  it("retries on 500 and succeeds on second attempt", async () => {
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      if (callCount === 1) {
        return { ok: false, status: 500 };
      }
      return { ok: true, status: 200 };
    };

    const res = await fetchWithRetry("http://example.com", {}, {
      maxRetries: 3,
      timeoutMs: 5000,
      baseDelayMs: 10,
    });
    assert.equal(res.status, 200);
    assert.equal(callCount, 2);
  });

  it("retries on 429 (rate limit)", async () => {
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      if (callCount <= 2) {
        return { ok: false, status: 429 };
      }
      return { ok: true, status: 200 };
    };

    const res = await fetchWithRetry("http://example.com", {}, {
      maxRetries: 3,
      timeoutMs: 5000,
      baseDelayMs: 10,
    });
    assert.equal(res.status, 200);
    assert.equal(callCount, 3);
  });

  it("does NOT retry on 400 (client error)", async () => {
    let callCount = 0;
    global.fetch = async () => {
      callCount++;
      return { ok: false, status: 400 };
    };

    const res = await fetchWithRetry("http://example.com", {}, {
      maxRetries: 3,
      timeoutMs: 5000,
      baseDelayMs: 10,
    });
    assert.equal(res.status, 400);
    assert.equal(callCount, 1);
  });

  it("throws after all retries exhausted", async () => {
    global.fetch = async () => ({
      ok: false,
      status: 503,
    });

    await assert.rejects(
      () => fetchWithRetry("http://example.com", {}, {
        maxRetries: 2,
        timeoutMs: 5000,
        baseDelayMs: 10,
      }),
      (err) => {
        assert.match(err.message, /HTTP 503/);
        return true;
      }
    );
  });

  it("handles timeout (abort) and retries", async () => {
    let callCount = 0;
    global.fetch = async (url, opts) => {
      callCount++;
      if (callCount === 1) {
        // Simulate a hang — wait for abort signal
        return new Promise((resolve, reject) => {
          if (opts.signal) {
            opts.signal.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          }
        });
      }
      return { ok: true, status: 200 };
    };

    const res = await fetchWithRetry("http://example.com", {}, {
      maxRetries: 3,
      timeoutMs: 50,
      baseDelayMs: 10,
    });
    assert.equal(res.status, 200);
    assert.equal(callCount, 2);
  });
});
