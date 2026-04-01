const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  CONTEXT_LINES,
  computeDiff,
  truncateDiffAtHunkBoundary,
} = require("../../lib/diffs");

describe("CONTEXT_LINES", () => {
  it("is a positive number", () => {
    assert.strictEqual(typeof CONTEXT_LINES, "number");
    assert.ok(CONTEXT_LINES > 0);
  });
});

describe("computeDiff", () => {
  it("returns empty diff for identical texts", () => {
    const { diff, changedLines } = computeDiff("hello\nworld", "hello\nworld");
    assert.strictEqual(diff, "");
    assert.deepStrictEqual(changedLines, []);
  });

  it("detects added lines", () => {
    const { diff, changedLines } = computeDiff("line1", "line1\nline2");
    assert.ok(diff.includes("+"));
    assert.ok(changedLines.length > 0);
  });

  it("detects removed lines", () => {
    const { diff } = computeDiff("line1\nline2", "line1");
    assert.ok(diff.includes("-"));
  });

  it("detects modified lines", () => {
    const { diff, changedLines } = computeDiff("old line", "new line");
    assert.ok(diff.length > 0);
    assert.ok(changedLines.length > 0);
  });

  it("handles empty old text", () => {
    const { diff, changedLines } = computeDiff("", "new content");
    assert.ok(diff.includes("+"));
    assert.ok(changedLines.length > 0);
  });

  it("handles empty new text", () => {
    const { diff } = computeDiff("old content", "");
    assert.ok(diff.includes("-"));
  });

  it("handles both empty", () => {
    const { diff, changedLines } = computeDiff("", "");
    assert.strictEqual(diff, "");
    assert.deepStrictEqual(changedLines, []);
  });

  it("handles null inputs gracefully", () => {
    const { diff } = computeDiff(null, "new");
    assert.ok(diff.length > 0);
  });

  it("includes hunk markers", () => {
    const { diff } = computeDiff("a\nb\nc", "a\nX\nc");
    assert.ok(diff.includes("@@"));
  });
});

describe("truncateDiffAtHunkBoundary", () => {
  it("returns diff unchanged when under limit", () => {
    const diff = "short diff";
    assert.strictEqual(truncateDiffAtHunkBoundary(diff, 1000), diff);
  });

  it("truncates at last hunk boundary when over limit", () => {
    const diff = "+1: line1\n---\n+5: line5\n---\n+10: line10\n---\n";
    const truncated = truncateDiffAtHunkBoundary(diff, 25);
    assert.ok(truncated.endsWith("---\n") || truncated.endsWith("---"));
    assert.ok(truncated.length <= 30); // some tolerance
  });

  it("truncates at last newline when no hunk boundary", () => {
    const diff = "line1\nline2\nline3\nline4";
    const truncated = truncateDiffAtHunkBoundary(diff, 15);
    assert.ok(truncated.length <= 15);
  });

  it("handles exact limit", () => {
    const diff = "exactly";
    assert.strictEqual(truncateDiffAtHunkBoundary(diff, 7), diff);
  });
});
