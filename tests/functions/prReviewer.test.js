const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateRisk,
  riskLevel,
  extractIssues,
  diffReviewIssues,
  buildFollowUpSection,
} = require("../../functions/prReviewer");

describe("calculateRisk", () => {
  it("returns 0 for empty file list", () => {
    assert.strictEqual(calculateRisk([], 0), 0);
  });

  it("adds 2 per file", () => {
    const files = [{ diff: "" }, { diff: "" }, { diff: "" }];
    // 3 files * 2 = 6, + 0 lines = 6
    assert.strictEqual(calculateRisk(files, 0), 6);
  });

  it("adds floor(totalChangedLines / 10)", () => {
    assert.strictEqual(calculateRisk([{ diff: "" }], 55), 7); // 2 + 5
  });

  it("adds 3 for files with diff > 1500 chars", () => {
    const files = [{ diff: "x".repeat(1501) }];
    assert.strictEqual(calculateRisk(files, 0), 5); // 2 + 3
  });

  it("caps at 100", () => {
    const files = Array.from({ length: 50 }, () => ({ diff: "x".repeat(2000) }));
    assert.strictEqual(calculateRisk(files, 5000), 100);
  });
});

describe("riskLevel", () => {
  it("returns LOW for score < 15", () => {
    assert.strictEqual(riskLevel(0), "LOW");
    assert.strictEqual(riskLevel(14), "LOW");
  });

  it("returns MEDIUM for score 15-34", () => {
    assert.strictEqual(riskLevel(15), "MEDIUM");
    assert.strictEqual(riskLevel(34), "MEDIUM");
  });

  it("returns HIGH for score >= 35", () => {
    assert.strictEqual(riskLevel(35), "HIGH");
    assert.strictEqual(riskLevel(100), "HIGH");
  });
});

describe("extractIssues", () => {
  it("returns empty array for non-array input", () => {
    assert.deepStrictEqual(extractIssues(null), []);
    assert.deepStrictEqual(extractIssues(undefined), []);
    assert.deepStrictEqual(extractIssues("string"), []);
  });

  it("filters out comments missing file or comment", () => {
    const comments = [
      { file: "/a.ts", comment: "Bug" },
      { file: null, comment: "Bug" },
      { file: "/b.ts", comment: null },
    ];
    assert.strictEqual(extractIssues(comments).length, 1);
  });

  it("filters out LGTM comments", () => {
    const comments = [
      { file: "/a.ts", line: 1, comment: "LGTM - looks good" },
      { file: "/b.ts", line: 2, comment: "Null check needed" },
    ];
    assert.strictEqual(extractIssues(comments).length, 1);
    assert.ok(extractIssues(comments)[0].comment.includes("Null check"));
  });

  it("filters out AI review skipped comments", () => {
    const comments = [
      { file: "/a.ts", line: 1, comment: "\u26a0\ufe0f AI review skipped for this file" },
    ];
    assert.strictEqual(extractIssues(comments).length, 0);
  });

  it("generates a dedup key for each issue", () => {
    const issues = extractIssues([{ file: "/a.ts", line: 5, comment: "Bug found" }]);
    assert.ok(issues[0].key);
    assert.ok(issues[0].key.includes("/a.ts"));
  });
});

describe("diffReviewIssues", () => {
  it("categorises resolved, still-open, and new issues", () => {
    const prev = [
      { key: "a", file: "/a.ts", line: 1, comment: "old" },
      { key: "b", file: "/b.ts", line: 2, comment: "shared" },
    ];
    const curr = [
      { key: "b", file: "/b.ts", line: 2, comment: "shared" },
      { key: "c", file: "/c.ts", line: 3, comment: "new" },
    ];
    const diff = diffReviewIssues(prev, curr);
    assert.strictEqual(diff.resolved.length, 1);
    assert.strictEqual(diff.resolved[0].key, "a");
    assert.strictEqual(diff.stillOpen.length, 1);
    assert.strictEqual(diff.stillOpen[0].key, "b");
    assert.strictEqual(diff.new.length, 1);
    assert.strictEqual(diff.new[0].key, "c");
  });

  it("handles empty previous", () => {
    const diff = diffReviewIssues([], [{ key: "a" }]);
    assert.strictEqual(diff.resolved.length, 0);
    assert.strictEqual(diff.new.length, 1);
  });

  it("handles empty current", () => {
    const diff = diffReviewIssues([{ key: "a" }], []);
    assert.strictEqual(diff.resolved.length, 1);
    assert.strictEqual(diff.new.length, 0);
  });
});

describe("buildFollowUpSection", () => {
  it("includes resolved issues", () => {
    const diff = { resolved: [{ file: "/a.ts", line: 1, comment: "Fixed" }], stillOpen: [], new: [] };
    const section = buildFollowUpSection(diff, 2);
    assert.ok(section.includes("1 issue resolved"));
    assert.ok(section.includes("iteration #2"));
  });

  it("shows celebration when all resolved", () => {
    const diff = { resolved: [{ file: "/a.ts", line: 1, comment: "Fixed" }], stillOpen: [], new: [] };
    const section = buildFollowUpSection(diff, 3);
    assert.ok(section.includes("All previous issues have been addressed"));
  });

  it("includes still-open and new issues", () => {
    const diff = {
      resolved: [],
      stillOpen: [{ file: "/a.ts", line: 1, comment: "Still broken" }],
      new: [{ file: "/b.ts", line: 2, comment: "New bug" }],
    };
    const section = buildFollowUpSection(diff, 2);
    assert.ok(section.includes("1 issue still open"));
    assert.ok(section.includes("1 new issue"));
  });
});
