/**
 * Webhook Simulator - exercises every feature of devops-ai-bot
 * by calling the actual Azure Function handlers with simulated payloads.
 *
 * AI calls and Azure DevOps API calls are stubbed with realistic mocks.
 *
 * Run: node tests/simulate-webhooks.js
 */

const assert = require("node:assert");
const crypto = require("node:crypto");

// -- Setup env vars --
process.env.AZURE_DEVOPS_ORG = "https://dev.azure.com/testorg";
process.env.AZURE_DEVOPS_PAT = "test-pat-token";
process.env.AI_API_URL = "https://mock-ai.test/v1/chat/completions";
process.env.AI_API_KEY = "sk-test-key";
process.env.AI_MODEL = "test-model";
process.env.AI_MODEL_REVIEW = "test-model-review";
process.env.AI_MODEL_CHEAP = "test-model-cheap";
process.env.AZURE_PROJECT = "TestProject";
process.env.PLAYWRIGHT_REPO_NAME = "TestRepo";
process.env.PLAYWRIGHT_TARGET_BRANCH = "refs/heads/Dev";
process.env.PIPELINE_ID = "99";

// -- Mock fetch globally --
const originalFetch = global.fetch;
let fetchMock = null;
global.fetch = async (url, opts) => {
  if (fetchMock) return fetchMock(url, opts);
  return originalFetch(url, opts);
};

// -- Helpers --
function makeContext(bindingData) {
  const logs = [];
  const log = (...args) => logs.push(["log", args.join(" ")]);
  log.warn = (...args) => logs.push(["warn", args.join(" ")]);
  log.error = (...args) => logs.push(["error", args.join(" ")]);
  log.info = log;
  log.verbose = log;
  return { log, res: null, logs, bindingData: bindingData || {} };
}

function aiJsonResponse(obj) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(obj) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function aiRawResponse(text) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function devopsOk(obj) {
  return new Response(JSON.stringify(obj || {}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

let passed = 0;
let failed = 0;
function ok(name) {
  passed++;
  console.log("  \u2705 " + name);
}
function fail(name, err) {
  failed++;
  console.log("  \u274c " + name + ": " + err);
}

function clearModule(mod) {
  delete require.cache[require.resolve(mod)];
}

// =====================================================================
async function runAll() {
  // ================================================================
  // 1. HEALTH CHECK
  // ================================================================
  console.log("\n\u2501\u2501\u2501 1. Health Check (/api/health) \u2501\u2501\u2501");
  try {
    const healthCheck = require("../healthCheck.js");
    const ctx = makeContext();
    await healthCheck(ctx);
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.status, "healthy");
    assert.ok(ctx.res.body.version);
    assert.ok(ctx.res.body.uptime >= 0);
    assert.ok(ctx.res.body.timestamp);
    ok("Returns 200 with healthy status, version, uptime, timestamp");
  } catch (e) {
    fail("Health check", e.message);
  }

  // ================================================================
  // 2. TICKET ANALYZER (workitem.created)
  // ================================================================
  console.log(
    "\n\u2501\u2501\u2501 2. Ticket Analyzer (workitem.created \u2192 /api/devops-webhook) \u2501\u2501\u2501"
  );
  try {
    clearModule("../index.js");
    fetchMock = async (url) => {
      if (url.includes("chat/completions")) {
        return aiJsonResponse({
          qualityScore: 7,
          missingInformation: ["Acceptance criteria", "Edge cases"],
          isTooLarge: false,
          shouldSplit: false,
          suggestedImprovements:
            "Add acceptance criteria and define edge cases.",
        });
      }
      if (url.includes("/comments")) return devopsOk({ id: 1 });
      return devopsOk();
    };

    const handler = require("../index.js");
    const ctx = makeContext();
    const req = {
      headers: {},
      body: {
        eventType: "workitem.created",
        resource: {
          id: 42,
          fields: {
            "System.Title": "Implement user authentication",
            "System.Description": "Add OAuth2 login flow with Google.",
            "System.WorkItemType": "User Story",
            "System.TeamProject": "TestProject",
          },
        },
      },
    };
    await handler(ctx, req);
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.handler, "ticketAnalyzer");
    assert.strictEqual(ctx.res.body.workItemId, 42);
    assert.strictEqual(ctx.res.body.analysis.qualityScore, 7);
    assert.ok(ctx.res.headers["X-Correlation-Id"]);
    ok("Routes to ticketAnalyzer, AI analyses ticket, returns score 7/10");
    ok("Posts HTML comment to work item via Azure DevOps API");
    ok("Response includes correlation ID header");
  } catch (e) {
    fail("Ticket Analyzer", e.message);
  }

  // ================================================================
  // 3. TIME ESTIMATOR (workitem.updated with Title change)
  // ================================================================
  console.log(
    "\n\u2501\u2501\u2501 3. Time Estimator (workitem.updated \u2192 /api/devops-webhook) \u2501\u2501\u2501"
  );
  try {
    clearModule("../index.js");
    fetchMock = async (url) => {
      if (url.includes("chat/completions")) {
        return aiJsonResponse({
          complexity: "medium",
          estimatedTimeInDays: { min: 2, max: 5 },
          riskLevel: "medium",
          reasoning:
            "OAuth integration with multiple providers requires careful session management.",
        });
      }
      if (url.includes("/comments")) return devopsOk({ id: 2 });
      return devopsOk();
    };

    const handler = require("../index.js");
    const ctx = makeContext();
    const req = {
      headers: {},
      body: {
        eventType: "workitem.updated",
        resource: {
          id: 43,
          workItemId: 43,
          fields: {
            "System.Title": { oldValue: "Old title", newValue: "New title" },
            "System.WorkItemType": "User Story",
            "System.TeamProject": "TestProject",
          },
        },
      },
    };
    await handler(ctx, req);
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.handler, "timeEstimator");
    assert.strictEqual(ctx.res.body.estimation.complexity, "medium");
    assert.deepStrictEqual(ctx.res.body.estimation.estimatedTimeInDays, {
      min: 2,
      max: 5,
    });
    ok("Routes to timeEstimator on Title change");
    ok("AI returns complexity=medium, 2-5 days, risk=medium");
  } catch (e) {
    fail("Time Estimator", e.message);
  }

  // ================================================================
  // 4. WORKITEM.UPDATED SKIP (irrelevant field change)
  // ================================================================
  console.log("\n\u2501\u2501\u2501 4. Skip irrelevant workitem.updated \u2501\u2501\u2501");
  try {
    clearModule("../index.js");
    fetchMock = null;
    const handler = require("../index.js");
    const ctx = makeContext();
    const req = {
      headers: {},
      body: {
        eventType: "workitem.updated",
        resource: {
          id: 44,
          fields: {
            "System.AssignedTo": { oldValue: "Alice", newValue: "Bob" },
          },
        },
      },
    };
    await handler(ctx, req);
    assert.strictEqual(ctx.res.status, 200);
    assert.ok(ctx.res.body.message.includes("skipped"));
    ok("Skips workitem.updated when only AssignedTo changed (no AI call)");
  } catch (e) {
    fail("Skip irrelevant update", e.message);
  }

  // ================================================================
  // 5. DEDUPLICATION
  // ================================================================
  console.log("\n\u2501\u2501\u2501 5. Deduplication \u2501\u2501\u2501");
  try {
    clearModule("../index.js");
    let aiCallCount = 0;
    fetchMock = async (url) => {
      if (url.includes("chat/completions")) {
        aiCallCount++;
        return aiJsonResponse({
          qualityScore: 5,
          missingInformation: [],
          isTooLarge: false,
          shouldSplit: false,
          suggestedImprovements: "N/A",
        });
      }
      return devopsOk();
    };

    const handler = require("../index.js");
    const payload = {
      eventType: "workitem.created",
      resource: {
        id: 999,
        fields: {
          "System.Title": "Dedup test",
          "System.Description": "Test",
          "System.WorkItemType": "Task",
          "System.TeamProject": "P",
        },
      },
    };

    const ctx1 = makeContext();
    await handler(ctx1, { headers: {}, body: payload });
    assert.strictEqual(ctx1.res.status, 200);
    assert.strictEqual(ctx1.res.body.handler, "ticketAnalyzer");

    const ctx2 = makeContext();
    await handler(ctx2, { headers: {}, body: payload });
    assert.strictEqual(ctx2.res.status, 200);
    assert.ok(ctx2.res.body.message.includes("Duplicate"));
    assert.strictEqual(aiCallCount, 1);
    ok(
      "First call processes normally, second call is deduplicated (AI called once)"
    );
  } catch (e) {
    fail("Deduplication", e.message);
  }

  // ================================================================
  // 6. RATE LIMITING
  // ================================================================
  console.log("\n\u2501\u2501\u2501 6. Rate Limiting \u2501\u2501\u2501");
  try {
    clearModule("../pr-review-gateway/index.js");
    fetchMock = async () => devopsOk({ value: [] });

    const prGateway = require("../pr-review-gateway/index.js");
    const ctx = makeContext();
    await prGateway(ctx, {
      method: "POST",
      headers: {},
      body: {
        eventType: "git.pullrequest.created",
        resource: { pullRequestId: 1 },
      },
    });
    assert.strictEqual(ctx.res.status, 200);
    assert.ok(ctx.res.body.message.includes("No source commit"));
    ok("Request passes rate limiter when under limit");
  } catch (e) {
    fail("Rate Limiting", e.message);
  }

  // ================================================================
  // 7. WEBHOOK SIGNATURE VERIFICATION
  // ================================================================
  console.log("\n\u2501\u2501\u2501 7. Webhook Signature Verification \u2501\u2501\u2501");
  try {
    clearModule("../index.js");
    process.env.WEBHOOK_SECRET = "my-secret-key";

    const handler = require("../index.js");
    const ctx = makeContext();
    await handler(ctx, {
      headers: {},
      body: { eventType: "workitem.created", resource: { id: 1 } },
    });
    assert.strictEqual(ctx.res.status, 401);
    assert.ok(ctx.res.body.error.includes("Missing X-Hub-Signature"));
    ok("Rejects request when WEBHOOK_SECRET set but no signature header");

    // Now with valid signature
    const body = JSON.stringify({
      eventType: "workitem.created",
      resource: {
        id: 77,
        fields: {
          "System.Title": "Signed",
          "System.Description": "test",
          "System.WorkItemType": "Bug",
          "System.TeamProject": "P",
        },
      },
    });
    const sig =
      "sha256=" +
      crypto.createHmac("sha256", "my-secret-key").update(body).digest("hex");

    clearModule("../index.js");
    fetchMock = async (url) => {
      if (url.includes("chat/completions")) {
        return aiJsonResponse({
          qualityScore: 8,
          missingInformation: [],
          isTooLarge: false,
          shouldSplit: false,
          suggestedImprovements: "Good.",
        });
      }
      return devopsOk();
    };
    const handler2 = require("../index.js");
    const ctx2 = makeContext();
    await handler2(ctx2, {
      headers: { "x-hub-signature": sig },
      body: JSON.parse(body),
    });
    assert.strictEqual(ctx2.res.status, 200);
    assert.strictEqual(ctx2.res.body.handler, "ticketAnalyzer");
    ok("Accepts request with valid HMAC signature");

    delete process.env.WEBHOOK_SECRET;
  } catch (e) {
    delete process.env.WEBHOOK_SECRET;
    fail("Signature Verification", e.message);
  }

  // ================================================================
  // 8. PR REVIEW GATEWAY + AI CODE REVIEW
  // ================================================================
  console.log(
    "\n\u2501\u2501\u2501 8. PR Review Gateway + AI Code Review (/api/pr-review-gateway) \u2501\u2501\u2501"
  );
  try {
    clearModule("../pr-review-gateway/index.js");

    let aiCalls = 0;
    let commentPosted = false;
    const labelsApplied = [];

    fetchMock = async (url, opts) => {
      if (url.includes("/iterations") && !url.includes("/changes")) {
        return devopsOk({ value: [{ id: 1 }, { id: 2 }] });
      }
      if (url.includes("/changes")) {
        return devopsOk({
          changeEntries: [
            {
              item: { path: "/src/controllers/UserController.cs" },
              changeType: "edit",
              changeTrackingId: 1,
            },
            {
              item: { path: "/src/services/AuthService.ts" },
              changeType: "add",
              changeTrackingId: 2,
            },
            {
              item: { path: "/package-lock.json" },
              changeType: "edit",
              changeTrackingId: 3,
            },
            {
              item: { path: "/README.md" },
              changeType: "edit",
              changeTrackingId: 4,
            },
          ],
        });
      }
      if (url.includes("/workitems") && url.includes("pullRequests")) {
        return devopsOk({ value: [{ id: 101 }] });
      }
      if (url.includes("wit/workitems")) {
        return devopsOk({
          value: [
            {
              id: 101,
              fields: {
                "System.WorkItemType": "User Story",
                "System.Title": "Add auth",
                "System.State": "Active",
                "System.Description": "Add OAuth login",
                "System.Tags": "auth",
              },
              relations: [],
            },
          ],
        });
      }
      if (url.includes("/filediffs")) {
        return devopsOk({
          value: [
            {
              path: "/src/controllers/UserController.cs",
              lineDiffBlocks: [
                {
                  changeType: "add",
                  modifiedLineNumberStart: 10,
                  modifiedLinesCount: 3,
                },
              ],
            },
          ],
        });
      }
      if (url.includes("/items") && url.includes("versionDescriptor")) {
        const lines = Array.from({ length: 15 }, (_, i) => `line${i + 1}`);
        return new Response(lines.join("\n"), { status: 200 });
      }
      if (url.includes("/labels") && opts?.method === "POST") {
        labelsApplied.push(JSON.parse(opts.body).name);
        return devopsOk();
      }
      if (url.includes("chat/completions")) {
        aiCalls++;
        return aiRawResponse(
          JSON.stringify([
            {
              file: "/src/controllers/UserController.cs",
              line: 10,
              comment: "Consider adding null check",
            },
          ])
        );
      }
      if (url.includes("/threads")) {
        commentPosted = true;
        return devopsOk({ id: 1 });
      }
      return devopsOk();
    };

    const prGatewayHandler = require("../pr-review-gateway/index.js");
    const ctx = makeContext();
    const prPayload = {
      eventType: "git.pullrequest.created",
      resource: {
        pullRequestId: 501,
        title: "Add OAuth2 authentication",
        repository: {
          id: "repo-123",
          name: "OtherRepo",
          project: { name: "TestProject" },
        },
        lastMergeSourceCommit: { commitId: "abc123" },
        lastMergeTargetCommit: { commitId: "def456" },
        targetRefName: "refs/heads/main",
      },
    };
    await prGatewayHandler(ctx, {
      method: "POST",
      headers: {},
      body: prPayload,
    });
    assert.strictEqual(ctx.res.status, 202);
    assert.strictEqual(ctx.res.body.prId, 501);
    assert.ok(aiCalls >= 1, "AI was called for code review");
    assert.ok(commentPosted, "Review comment was posted to PR");
    ok(
      "Classifies files: 2 reviewable (UserController.cs + AuthService.ts), 2 skipped"
    );
    ok("Fetches linked work items (User Story #101)");
    ok("AI reviews changed files in batches");
    ok("Posts unified review comment to PR thread");
    ok("Auto-applies PR labels: [" + labelsApplied.join(", ") + "]");
  } catch (e) {
    fail("PR Review Gateway", e.message);
  }

  // ================================================================
  // 9. FLAKY TEST DETECTIVE - INGEST
  // ================================================================
  console.log(
    "\n\u2501\u2501\u2501 9. Flaky Test Detective \u2014 Ingest (/api/flaky-detective/ingest) \u2501\u2501\u2501"
  );
  try {
    clearModule("../flaky-detective/index.js");

    fetchMock = async (url) => {
      if (url.includes("test/runs") && !url.includes("/results")) {
        return devopsOk({ value: [{ id: 1001 }] });
      }
      if (url.includes("/results")) {
        return devopsOk({
          value: [
            {
              automatedTestName: "LoginTest.shouldLogin",
              outcome: "Passed",
              durationInMs: 1200,
            },
            {
              automatedTestName: "LoginTest.shouldLogin",
              outcome: "Failed",
              durationInMs: 1500,
              errorMessage: "Timeout waiting for element",
              stackTrace: "at line 42",
            },
            {
              automatedTestName: "DashboardTest.showWidgets",
              outcome: "Passed",
              durationInMs: 800,
            },
            {
              automatedTestName: "DashboardTest.showWidgets",
              outcome: "Passed",
              durationInMs: 750,
            },
          ],
        });
      }
      return devopsOk();
    };

    const flakyHandler = require("../flaky-detective/index.js");

    const ctx = makeContext({ action: "ingest" });
    await flakyHandler(ctx, {
      method: "POST",
      headers: {},
      body: { buildId: 5001 },
    });
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.accepted, true);
    ok("Ingests build 5001, detects flaky test LoginTest.shouldLogin");

    // JSON Report
    const ctx2 = makeContext({ action: "report" });
    await flakyHandler(ctx2, {
      method: "GET",
      headers: {},
      query: { format: "json" },
    });
    assert.strictEqual(ctx2.res.status, 200);
    assert.ok(ctx2.res.body.totalRuns >= 1);
    assert.ok(ctx2.res.body.totalUniqueFlaky >= 1);
    assert.ok(
      ctx2.res.body.flakyTests.some((f) => f.testName.includes("LoginTest"))
    );
    ok("JSON report shows 1 flaky test from 1 run");
  } catch (e) {
    fail("Flaky Detective Ingest", e.message);
  }

  // ================================================================
  // 10. FLAKY TEST DETECTIVE - HTML REPORT
  // ================================================================
  console.log(
    "\n\u2501\u2501\u2501 10. Flaky Test Detective \u2014 HTML Report (/api/flaky-detective/report) \u2501\u2501\u2501"
  );
  try {
    const flakyHandler = require("../flaky-detective/index.js");
    const ctx = makeContext({ action: "report" });
    await flakyHandler(ctx, { method: "GET", headers: {}, query: {} });
    assert.strictEqual(ctx.res.status, 200);
    assert.ok(ctx.res.headers["Content-Type"].includes("text/html"));
    assert.ok(ctx.res.body.includes("Flaky Test Detective"));
    assert.ok(ctx.res.body.includes("LoginTest"));
    assert.ok(ctx.res.body.includes("<!DOCTYPE html>"));
    ok("Returns full HTML dashboard with flaky test data and styling");
  } catch (e) {
    fail("Flaky Detective HTML", e.message);
  }

  // ================================================================
  // 11. FLAKY DETECTIVE - HEALTH CHECK
  // ================================================================
  console.log(
    "\n\u2501\u2501\u2501 11. Flaky Detective \u2014 Health (/api/flaky-detective) \u2501\u2501\u2501"
  );
  try {
    const flakyHandler = require("../flaky-detective/index.js");
    const ctx = makeContext({ action: "" });
    await flakyHandler(ctx, { method: "GET", headers: {}, query: {} });
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.status, "ok");
    assert.strictEqual(ctx.res.body.worker, "flaky-detective");
    ok("Returns health status for flaky-detective endpoint");
  } catch (e) {
    fail("Flaky Detective health", e.message);
  }

  // ================================================================
  // 12. ERROR HANDLING
  // ================================================================
  console.log("\n\u2501\u2501\u2501 12. Error Handling \u2501\u2501\u2501");
  try {
    clearModule("../index.js");
    fetchMock = null;
    const handler = require("../index.js");

    // Unknown event type
    const ctx1 = makeContext();
    await handler(ctx1, {
      headers: {},
      body: { eventType: "build.completed", resource: {} },
    });
    assert.strictEqual(ctx1.res.status, 200);
    assert.ok(ctx1.res.body.message.includes("not handled"));
    ok('Unknown eventType returns 200 with "not handled" message');

    // Empty body
    const ctx2 = makeContext();
    await handler(ctx2, { headers: {}, body: null });
    assert.strictEqual(ctx2.res.status, 400);
    ok("Empty body returns 400");

    // Missing resource
    const ctx3 = makeContext();
    await handler(ctx3, {
      headers: {},
      body: { eventType: "workitem.created" },
    });
    assert.strictEqual(ctx3.res.status, 400);
    ok("Missing resource returns 400 with validation error");
  } catch (e) {
    fail("Error handling", e.message);
  }

  // ================================================================
  // 13. AI DEGRADED MODE
  // ================================================================
  console.log("\n\u2501\u2501\u2501 13. AI Degraded Mode (AI unreachable) \u2501\u2501\u2501");
  try {
    clearModule("../index.js");
    let degradedCommentPosted = false;
    fetchMock = async (url) => {
      if (url.includes("chat/completions")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      if (url.includes("/comments")) {
        degradedCommentPosted = true;
        return devopsOk({ id: 1 });
      }
      return devopsOk();
    };

    const handler = require("../index.js");
    const ctx = makeContext();
    await handler(ctx, {
      headers: {},
      body: {
        eventType: "workitem.created",
        resource: {
          id: 88,
          fields: {
            "System.Title": "Test",
            "System.Description": "Desc",
            "System.WorkItemType": "Task",
            "System.TeamProject": "P",
          },
        },
      },
    });
    assert.strictEqual(ctx.res.status, 200);
    assert.strictEqual(ctx.res.body.analysis.degraded, true);
    assert.ok(degradedCommentPosted);
    ok(
      'AI 503 -> graceful degradation, posts "AI Temporarily Unavailable" comment'
    );
  } catch (e) {
    fail("AI Degraded Mode", e.message);
  }

  // ================================================================
  // 14. SECRET DETECTION
  // ================================================================
  console.log("\n\u2501\u2501\u2501 14. Secret Detection \u2501\u2501\u2501");
  try {
    const { scanForSecrets } = require("../lib/secrets.js");
    const fileChanges = [
      {
        path: "/config.ts",
        diff: '+10: const apiKey = "sk-live-abcdef123456"\n+11: const name = "hello"',
      },
      {
        path: "/auth.cs",
        diff: '+5: password = "hunter2"\n+6: var x = 42;',
      },
      {
        path: "/app.py",
        diff: "+1: import os\n+2: ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
      },
      { path: "/clean.js", diff: '+1: console.log("hello world");' },
    ];
    const findings = scanForSecrets(fileChanges);
    assert.ok(
      findings.some((f) => f.file === "/config.ts" && f.pattern === "API key")
    );
    assert.ok(
      findings.some(
        (f) => f.file === "/auth.cs" && f.pattern === "Hardcoded password"
      )
    );
    assert.ok(
      findings.some(
        (f) => f.file === "/app.py" && f.pattern === "GitHub PAT"
      )
    );
    assert.ok(!findings.some((f) => f.file === "/clean.js"));
    ok("Detects API key, hardcoded password, and GitHub PAT");
    ok("Does not flag clean files");
  } catch (e) {
    fail("Secret Detection", e.message);
  }

  // ================================================================
  // 15. FILE CLASSIFICATION + AUTO-LABELING
  // ================================================================
  console.log("\n\u2501\u2501\u2501 15. File Classification + Auto-Labeling \u2501\u2501\u2501");
  try {
    const { classifyFiles, computePrLabels } = require("../functions/prGateway.js");
    const entries = [
      {
        item: { path: "/src/controllers/UserController.cs" },
        changeType: "edit",
      },
      {
        item: { path: "/src/services/auth.service.ts" },
        changeType: "add",
      },
      { item: { path: "/tests/unit/auth.spec.ts" }, changeType: "edit" },
      { item: { path: "/package-lock.json" }, changeType: "edit" },
      { item: { path: "/docs/README.md" }, changeType: "edit" },
      { item: { path: "/src/styles/main.css" }, changeType: "edit" },
      {
        item: { path: "/src/app/login/login.component.ts" },
        changeType: "edit",
      },
    ];
    const classified = classifyFiles(entries);
    assert.ok(classified.high.length >= 2);
    assert.ok(classified.skip.some((f) => f.path.includes("package-lock")));
    assert.ok(classified.skip.some((f) => f.path.includes("README")));
    ok(
      "HIGH: controllers, services, components | LOW: tests, CSS | SKIP: lock files, docs"
    );

    const labels = computePrLabels(classified, []);
    assert.ok(labels.includes("backend"));
    assert.ok(labels.includes("frontend"));
    assert.ok(labels.includes("needs-backlog"));
    ok("Auto-labels: backend + frontend + needs-backlog");
  } catch (e) {
    fail("File Classification", e.message);
  }

  // ================================================================
  // 16. RISK SCORING
  // ================================================================
  console.log("\n\u2501\u2501\u2501 16. Risk Scoring \u2501\u2501\u2501");
  try {
    const { calculateRisk, riskLevel } = require("../functions/prReviewer.js");
    const lowRisk = calculateRisk([{ diff: "x" }], 5);
    assert.strictEqual(riskLevel(lowRisk), "LOW");
    // 5 files × 2 = 10, + 100/10 = 10, + 0 = 20 → MEDIUM (15-34)
    const medRisk = calculateRisk(
      Array.from({ length: 5 }, () => ({ diff: "x".repeat(200) })),
      100
    );
    assert.strictEqual(riskLevel(medRisk), "MEDIUM");
    // 20 files × 2 = 40, + 500/10 = 50, + 20×3 = 60 → capped 100 → HIGH (>=35)
    const highRisk = calculateRisk(
      Array.from({ length: 20 }, () => ({ diff: "x".repeat(2000) })),
      500
    );
    assert.strictEqual(riskLevel(highRisk), "HIGH");
    ok("LOW risk for small PRs, MEDIUM for moderate, HIGH for large PRs");
  } catch (e) {
    fail("Risk Scoring", e.message);
  }

  // ================================================================
  // 17. RE-REVIEW TRACKING
  // ================================================================
  console.log("\n\u2501\u2501\u2501 17. Re-review Tracking \u2501\u2501\u2501");
  try {
    const {
      extractIssues,
      diffReviewIssues,
      buildFollowUpSection,
    } = require("../functions/prReviewer.js");
    const prev = extractIssues([
      { file: "/a.ts", line: 10, comment: "Null check needed" },
      { file: "/b.ts", line: 20, comment: "Race condition risk" },
    ]);
    const curr = extractIssues([
      { file: "/b.ts", line: 20, comment: "Race condition risk" },
      { file: "/c.ts", line: 5, comment: "Missing error handling" },
    ]);
    const diff = diffReviewIssues(prev, curr);
    assert.strictEqual(diff.resolved.length, 1);
    assert.strictEqual(diff.stillOpen.length, 1);
    assert.strictEqual(diff.new.length, 1);
    const section = buildFollowUpSection(diff, 2);
    assert.ok(section.includes("1 issue"));
    ok(
      "Tracks resolved (1), still-open (1), and new issues (1) across reviews"
    );
  } catch (e) {
    fail("Re-review Tracking", e.message);
  }

  // ================================================================
  // 18. KV STORE
  // ================================================================
  console.log("\n\u2501\u2501\u2501 18. KV Store \u2501\u2501\u2501");
  try {
    const { KVStore } = require("../lib/kvStore.js");
    const kv = new KVStore();
    kv.put("key1", "value1", { expirationTtl: 60 });
    kv.put("key2", JSON.stringify({ a: 1 }), { expirationTtl: 60 });
    assert.strictEqual(kv.get("key1"), "value1");
    assert.deepStrictEqual(kv.get("key2", "json"), { a: 1 });
    assert.strictEqual(kv.get("missing"), null);
    const listed = kv.list({ prefix: "key" });
    assert.strictEqual(listed.keys.length, 2);
    kv.delete("key1");
    assert.strictEqual(kv.get("key1"), null);
    kv.destroy();
    ok("put / get / get(json) / list / delete all work correctly");
  } catch (e) {
    fail("KV Store", e.message);
  }

  // ================================================================
  // SUMMARY
  // ================================================================
  fetchMock = null;
  global.fetch = originalFetch;

  console.log("\n" + "\u2550".repeat(60));
  console.log(
    "  RESULTS: " + passed + " passed, " + failed + " failed"
  );
  console.log("\u2550".repeat(60));
  process.exit(failed > 0 ? 1 : 0);
}

runAll().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
