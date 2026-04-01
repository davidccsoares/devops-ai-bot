const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  stripHtml,
  classifyFiles,
  computePrLabels,
  buildBacklogContext,
} = require("../../functions/prGateway");

describe("stripHtml", () => {
  it("returns empty string for falsy input", () => {
    assert.strictEqual(stripHtml(null), "");
    assert.strictEqual(stripHtml(undefined), "");
    assert.strictEqual(stripHtml(""), "");
  });

  it("strips HTML tags", () => {
    assert.strictEqual(stripHtml("<p>Hello <b>world</b></p>"), "Hello world");
  });

  it("converts br to newline", () => {
    assert.ok(stripHtml("a<br/>b").includes("a\nb"));
  });

  it("decodes common HTML entities", () => {
    const result = stripHtml("&amp; &lt; &gt; &quot; &nbsp;");
    assert.ok(result.includes("&"));
    assert.ok(result.includes("<"));
    assert.ok(result.includes(">"));
    assert.ok(result.includes('"'));
  });

  it("collapses excessive newlines", () => {
    const result = stripHtml("a\n\n\n\n\nb");
    assert.ok(!result.includes("\n\n\n"));
  });
});

describe("classifyFiles", () => {
  it("skips package-lock.json", () => {
    const result = classifyFiles([
      { item: { path: "/package-lock.json" }, changeType: "edit" },
    ]);
    assert.strictEqual(result.skip.length, 1);
    assert.strictEqual(result.high.length, 0);
    assert.strictEqual(result.low.length, 0);
  });

  it("classifies .cs files as HIGH", () => {
    const result = classifyFiles([
      { item: { path: "/src/UserController.cs" }, changeType: "edit" },
    ]);
    assert.strictEqual(result.high.length, 1);
  });

  it("classifies .ts files as HIGH", () => {
    const result = classifyFiles([
      { item: { path: "/src/auth.service.ts" }, changeType: "add" },
    ]);
    assert.strictEqual(result.high.length, 1);
  });

  it("classifies test files as LOW", () => {
    const result = classifyFiles([
      { item: { path: "/tests/unit/auth.spec.ts" }, changeType: "edit" },
    ]);
    assert.strictEqual(result.low.length, 1);
  });

  it("classifies CSS files as LOW", () => {
    const result = classifyFiles([
      { item: { path: "/src/styles/main.css" }, changeType: "edit" },
    ]);
    assert.strictEqual(result.low.length, 1);
  });

  it("skips image files", () => {
    const result = classifyFiles([
      { item: { path: "/assets/logo.png" }, changeType: "add" },
    ]);
    assert.strictEqual(result.skip.length, 1);
  });

  it("skips markdown files", () => {
    const result = classifyFiles([
      { item: { path: "/README.md" }, changeType: "edit" },
    ]);
    assert.strictEqual(result.skip.length, 1);
  });

  it("ignores directory entries", () => {
    const result = classifyFiles([
      { item: { path: "/src/controllers/" }, changeType: "edit" },
    ]);
    assert.strictEqual(result.skip.length, 0);
    assert.strictEqual(result.high.length, 0);
    assert.strictEqual(result.low.length, 0);
  });

  it("ignores delete changeType", () => {
    const result = classifyFiles([
      { item: { path: "/src/old.cs" }, changeType: "delete" },
    ]);
    assert.strictEqual(result.high.length, 0);
  });

  it("sorts high-priority files by priority score descending", () => {
    const result = classifyFiles([
      { item: { path: "/src/utils/helper.ts" }, changeType: "edit" },
      { item: { path: "/src/controllers/ApiController.cs" }, changeType: "edit" },
    ]);
    assert.ok(result.high[0].priorityScore >= result.high[1].priorityScore);
  });
});

describe("computePrLabels", () => {
  it("labels docs-only when all files are skipped", () => {
    const classified = { high: [], low: [], skip: [{ path: "/README.md" }] };
    const labels = computePrLabels(classified);
    assert.ok(labels.includes("docs-only"));
  });

  it("labels needs-backlog when no work items", () => {
    const classified = { high: [{ path: "/src/a.cs" }], low: [], skip: [] };
    const labels = computePrLabels(classified, []);
    assert.ok(labels.includes("needs-backlog"));
  });

  it("does not label needs-backlog when work items exist", () => {
    const classified = { high: [{ path: "/src/a.cs" }], low: [], skip: [] };
    const labels = computePrLabels(classified, [{ id: 1 }]);
    assert.ok(!labels.includes("needs-backlog"));
  });

  it("labels backend for .cs files", () => {
    const classified = { high: [{ path: "/src/a.cs" }], low: [], skip: [] };
    const labels = computePrLabels(classified, [{ id: 1 }]);
    assert.ok(labels.includes("backend"));
  });

  it("labels frontend for .tsx files", () => {
    const classified = { high: [{ path: "/src/App.tsx" }], low: [], skip: [] };
    const labels = computePrLabels(classified, [{ id: 1 }]);
    assert.ok(labels.includes("frontend"));
  });

  it("labels large-pr for >= 15 reviewable files", () => {
    const high = Array.from({ length: 15 }, (_, i) => ({ path: `/src/${i}.ts` }));
    const classified = { high, low: [], skip: [] };
    const labels = computePrLabels(classified, [{ id: 1 }]);
    assert.ok(labels.includes("large-pr"));
  });
});

describe("buildBacklogContext", () => {
  it("returns empty string for no work items", () => {
    assert.strictEqual(buildBacklogContext([]), "");
  });

  it("includes work item title and type", () => {
    const wi = [{ id: 1, type: "User Story", title: "Add login", state: "Active", tags: "" }];
    const result = buildBacklogContext(wi);
    assert.ok(result.includes("User Story #1"));
    assert.ok(result.includes("Add login"));
  });

  it("includes parent info when present", () => {
    const wi = [{
      id: 1, type: "Task", title: "Implement API", state: "Active", tags: "",
      parent: { id: 100, type: "Feature", title: "Auth Feature", acceptanceCriteria: "Must work" },
    }];
    const result = buildBacklogContext(wi);
    assert.ok(result.includes("Parent Feature #100"));
  });
});
