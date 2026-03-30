const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractWorkItemDataFromWebhook,
} = require("../../services/azureDevopsService");

describe("extractWorkItemDataFromWebhook", () => {
  it("extracts fields from a standard workitem.created payload", () => {
    const payload = {
      eventType: "workitem.created",
      resource: {
        id: 42,
        fields: {
          "System.Title": "Add user auth",
          "System.Description": "Implement OAuth2.",
          "System.WorkItemType": "User Story",
          "System.TeamProject": "MyProject",
        },
      },
    };

    const result = extractWorkItemDataFromWebhook(payload);
    assert.equal(result.id, 42);
    assert.equal(result.title, "Add user auth");
    assert.equal(result.description, "Implement OAuth2.");
    assert.equal(result.workItemType, "User Story");
    assert.equal(result.project, "MyProject");
  });

  it("falls back to defaults for missing fields", () => {
    const result = extractWorkItemDataFromWebhook({});
    assert.equal(result.id, null);
    assert.equal(result.title, "(no title)");
    assert.equal(result.description, "(no description)");
    assert.equal(result.workItemType, "Unknown");
    assert.equal(result.project, null);
    assert.equal(result.url, null);
  });

  it("uses resourceContainers as project fallback", () => {
    const payload = {
      resource: { id: 1, fields: {} },
      resourceContainers: { project: { id: "proj-guid" } },
    };
    const result = extractWorkItemDataFromWebhook(payload);
    assert.equal(result.project, "proj-guid");
  });
});
