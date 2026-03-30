const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("index.js router", () => {
  let handler;

  // Minimal Azure Function context mock
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
    // Set required env vars so validateEnv() doesn't throw on require
    process.env.AZURE_DEVOPS_ORG = "https://dev.azure.com/test";
    process.env.AZURE_DEVOPS_PAT = "test-pat";
    process.env.AI_API_URL = "https://fake-ai.test/v1/chat/completions";
    process.env.AI_API_KEY = "test-key";

    // Clear require cache so we get a fresh module
    delete require.cache[require.resolve("../index")];
    // Mock the handler modules to avoid real AI/DevOps calls
    const mockAnalyze = async () => ({ mock: "analyzeTicket" });
    const mockEstimate = async () => ({ mock: "estimateTime" });

    require.cache[require.resolve("../functions/ticketAnalyzer")] = {
      id: require.resolve("../functions/ticketAnalyzer"),
      filename: require.resolve("../functions/ticketAnalyzer"),
      loaded: true,
      exports: { analyzeTicket: mockAnalyze },
    };
    require.cache[require.resolve("../functions/timeEstimator")] = {
      id: require.resolve("../functions/timeEstimator"),
      filename: require.resolve("../functions/timeEstimator"),
      loaded: true,
      exports: { estimateTime: mockEstimate },
    };

    handler = require("../index");
  });

  afterEach(() => {
    delete require.cache[require.resolve("../index")];
    delete require.cache[require.resolve("../functions/ticketAnalyzer")];
    delete require.cache[require.resolve("../functions/timeEstimator")];
    delete process.env.WEBHOOK_SECRET;
  });

  it("returns 400 for missing body", async () => {
    const ctx = makeContext();
    await handler(ctx, { body: null });
    assert.equal(ctx.res.status, 400);
    assert.match(ctx.res.body.error, /Missing eventType/);
    assert.ok(ctx.res.headers["X-Correlation-Id"], "Expected X-Correlation-Id header");
  });

  it("returns 400 for missing eventType", async () => {
    const ctx = makeContext();
    await handler(ctx, { body: { foo: "bar" } });
    assert.equal(ctx.res.status, 400);
    assert.ok(ctx.res.headers["X-Correlation-Id"], "Expected X-Correlation-Id header");
  });

  it("routes workitem.created to ticket analyzer", async () => {
    const ctx = makeContext();
    await handler(ctx, {
      body: {
        eventType: "workitem.created",
        resource: { id: 1, fields: { "System.Title": "Test" } },
      },
    });
    assert.equal(ctx.res.status, 200);
    assert.deepEqual(ctx.res.body, { mock: "analyzeTicket" });
    assert.ok(ctx.res.headers["X-Correlation-Id"], "Expected X-Correlation-Id header");
  });

  it("routes workitem.updated to time estimator", async () => {
    const ctx = makeContext();
    // Has resource.id but no resource.fields → can't determine relevance, should process anyway
    await handler(ctx, {
      body: {
        eventType: "workitem.updated",
        resource: { id: 42 },
      },
    });
    assert.equal(ctx.res.status, 200);
    assert.deepEqual(ctx.res.body, { mock: "estimateTime" });
  });

  it("routes workitem.updated when Title changed", async () => {
    const ctx = makeContext();
    await handler(ctx, {
      body: {
        eventType: "workitem.updated",
        resource: {
          id: 42,
          fields: {
            "System.Title": { oldValue: "Old title", newValue: "New title" },
          },
        },
      },
    });
    assert.equal(ctx.res.status, 200);
    assert.deepEqual(ctx.res.body, { mock: "estimateTime" });
  });

  it("skips workitem.updated when only irrelevant fields changed", async () => {
    const ctx = makeContext();
    await handler(ctx, {
      body: {
        eventType: "workitem.updated",
        resource: {
          id: 42,
          fields: {
            "System.State": { oldValue: "New", newValue: "Active" },
            "System.AssignedTo": { oldValue: "", newValue: "john@example.com" },
          },
        },
      },
    });
    assert.equal(ctx.res.status, 200);
    assert.match(ctx.res.body.message, /skipped/);
  });

  it("returns 200 with message for unhandled event types", async () => {
    const ctx = makeContext();
    await handler(ctx, { body: { eventType: "some.unknown.event" } });
    assert.equal(ctx.res.status, 200);
    assert.match(ctx.res.body.message, /not handled/);
  });

  it("returns 500 when a handler throws", async () => {
    // Override one handler to throw
    require.cache[require.resolve("../functions/ticketAnalyzer")].exports = {
      analyzeTicket: async () => { throw new Error("boom"); },
    };
    delete require.cache[require.resolve("../index")];
    handler = require("../index");

    const ctx = makeContext();
    await handler(ctx, {
      body: {
        eventType: "workitem.created",
        resource: { id: 1 },
      },
    });
    assert.equal(ctx.res.status, 500);
    assert.ok(ctx.res.body.error);
    assert.ok(ctx.res.headers["X-Correlation-Id"], "Expected X-Correlation-Id header on 500");
  });

  it("returns 400 when workitem payload has no resource", async () => {
    const ctx = makeContext();
    await handler(ctx, { body: { eventType: "workitem.created" } });
    assert.equal(ctx.res.status, 400);
    assert.ok(ctx.res.body.error.includes("resource"));
  });

  it("returns 400 when workitem payload has no resource id", async () => {
    const ctx = makeContext();
    await handler(ctx, {
      body: { eventType: "workitem.created", resource: { fields: {} } },
    });
    assert.equal(ctx.res.status, 400);
    assert.ok(ctx.res.body.error.includes("id"));
  });

  it("returns 401 when WEBHOOK_SECRET is set but signature is missing", async () => {
    process.env.WEBHOOK_SECRET = "my-secret";
    delete require.cache[require.resolve("../index")];
    handler = require("../index");

    const ctx = makeContext();
    await handler(ctx, { headers: {}, body: { eventType: "workitem.created" } });
    assert.equal(ctx.res.status, 401);
    assert.ok(ctx.res.body.error.includes("Unauthorized"));
  });
});
