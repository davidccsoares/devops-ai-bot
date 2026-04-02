const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { buildDiffBlock } = require("../../lib/prompts");

describe("buildDiffBlock", () => {
  it("formats file changes into markdown code blocks", () => {
    const fileChanges = [
      { path: "/src/app.ts", diff: "+1: const x = 1;", isAdd: true },
      { path: "/src/utils.ts", diff: "+5: function foo() {}", isAdd: false },
    ];
    const result = buildDiffBlock(fileChanges);
    assert.ok(result.includes("### FILE: /src/app.ts (new file)"));
    assert.ok(result.includes("### FILE: /src/utils.ts (edited)"));
    assert.ok(result.includes("```"));
    assert.ok(result.includes("const x = 1;"));
    assert.ok(result.includes("function foo()"));
  });

  it("returns empty string for no file changes", () => {
    assert.strictEqual(buildDiffBlock([]), "");
  });

  it("respects MAX_DIFF_SIZE budget and stops adding files", () => {
    const bigDiff = "x".repeat(59950);
    const fileChanges = [
      { path: "/a.ts", diff: bigDiff, isAdd: false },
      { path: "/b.ts", diff: "small", isAdd: false },
    ];
    const result = buildDiffBlock(fileChanges);
    assert.ok(result.includes("/a.ts"));
    assert.ok(!result.includes("/b.ts"));
  });
});
