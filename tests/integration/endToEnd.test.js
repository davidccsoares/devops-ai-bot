/**
 * End-to-end integration test that exercises the full request flow:
 *
 *   index.js → handlerFactory → aiService (fetch mocked) → azureDevopsService (fetch mocked)
 *
 * Unlike the unit tests that mock individual handler functions, this test uses
 * the real module wiring to catch integration issues between layers.
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("End-to-end integration", () => {
  let handler;
  let originalFetch;
  const ORIGINAL_ENV = {};

  /** Track all fetch calls made during the test. */
  let fetchCalls;

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
    // Save original env
    for (const key of [
      "AZURE_DEVOPS_ORG", "AZURE_DEVOPS_PAT",
      "AI_API_URL", "AI_API_KEY", "AI_MODEL",
      "AI_TIMEOUT_MS", "AI_MAX_RETRIES",
      "DEVOPS_TIMEOUT_MS", "DEVOPS_MAX_RETRIES",
      "WEBHOOK_SECRET",
    ]) {
      ORIGINAL_ENV[key] = process.env[key];
    }

    process.env.AZURE_DEVOPS_ORG = "https://dev.azure.com/test-org";
    process.env.AZURE_DEVOPS_PAT = "test-pat";
    process.env.AI_API_URL = "https://ai.test/v1/chat/completions";
    process.env.AI_API_KEY = "test-key";
    process.env.AI_MODEL = "test-model";
    process.env.AI_TIMEOUT_MS = "5000";
    process.env.AI_MAX_RETRIES = "1";
    process.env.DEVOPS_TIMEOUT_MS = "5000";
    process.env.DEVOPS_MAX_RETRIES = "1";
    delete process.env.WEBHOOK_SECRET;

    originalFetch = global.fetch;
    fetchCalls = [];

    // Clear ALL require caches for real module wiring
    const cachePaths = Object.keys(require.cache).filter(
      (p) => p.includes("devops-ai-bot") && !p.includes("node_modules")
    );
    for (const p of cachePaths) {
      delete require.cache[p];
    }

    // Now require the real index.js with all real modules
    handler = require("../../index");
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(ORIGINAL_ENV)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    global.fetch = originalFetch;

    // Clean up caches
    const cachePaths = Object.keys(require.cache).filter(
      (p) => p.includes("devops-ai-bot") && !p.includes("node_modules")
    );
    for (const p of cachePaths) {
      delete require.cache[p];
    }
  });

  it("processes workitem.created through the full pipeline", async () => {
    const aiResponse = {
      qualityScore: 7,
      missingInformation: ["Acceptance criteria"],
      isTooLarge: false,
      shouldSplit: false,
      suggestedImprovements: "Add acceptance criteria.",
    };

    // Mock fetch: first call is AI API, second call is Azure DevOps comment post
    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, method: opts.method });

      if (url.includes("ai.test")) {
        // AI API response
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(aiResponse) } }],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          }),
        };
      }

      if (url.includes("dev.azure.com")) {
        // Azure DevOps comment post
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 1 }),
        };
      }

      throw new Error(`Unexpected fetch to: ${url}`);
    };

    const ctx = makeContext();
    await handler(ctx, {
      body: {
        eventType: "workitem.created",
        resource: {
          id: 42,
          fields: {
            "System.Title": "Add user authentication",
            "System.Description": "Implement OAuth2 login.",
            "System.WorkItemType": "User Story",
            "System.TeamProject": "MyProject",
          },
        },
      },
    });

    // Should return 200
    assert.equal(ctx.res.status, 200);

    // Should have called the AI API
    assert.ok(
      fetchCalls.some((c) => c.url.includes("ai.test") && c.method === "POST"),
      "Expected a POST to the AI API"
    );

    // Should have posted a comment to Azure DevOps
    assert.ok(
      fetchCalls.some((c) => c.url.includes("dev.azure.com") && c.method === "POST"),
      "Expected a POST to Azure DevOps"
    );

    // Response body should contain the AI analysis
    assert.equal(ctx.res.body.handler, "ticketAnalyzer");
    assert.equal(ctx.res.body.workItemId, 42);
    assert.equal(ctx.res.body.analysis.qualityScore, 7);

    // Should have correlation ID header
    assert.ok(ctx.res.headers["X-Correlation-Id"]);
  });

  it("processes workitem.updated through the full pipeline", async () => {
    const aiResponse = {
      complexity: "medium",
      estimatedTimeInDays: { min: 2, max: 4 },
      riskLevel: "low",
      reasoning: "Standard integration work.",
    };

    global.fetch = async (url, opts) => {
      fetchCalls.push({ url, method: opts.method });

      if (url.includes("ai.test")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify(aiResponse) } }],
          }),
        };
      }

      if (url.includes("dev.azure.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 2 }),
        };
      }

      throw new Error(`Unexpected fetch to: ${url}`);
    };

    const ctx = makeContext();
    await handler(ctx, {
      body: {
        eventType: "workitem.updated",
        resource: {
          id: 99,
          fields: {
            "System.Title": { oldValue: "Old", newValue: "New title" },
            "System.Description": "Updated description.",
            "System.WorkItemType": "Task",
            "System.TeamProject": "MyProject",
          },
        },
      },
    });

    assert.equal(ctx.res.status, 200);
    assert.equal(ctx.res.body.handler, "timeEstimator");
    assert.equal(ctx.res.body.workItemId, 99);
    assert.equal(ctx.res.body.estimation.complexity, "medium");
  });

  it("returns 200 with degraded result when AI is unreachable", async () => {
    // All fetch calls fail
    global.fetch = async () => {
      throw new Error("Connection refused");
    };

    const ctx = makeContext();
    await handler(ctx, {
      body: {
        eventType: "workitem.created",
        resource: {
          id: 10,
          fields: {
            "System.Title": "Test ticket",
            "System.Description": "Test description.",
            "System.WorkItemType": "Bug",
            "System.TeamProject": "MyProject",
          },
        },
      },
    });

    // Should still return 200 (graceful degradation)
    assert.equal(ctx.res.status, 200);
    assert.equal(ctx.res.body.analysis.degraded, true);
    assert.ok(ctx.res.body.analysis.error);
  });
});
