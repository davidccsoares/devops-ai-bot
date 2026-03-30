const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockContext } = require("../helpers/testUtils");

describe("createHandler (handlerFactory)", () => {
  let createHandler;
  let originalFetch;
  const ORIGINAL_ENV = {};

  beforeEach(() => {
    // Save and set required env vars for aiService
    ORIGINAL_ENV.AI_API_URL = process.env.AI_API_URL;
    ORIGINAL_ENV.AI_API_KEY = process.env.AI_API_KEY;
    ORIGINAL_ENV.AI_MODEL = process.env.AI_MODEL;
    ORIGINAL_ENV.AI_TIMEOUT_MS = process.env.AI_TIMEOUT_MS;

    process.env.AI_API_URL = "https://ai.example.com/v1/chat/completions";
    process.env.AI_API_KEY = "test-key-123";
    process.env.AI_MODEL = "test-model";
    process.env.AI_TIMEOUT_MS = "5000";

    originalFetch = global.fetch;

    // Fresh module load each time
    delete require.cache[require.resolve("../../utils/handlerFactory")];
    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ createHandler } = require("../../utils/handlerFactory"));
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

  it("calls all lifecycle steps in order", async () => {
    const callOrder = [];

    // Mock fetch to return a valid AI response
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"analysis":"done"}' } }],
      }),
    });

    const handler = createHandler({
      name: "TestHandler",
      extract: (payload) => {
        callOrder.push("extract");
        return { id: payload.testId };
      },
      logExtracted: (data, ctx) => {
        callOrder.push("logExtracted");
        ctx.log(`ID: ${data.id}`);
      },
      promptModule: {
        getSystemPrompt: () => {
          callOrder.push("getSystemPrompt");
          return "system prompt";
        },
        buildUserMessage: (data) => {
          callOrder.push("buildUserMessage");
          return `analyze ${data.id}`;
        },
      },
      formatComment: (aiResult) => {
        callOrder.push("formatComment");
        return `Comment: ${aiResult.analysis}`;
      },
      postComment: async (_data, _comment, _ctx) => {
        callOrder.push("postComment");
      },
      buildResult: (data, aiResult) => {
        callOrder.push("buildResult");
        return { id: data.id, result: aiResult };
      },
    });

    const ctx = mockContext();
    await handler({ testId: 42 }, ctx);

    assert.deepEqual(callOrder, [
      "extract",
      "logExtracted",
      "getSystemPrompt",
      "buildUserMessage",
      "formatComment",
      "postComment",
      "buildResult",
    ]);
  });

  it("returns the value from buildResult", async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"score":99}' } }],
      }),
    });

    const handler = createHandler({
      name: "ResultTest",
      extract: () => ({ id: 1 }),
      logExtracted: () => {},
      promptModule: {
        getSystemPrompt: () => "sys",
        buildUserMessage: () => "msg",
      },
      formatComment: () => "comment",
      postComment: async () => {},
      buildResult: (data, aiResult) => ({
        handlerId: data.id,
        aiScore: aiResult.score,
      }),
    });

    const ctx = mockContext();
    const result = await handler({}, ctx);

    assert.deepEqual(result, { handlerId: 1, aiScore: 99 });
  });

  it("passes extracted data to postComment", async () => {
    let capturedData, capturedComment;

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    });

    const handler = createHandler({
      name: "PostTest",
      extract: () => ({ project: "myProject", id: 7 }),
      logExtracted: () => {},
      promptModule: {
        getSystemPrompt: () => "sys",
        buildUserMessage: () => "msg",
      },
      formatComment: () => "<b>AI says hi</b>",
      postComment: async (data, comment) => {
        capturedData = data;
        capturedComment = comment;
      },
      buildResult: () => ({}),
    });

    const ctx = mockContext();
    await handler({}, ctx);

    assert.deepEqual(capturedData, { project: "myProject", id: 7 });
    assert.equal(capturedComment, "<b>AI says hi</b>");
  });

  it("propagates errors from postComment", async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    });

    const handler = createHandler({
      name: "ErrorTest",
      extract: () => ({}),
      logExtracted: () => {},
      promptModule: {
        getSystemPrompt: () => "sys",
        buildUserMessage: () => "msg",
      },
      formatComment: () => "comment",
      postComment: async () => {
        throw new Error("DevOps API failed");
      },
      buildResult: () => ({}),
    });

    const ctx = mockContext();
    await assert.rejects(() => handler({}, ctx), {
      message: /DevOps API failed/,
    });
  });

  it("logs handler name at start", async () => {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok":true}' } }],
      }),
    });

    const handler = createHandler({
      name: "LogNameTest",
      extract: () => ({}),
      logExtracted: () => {},
      promptModule: {
        getSystemPrompt: () => "sys",
        buildUserMessage: () => "msg",
      },
      formatComment: () => "c",
      postComment: async () => {},
      buildResult: () => ({}),
    });

    const ctx = mockContext();
    await handler({}, ctx);

    const startLog = ctx.logs.find(
      ([, ...args]) => args.some((a) => typeof a === "string" && a.includes("LogNameTest - Start"))
    );
    assert.ok(startLog, "Expected a log entry containing the handler name");
  });

  it("uses fallback comment when AI returns rawResponse", async () => {
    const rawText = "I'm sorry, I can't produce JSON for this.";

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: rawText } }],
      }),
    });

    let capturedComment;
    let formatCalled = false;

    const handler = createHandler({
      name: "FallbackTest",
      extract: () => ({ id: 1 }),
      logExtracted: () => {},
      promptModule: {
        getSystemPrompt: () => "sys",
        buildUserMessage: () => "msg",
      },
      formatComment: () => {
        formatCalled = true;
        return "should not be called";
      },
      postComment: async (data, comment) => {
        capturedComment = comment;
      },
      buildResult: (data, aiResult) => ({ aiResult }),
    });

    const ctx = mockContext();
    const result = await handler({}, ctx);

    // formatComment should NOT have been called
    assert.equal(formatCalled, false);

    // The fallback comment should contain the handler name and raw text (HTML-escaped)
    assert.ok(capturedComment.includes("FallbackTest"));
    assert.ok(
      capturedComment.includes("I&#39;m sorry, I can&#39;t produce JSON for this."),
      "Expected escaped raw text in fallback comment"
    );
    assert.ok(capturedComment.includes("<pre>"));

    // A warning should have been logged
    assert.ok(ctx.logs.some(([level]) => level === "warn"));

    // The result should still contain the rawResponse
    assert.equal(result.aiResult.rawResponse, rawText);
  });

  it("escapes HTML in fallback raw response", async () => {
    const maliciousText = '<script>alert("xss")</script>';

    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: maliciousText } }],
      }),
    });

    let capturedComment;

    const handler = createHandler({
      name: "EscapeTest",
      extract: () => ({}),
      logExtracted: () => {},
      promptModule: {
        getSystemPrompt: () => "sys",
        buildUserMessage: () => "msg",
      },
      formatComment: () => "unused",
      postComment: async (data, comment) => {
        capturedComment = comment;
      },
      buildResult: () => ({}),
    });

    const ctx = mockContext();
    await handler({}, ctx);

    // The raw text should be HTML-escaped in the comment
    assert.ok(!capturedComment.includes("<script>"));
    assert.ok(capturedComment.includes("&lt;script&gt;"));
  });
});
