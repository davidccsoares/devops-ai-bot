const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyWebhookSignature } = require("../../utils/verifySignature");

describe("verifyWebhookSignature", () => {
  const secret = "test-secret-key";

  function sign(body) {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    return "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  }

  it("returns valid when no secret is configured", () => {
    const req = { headers: {}, body: { foo: "bar" } };
    const result = verifyWebhookSignature(req, null);
    assert.strictEqual(result.valid, true);
  });

  it("returns valid when no secret is configured (undefined)", () => {
    const req = { headers: {}, body: { foo: "bar" } };
    const result = verifyWebhookSignature(req, undefined);
    assert.strictEqual(result.valid, true);
  });

  it("returns valid when no secret is configured (empty string)", () => {
    const req = { headers: {}, body: { foo: "bar" } };
    const result = verifyWebhookSignature(req, "");
    assert.strictEqual(result.valid, true);
  });

  it("returns valid for a correct signature", () => {
    const body = { eventType: "workitem.created" };
    const req = {
      headers: { "x-hub-signature": sign(body) },
      body,
    };
    const result = verifyWebhookSignature(req, secret);
    assert.strictEqual(result.valid, true);
  });

  it("returns invalid when header is missing", () => {
    const req = { headers: {}, body: { eventType: "workitem.created" } };
    const result = verifyWebhookSignature(req, secret);
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason.includes("Missing"));
  });

  it("returns invalid for wrong signature", () => {
    const body = { eventType: "workitem.created" };
    const req = {
      headers: { "x-hub-signature": "sha256=0000000000000000000000000000000000000000000000000000000000000000" },
      body,
    };
    const result = verifyWebhookSignature(req, secret);
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason.includes("mismatch"));
  });

  it("returns invalid for bad format (no sha256= prefix)", () => {
    const req = {
      headers: { "x-hub-signature": "md5=abc123" },
      body: { foo: "bar" },
    };
    const result = verifyWebhookSignature(req, secret);
    assert.strictEqual(result.valid, false);
    assert.ok(result.reason.includes("format"));
  });

  it("returns invalid for tampered body", () => {
    const originalBody = { eventType: "workitem.created" };
    const tamperedBody = { eventType: "workitem.created", hacked: true };
    const req = {
      headers: { "x-hub-signature": sign(originalBody) },
      body: tamperedBody,
    };
    const result = verifyWebhookSignature(req, secret);
    assert.strictEqual(result.valid, false);
  });
});
