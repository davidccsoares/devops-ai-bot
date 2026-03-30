const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { structuredLog } = require("../../utils/structuredLog");

describe("structuredLog", () => {
  function makeContext(correlationId) {
    const logs = [];
    const log = (...args) => logs.push(["log", ...args]);
    log.warn = (...args) => logs.push(["warn", ...args]);
    log.error = (...args) => logs.push(["error", ...args]);
    return { log, logs, correlationId };
  }

  it("emits a JSON string with event and timestamp", () => {
    const ctx = makeContext("abc-123");
    structuredLog(ctx, "test_event", { foo: "bar" });

    assert.equal(ctx.logs.length, 1);
    const [level, raw] = ctx.logs[0];
    assert.equal(level, "log");

    const parsed = JSON.parse(raw);
    assert.equal(parsed.event, "test_event");
    assert.equal(parsed.correlationId, "abc-123");
    assert.equal(parsed.foo, "bar");
    assert.ok(parsed.timestamp);
  });

  it("uses warn level when specified", () => {
    const ctx = makeContext();
    structuredLog(ctx, "warn_event", {}, "warn");
    assert.equal(ctx.logs[0][0], "warn");
  });

  it("uses error level when specified", () => {
    const ctx = makeContext();
    structuredLog(ctx, "error_event", {}, "error");
    assert.equal(ctx.logs[0][0], "error");
  });

  it("omits correlationId when not on context", () => {
    const ctx = makeContext(); // no correlationId
    structuredLog(ctx, "no_corr");
    const parsed = JSON.parse(ctx.logs[0][1]);
    assert.equal(parsed.correlationId, undefined);
  });

  it("includes additional data fields", () => {
    const ctx = makeContext("x");
    structuredLog(ctx, "data_event", { durationMs: 42, status: 200 });
    const parsed = JSON.parse(ctx.logs[0][1]);
    assert.equal(parsed.durationMs, 42);
    assert.equal(parsed.status, 200);
  });
});
