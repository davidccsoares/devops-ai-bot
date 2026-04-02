const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { mockContext, mockFetchResponse } = require("../helpers/testUtils");

// ---------------------------------------------------------------------------
// parseAIResponse (synchronous, no fetch mocking needed)
// ---------------------------------------------------------------------------

describe("parseAIResponse", () => {
  let parseAIResponse;

  beforeEach(() => {
    delete require.cache[require.resolve("../../services/aiService")];
    ({ parseAIResponse } = require("../../services/aiService"));
  });

  it("parses valid JSON directly", () => {
    const ctx = mockContext();
    const result = parseAIResponse('{"key":"value"}', ctx);
    assert.deepEqual(result, { key: "value" });
  });

  it("strips ```json fences and parses", () => {
    const ctx = mockContext();
    const raw = '```json\n{"severity":"high"}\n```';
    const result = parseAIResponse(raw, ctx);
    assert.deepEqual(result, { severity: "high" });
  });

  it("strips ``` fences without language tag", () => {
    const ctx = mockContext();
    const raw = '```\n{"items":[1,2]}\n```';
    const result = parseAIResponse(raw, ctx);
    assert.deepEqual(result, { items: [1, 2] });
  });

  it("returns rawResponse wrapper when JSON is invalid", () => {
    const ctx = mockContext();
    const raw = "This is not JSON at all.";
    const result = parseAIResponse(raw, ctx);
    assert.deepEqual(result, { rawResponse: raw });
    // Should have logged a warning
    assert.ok(ctx.logs.some(([level]) => level === "warn"));
  });

  it("handles whitespace-padded JSON", () => {
    const ctx = mockContext();
    const raw = '  \n  {"trimmed":true}  \n  ';
    const result = parseAIResponse(raw, ctx);
    assert.deepEqual(result, { trimmed: true });
  });
});

// ---------------------------------------------------------------------------
// callAI (requires fetch mocking)
// ---------------------------------------------------------------------------

describe("callAI", () => {
  let callAI;
  let originalFetch;
  const ORIGINAL_ENV = {};

  beforeEach(() => {
    // Save and set required env vars
    ORIGINAL_ENV.AI_API_URL = process.env.AI_API_URL;
    ORIGINAL_ENV.AI_API_KEY = process.env.AI_API_KEY;
    ORIGINAL_ENV.AI_MODEL = process.env.AI_MODEL;
    ORIGINAL_ENV.AI_TIMEOUT_MS = process.env.AI_TIMEOUT_MS;

    process.env.AI_API_URL = "https://ai.example.com/v1/chat/completions";
    process.env.AI_API_KEY = "test-key-123";
    process.env.AI_MODEL = "test-model";
    process.env.AI_TIMEOUT_MS = "5000";

    // Save original fetch
    originalFetch = global.fetch;

    // Fresh module load each time
    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAI } = require("../../services/aiService"));
  });

  afterEach(() => {
    // Restore env
    for (const [key, val] of Object.entries(ORIGINAL_ENV)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
    // Restore fetch
    global.fetch = originalFetch;
  });

  it("returns parsed JSON from a successful AI response", async () => {
    const aiResponse = { severity: "medium", suggestions: ["do this"] };

    global.fetch = async () =>
      mockFetchResponse({
        choices: [{ message: { content: JSON.stringify(aiResponse) } }],
      });

    const ctx = mockContext();
    const result = await callAI("system prompt", "user message", ctx);
    assert.deepEqual(result, aiResponse);
  });

  it("handles code-fenced JSON in AI response", async () => {
    const aiResponse = { score: 42 };
    const fenced = "```json\n" + JSON.stringify(aiResponse) + "\n```";

    global.fetch = async () =>
      mockFetchResponse({
        choices: [{ message: { content: fenced } }],
      });

    const ctx = mockContext();
    const result = await callAI("system", "user", ctx);
    assert.deepEqual(result, aiResponse);
  });

  it("returns rawResponse when AI returns non-JSON text", async () => {
    const plainText = "I cannot produce JSON for this request.";

    global.fetch = async () =>
      mockFetchResponse({
        choices: [{ message: { content: plainText } }],
      });

    const ctx = mockContext();
    const result = await callAI("system", "user", ctx);
    assert.deepEqual(result, { rawResponse: plainText });
  });

  it("throws when AI_API_URL is not set", async () => {
    delete process.env.AI_API_URL;

    // Re-load module so it picks up missing env var
    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAI } = require("../../services/aiService"));

    const ctx = mockContext();
    await assert.rejects(() => callAI("system", "user", ctx), {
      message: /AI_API_URL and AI_API_KEY/,
    });
  });

  it("throws when AI_API_KEY is not set", async () => {
    delete process.env.AI_API_KEY;

    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAI } = require("../../services/aiService"));

    const ctx = mockContext();
    await assert.rejects(() => callAI("system", "user", ctx), {
      message: /AI_API_URL and AI_API_KEY/,
    });
  });

  it("throws when the AI API returns an HTTP error", async () => {
    global.fetch = async () =>
      mockFetchResponse({ error: "bad request" }, { ok: false, status: 400 });

    const ctx = mockContext();
    await assert.rejects(() => callAI("system", "user", ctx), {
      message: /AI API returned status 400/,
    });
  });

  it("throws when AI response has no content", async () => {
    global.fetch = async () =>
      mockFetchResponse({
        choices: [{ message: {} }],
      });

    const ctx = mockContext();
    await assert.rejects(() => callAI("system", "user", ctx), {
      message: /AI response did not contain any content/,
    });
  });

  it("sends correct payload structure to the AI API", async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockFetchResponse({
        choices: [{ message: { content: '{"ok":true}' } }],
      });
    };

    const ctx = mockContext();
    await callAI("Be helpful", "Analyze this", ctx);

    assert.equal(capturedBody.model, "test-model");
    assert.equal(capturedBody.temperature, 0.3);
    assert.equal(capturedBody.max_tokens, 2048);
    assert.equal(capturedBody.messages.length, 2);
    assert.equal(capturedBody.messages[0].role, "system");
    assert.equal(capturedBody.messages[0].content, "Be helpful");
    assert.equal(capturedBody.messages[1].role, "user");
    assert.equal(capturedBody.messages[1].content, "Analyze this");
    assert.deepEqual(capturedBody.response_format, { type: "json_object" });
  });

  it("returns truncated rawResponse when response exceeds size limit", async () => {
    process.env.AI_MAX_RESPONSE_SIZE = "50"; // Very small limit for testing

    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAI } = require("../../services/aiService"));

    const longContent = "a".repeat(100); // Exceeds 50-char limit

    global.fetch = async () =>
      mockFetchResponse({
        choices: [{ message: { content: longContent } }],
      });

    const ctx = mockContext();
    const result = await callAI("system", "user", ctx);

    // Should return a rawResponse (not parsed JSON)
    assert.ok(result.rawResponse, "Expected rawResponse key in result");
    assert.ok(
      result.rawResponse.includes("… [truncated]"),
      "Expected truncation marker"
    );
    assert.ok(result.rawResponse.length < longContent.length);
    // Should have logged a warning
    assert.ok(ctx.logs.some(([level]) => level === "warn"));
  });

  it("uses default model when AI_MODEL is not set", async () => {
    delete process.env.AI_MODEL;

    delete require.cache[require.resolve("../../services/aiService")];
    delete require.cache[require.resolve("../../utils/fetchWithRetry")];
    ({ callAI } = require("../../services/aiService"));

    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return mockFetchResponse({
        choices: [{ message: { content: '{"ok":true}' } }],
      });
    };

    const ctx = mockContext();
    await callAI("system", "user", ctx);
    assert.equal(capturedBody.model, "meta-llama/llama-4-scout-17b-16e-instruct");
  });
});
