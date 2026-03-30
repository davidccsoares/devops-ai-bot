const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("healthCheck", () => {
  const originalEnv = { ...process.env };
  let handler;

  function makeContext() {
    const logs = [];
    const ctx = {
      log: (...args) => logs.push(args.join(" ")),
      res: null,
      _logs: logs,
    };
    ctx.log.warn = (...args) => logs.push("[WARN] " + args.join(" "));
    ctx.log.error = (...args) => logs.push("[ERROR] " + args.join(" "));
    return ctx;
  }

  beforeEach(() => {
    process.env.AZURE_DEVOPS_ORG = "https://dev.azure.com/test";
    process.env.AZURE_DEVOPS_PAT = "test-pat";
    process.env.AI_API_URL = "https://fake-ai.test/v1/chat/completions";
    process.env.AI_API_KEY = "test-key";

    // Clear require caches for fresh module load
    delete require.cache[require.resolve("../healthCheck")];
    delete require.cache[require.resolve("../utils/validateEnv")];
    handler = require("../healthCheck");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    delete require.cache[require.resolve("../healthCheck")];
    delete require.cache[require.resolve("../utils/validateEnv")];
  });

  it("returns 200 when all env vars are set", async () => {
    const ctx = makeContext();
    await handler(ctx);
    assert.equal(ctx.res.status, 200);
    assert.equal(ctx.res.body.status, "healthy");
    assert.ok(ctx.res.body.uptime >= 0, "Expected uptime to be a number");
    assert.ok(ctx.res.body.timestamp, "Expected a timestamp");
    assert.ok(ctx.res.body.version, "Expected a version string");
  });

  it("returns 503 when a required env var is missing", async () => {
    delete process.env.AZURE_DEVOPS_PAT;

    // Re-require to pick up the env change (validateEnv reads on each call)
    delete require.cache[require.resolve("../healthCheck")];
    delete require.cache[require.resolve("../utils/validateEnv")];
    handler = require("../healthCheck");

    const ctx = makeContext();
    await handler(ctx);
    assert.equal(ctx.res.status, 503);
    assert.equal(ctx.res.body.status, "unhealthy");
    assert.ok(ctx.res.body.error);
    assert.ok(ctx.res.body.uptime >= 0);
  });

  it("returns Content-Type application/json", async () => {
    const ctx = makeContext();
    await handler(ctx);
    assert.equal(ctx.res.headers["Content-Type"], "application/json");
  });

  it("returns a valid ISO timestamp", async () => {
    const ctx = makeContext();
    await handler(ctx);
    const ts = new Date(ctx.res.body.timestamp);
    assert.ok(!isNaN(ts.getTime()), "Expected timestamp to be a valid date");
  });
});
