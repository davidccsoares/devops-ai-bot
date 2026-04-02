const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockContext } = require("../helpers/testUtils");

describe("postPrComment", () => {
  let postPrComment;
  let originalFetch;
  const ORIGINAL_ENV = {};

  beforeEach(() => {
    ORIGINAL_ENV.AZURE_DEVOPS_ORG = process.env.AZURE_DEVOPS_ORG;
    ORIGINAL_ENV.AZURE_DEVOPS_PAT = process.env.AZURE_DEVOPS_PAT;

    process.env.AZURE_DEVOPS_ORG = "https://dev.azure.com/testorg";
    process.env.AZURE_DEVOPS_PAT = "test-pat";

    originalFetch = global.fetch;

    // Clear caches
    delete require.cache[require.resolve("../../lib/prComments")];
    delete require.cache[require.resolve("../../lib/azurePr")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ postPrComment } = require("../../lib/prComments"));
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
  });

  it("posts a comment thread to the correct URL", async () => {
    let capturedUrl;
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedUrl = url;
      capturedBody = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    };

    const ctx = mockContext();
    const headers = { Authorization: "Basic dGVzdA==" };
    await postPrComment("MyProject", "repo-123", 42, headers, "Review comment", ctx, "Test");

    assert.ok(capturedUrl.includes("MyProject"));
    assert.ok(capturedUrl.includes("repo-123"));
    assert.ok(capturedUrl.includes("pullRequests/42"));
    assert.ok(capturedUrl.includes("threads"));
    assert.strictEqual(capturedBody.comments[0].content, "Review comment");
    assert.strictEqual(capturedBody.comments[0].commentType, 1);
    assert.strictEqual(capturedBody.status, 4);
  });

  it("logs success on 200 response", async () => {
    global.fetch = async () => ({ ok: true, status: 200 });

    const ctx = mockContext();
    const headers = { Authorization: "Basic dGVzdA==" };
    await postPrComment("Proj", "repo", 1, headers, "comment", ctx, "Tag");

    assert.ok(ctx.logs.some(([, ...args]) => args.join(" ").includes("Comment posted")));
  });

  it("logs error on failed response", async () => {
    global.fetch = async () => ({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    const ctx = mockContext();
    const headers = { Authorization: "Basic dGVzdA==" };
    await postPrComment("Proj", "repo", 1, headers, "comment", ctx, "Tag");

    assert.ok(ctx.logs.some(([level]) => level === "error"));
  });

  it("logs error on fetch exception without throwing", async () => {
    global.fetch = async () => {
      throw new Error("Network error");
    };

    const ctx = mockContext();
    const headers = { Authorization: "Basic dGVzdA==" };

    // Should NOT throw
    await postPrComment("Proj", "repo", 1, headers, "comment", ctx, "Tag");

    assert.ok(ctx.logs.some(([level]) => level === "error"));
    assert.ok(ctx.logs.some(([, ...args]) => args.join(" ").includes("Network error")));
  });

  it("uses default empty tag when not provided", async () => {
    global.fetch = async () => ({ ok: true, status: 200 });

    const ctx = mockContext();
    const headers = { Authorization: "Basic dGVzdA==" };
    await postPrComment("Proj", "repo", 1, headers, "comment", ctx);

    assert.ok(ctx.logs.some(([, ...args]) => args.join(" ").includes("Comment posted")));
  });
});
