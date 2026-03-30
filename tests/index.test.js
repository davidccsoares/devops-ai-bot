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
    const mockRelease = async () => ({ mock: "generateReleaseNotes" });

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
    require.cache[require.resolve("../functions/releaseNotesGenerator")] = {
      id: require.resolve("../functions/releaseNotesGenerator"),
      filename: require.resolve("../functions/releaseNotesGenerator"),
      loaded: true,
      exports: { generateReleaseNotes: mockRelease },
    };

    handler = require("../index");
  });

  afterEach(() => {
    delete require.cache[require.resolve("../index")];
    delete require.cache[require.resolve("../functions/ticketAnalyzer")];
    delete require.cache[require.resolve("../functions/timeEstimator")];
    delete require.cache[require.resolve("../functions/releaseNotesGenerator")];
  });

  it("returns 400 for missing body", async () => {
    const ctx = makeContext();
    await handler(ctx, { body: null });
    assert.equal(ctx.res.status, 400);
    assert.match(ctx.res.body.error, /Missing eventType/);
  });

  it("returns 400 for missing eventType", async () => {
    const ctx = makeContext();
    await handler(ctx, { body: { foo: "bar" } });
    assert.equal(ctx.res.status, 400);
  });

  it("routes workitem.created to ticket analyzer", async () => {
    const ctx = makeContext();
    await handler(ctx, { body: { eventType: "workitem.created" } });
    assert.equal(ctx.res.status, 200);
    assert.deepEqual(ctx.res.body, { mock: "analyzeTicket" });
  });

  it("routes workitem.updated to time estimator", async () => {
    const ctx = makeContext();
    await handler(ctx, { body: { eventType: "workitem.updated" } });
    assert.equal(ctx.res.status, 200);
    assert.deepEqual(ctx.res.body, { mock: "estimateTime" });
  });

  it("routes git.pullrequest.merged to release notes generator", async () => {
    const ctx = makeContext();
    await handler(ctx, { body: { eventType: "git.pullrequest.merged" } });
    assert.equal(ctx.res.status, 200);
    assert.deepEqual(ctx.res.body, { mock: "generateReleaseNotes" });
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
    await handler(ctx, { body: { eventType: "workitem.created" } });
    assert.equal(ctx.res.status, 500);
    assert.ok(ctx.res.body.error);
  });
});
