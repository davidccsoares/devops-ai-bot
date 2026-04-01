const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractTestBlocks,
  extractTestNames,
  sanitizeJsonStringValues,
} = require("../../functions/playwrightGenerate");

describe("extractTestNames", () => {
  it("extracts test names from spec content", () => {
    const content = `
      test('should navigate to login', async () => { });
      test("should show error message", async () => { });
    `;
    const names = extractTestNames(content);
    assert.deepStrictEqual(names, ["should navigate to login", "should show error message"]);
  });

  it("returns empty array for no tests", () => {
    assert.deepStrictEqual(extractTestNames("const x = 1;"), []);
  });

  it("handles backtick quotes", () => {
    const content = "test(`should work`, async () => { });";
    const names = extractTestNames(content);
    assert.deepStrictEqual(names, ["should work"]);
  });
});

describe("extractTestBlocks", () => {
  it("extracts test blocks from content", () => {
    const content = `
test('first test', async ({ page }) => {
  await page.goto('/');
  expect(true).toBe(true);
});

test('second test', async ({ page }) => {
  await page.click('button');
});
`;
    const blocks = extractTestBlocks(content);
    assert.strictEqual(blocks.length, 2);
    assert.ok(blocks[0].includes("first test"));
    assert.ok(blocks[1].includes("second test"));
  });

  it("returns empty array for no test blocks", () => {
    assert.deepStrictEqual(extractTestBlocks("const x = 1;"), []);
  });
});

describe("sanitizeJsonStringValues", () => {
  it("passes valid JSON through", () => {
    const input = '{"key": "value"}';
    const result = sanitizeJsonStringValues(input);
    assert.deepStrictEqual(JSON.parse(result), { key: "value" });
  });

  it("escapes raw newlines inside strings", () => {
    const input = '{"key": "line1\nline2"}';
    const result = sanitizeJsonStringValues(input);
    assert.ok(result.includes("\\n"));
    const parsed = JSON.parse(result);
    assert.ok(parsed.key.includes("line1"));
  });

  it("escapes raw tabs inside strings", () => {
    const input = '{"key": "col1\tcol2"}';
    const result = sanitizeJsonStringValues(input);
    assert.ok(result.includes("\\t"));
  });

  it("preserves already-escaped sequences", () => {
    const input = '{"key": "already\\nescaped"}';
    const result = sanitizeJsonStringValues(input);
    const parsed = JSON.parse(result);
    assert.ok(parsed.key.includes("\n"));
  });
});
