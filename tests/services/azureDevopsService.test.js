const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractWorkItemDataFromWebhook,
  extractPullRequestDataFromWebhook,
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

describe("extractPullRequestDataFromWebhook", () => {
  it("extracts fields from a standard PR merged payload", () => {
    const payload = {
      eventType: "git.pullrequest.merged",
      resource: {
        pullRequestId: 101,
        title: "feat: add OAuth2",
        description: "Adds OAuth2 providers.",
        sourceRefName: "refs/heads/feature/oauth",
        targetRefName: "refs/heads/main",
        repository: {
          id: "repo-guid-123",
          name: "my-app",
          project: { name: "MyProject" },
        },
        workItemRefs: [
          { id: "42", url: "https://dev.azure.com/org/proj/_workitems/edit/42" },
        ],
      },
    };

    const result = extractPullRequestDataFromWebhook(payload);
    assert.equal(result.pullRequestId, 101);
    assert.equal(result.title, "feat: add OAuth2");
    assert.equal(result.repositoryName, "my-app");
    assert.equal(result.repositoryId, "repo-guid-123");
    assert.equal(result.project, "MyProject");
    assert.equal(result.sourceBranch, "refs/heads/feature/oauth");
    assert.equal(result.linkedWorkItems.length, 1);
    assert.equal(result.linkedWorkItems[0].id, "42");
  });

  it("returns empty linkedWorkItems when none present", () => {
    const result = extractPullRequestDataFromWebhook({ resource: {} });
    assert.deepEqual(result.linkedWorkItems, []);
  });

  it("falls back to defaults for missing PR fields", () => {
    const result = extractPullRequestDataFromWebhook({});
    assert.equal(result.pullRequestId, null);
    assert.equal(result.title, "(no title)");
    assert.equal(result.repositoryName, "Unknown");
  });
});
