const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { validatePayload } = require("../../utils/validatePayload");

describe("validatePayload", () => {
  it("returns valid for a well-formed workitem.created payload", () => {
    const body = {
      eventType: "workitem.created",
      resource: { id: 123, fields: { "System.Title": "Test" } },
    };
    assert.deepEqual(validatePayload(body, "workitem.created"), { valid: true });
  });

  it("returns valid for workitem payload with workItemId", () => {
    const body = {
      eventType: "workitem.updated",
      resource: { workItemId: 456 },
    };
    assert.deepEqual(validatePayload(body, "workitem.updated"), { valid: true });
  });

  it("rejects payload with missing resource object", () => {
    const body = { eventType: "workitem.created" };
    const result = validatePayload(body, "workitem.created");
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes("resource"));
  });

  it("rejects payload where resource is not an object", () => {
    const body = { eventType: "workitem.created", resource: "not-an-object" };
    const result = validatePayload(body, "workitem.created");
    assert.equal(result.valid, false);
  });

  it("rejects workitem payload with no id or workItemId", () => {
    const body = {
      eventType: "workitem.created",
      resource: { fields: {} },
    };
    const result = validatePayload(body, "workitem.created");
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes("id"));
  });

  it("accepts non-workitem events with just a resource object", () => {
    const body = {
      eventType: "build.complete",
      resource: { buildNumber: "20260330.1" },
    };
    assert.deepEqual(validatePayload(body, "build.complete"), { valid: true });
  });

  it("accepts workitem payload where id is 0 (falsy but valid)", () => {
    const body = {
      eventType: "workitem.created",
      resource: { id: 0, fields: {} },
    };
    assert.deepEqual(validatePayload(body, "workitem.created"), { valid: true });
  });
});
