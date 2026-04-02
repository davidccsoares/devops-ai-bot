const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockContext, mockFetchResponse } = require("../helpers/testUtils");

// ---------------------------------------------------------------------------
// callAIRaw (requires fetch mocking)
// ---------------------------------------------------------------------------

describe("callAIRaw", () => {
  let callAIRaw;
  let originalFetch;
  const ORIGINAL_ENV = {};

  beforeEach(() => {
    ORIGINAL_ENV.AI_API_URL = process.env.AI_API_URL;
    ORIGINAL_ENV.AI_API_KEY = process.env.AI_API_KEY;
    ORIGINAL_ENV.AI_MODEL = process.env.AI_MODEL;
    ORIGINAL_ENV.AI_MODEL_REVIEW = process.env.AI_MODEL_REVIEW;
    ORIGINAL_ENV.AI_TIMEOUT_MS = process.env.AI_TIMEOUT_MS;

    process.env.AI_API_URL = "https://ai.example.com/v1/chat/completions";
    process.env.AI_API_KEY = "test-key-123";
    process.env.AI_MODEL = "test-model";
    process.env.AI_TIMEOUT_MS = "5000";

    originalFetch = global.fetch;

    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAIRaw } = require("../../services/aiService"));
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

  it("returns raw text from a successful AI response", async () => {
    const rawText = '[{"file":"/a.ts","line":5,"comment":"Bug found"}]';

    global.fetch = async () =>
      mockFetchResponse({
        choices: [{ message: { content: rawText } }],
      });

    const ctx = mockContext();
    const result = await callAIRaw("system prompt", "user message", ctx);
    assert.strictEqual(result, rawText);
  });

  it("does NOT parse JSON — returns raw string", async () => {
    const jsonContent = '{"key":"value"}';

    global.fetch = async () =>
      mockFetchResponse({
        choices: [{ message: { content: jsonContent } }],
      });

    const ctx = mockContext();
    const result = await callAIRaw("system", "user", ctx);
    assert.strictEqual(typeof result, "string");
    assert.strictEqual(result, jsonContent);
  });

  it("does NOT send response_format (no JSON mode)", async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockFetchResponse({
        choices: [{ message: { content: "text response" } }],
      });
    };

    const ctx = mockContext();
    await callAIRaw("system", "user", ctx);

    assert.strictEqual(capturedBody.response_format, undefined);
  });

  it("uses AI_MODEL_REVIEW as default model", async () => {
    process.env.AI_MODEL_REVIEW = "review-model-70b";

    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAIRaw } = require("../../services/aiService"));

    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockFetchResponse({
        choices: [{ message: { content: "ok" } }],
      });
    };

    const ctx = mockContext();
    await callAIRaw("system", "user", ctx);
    assert.strictEqual(capturedBody.model, "review-model-70b");
  });

  it("uses opts.model override over AI_MODEL_REVIEW", async () => {
    process.env.AI_MODEL_REVIEW = "review-model-70b";

    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAIRaw } = require("../../services/aiService"));

    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockFetchResponse({
        choices: [{ message: { content: "ok" } }],
      });
    };

    const ctx = mockContext();
    await callAIRaw("system", "user", ctx, { model: "custom-override" });
    assert.strictEqual(capturedBody.model, "custom-override");
  });

  it("uses opts.maxTokens override (default 1024)", async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockFetchResponse({
        choices: [{ message: { content: "ok" } }],
      });
    };

    const ctx = mockContext();
    await callAIRaw("system", "user", ctx);
    assert.strictEqual(capturedBody.max_tokens, 1024);

    await callAIRaw("system", "user", ctx, { maxTokens: 4096 });
    assert.strictEqual(capturedBody.max_tokens, 4096);
  });

  it("throws when AI_API_URL is not set", async () => {
    delete process.env.AI_API_URL;

    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAIRaw } = require("../../services/aiService"));

    const ctx = mockContext();
    await assert.rejects(() => callAIRaw("system", "user", ctx), {
      message: /AI_API_URL and AI_API_KEY/,
    });
  });

  it("throws when the AI API returns an HTTP error", async () => {
    global.fetch = async () =>
      mockFetchResponse({ error: "bad request" }, { ok: false, status: 400 });

    const ctx = mockContext();
    await assert.rejects(() => callAIRaw("system", "user", ctx), {
      message: /AI API returned status 400/,
    });
  });

  it("throws when AI response has no content", async () => {
    global.fetch = async () =>
      mockFetchResponse({
        choices: [{ message: {} }],
      });

    const ctx = mockContext();
    await assert.rejects(() => callAIRaw("system", "user", ctx), {
      message: /AI response did not contain any content/,
    });
  });

  it("falls back to AI_MODEL when AI_MODEL_REVIEW is not set", async () => {
    delete process.env.AI_MODEL_REVIEW;

    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAIRaw } = require("../../services/aiService"));

    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockFetchResponse({
        choices: [{ message: { content: "ok" } }],
      });
    };

    const ctx = mockContext();
    await callAIRaw("system", "user", ctx);
    assert.strictEqual(capturedBody.model, "test-model");
  });

  it("logs token usage when provided", async () => {
    global.fetch = async () =>
      mockFetchResponse({
        choices: [{ message: { content: "response" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });

    const ctx = mockContext();
    await callAIRaw("system", "user", ctx);
    assert.ok(ctx.logs.some(([, ...args]) => args.join(" ").includes("150")));
  });
});
