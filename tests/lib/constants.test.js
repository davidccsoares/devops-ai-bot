const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_BATCH_FILES,
  PLAYWRIGHT_TEST_BRANCH,
  AZURE_API_VERSION,
  AZURE_API_VERSION_FILEDIFFS,
} = require("../../lib/constants");

describe("constants", () => {
  it("MAX_BATCH_FILES is a positive number", () => {
    assert.strictEqual(typeof MAX_BATCH_FILES, "number");
    assert.ok(MAX_BATCH_FILES > 0);
  });

  it("PLAYWRIGHT_TEST_BRANCH is a non-empty string", () => {
    assert.strictEqual(typeof PLAYWRIGHT_TEST_BRANCH, "string");
    assert.ok(PLAYWRIGHT_TEST_BRANCH.length > 0);
  });

  it("AZURE_API_VERSION is a non-empty string", () => {
    assert.strictEqual(typeof AZURE_API_VERSION, "string");
    assert.ok(AZURE_API_VERSION.length > 0);
  });

  it("AZURE_API_VERSION_FILEDIFFS is a non-empty string", () => {
    assert.strictEqual(typeof AZURE_API_VERSION_FILEDIFFS, "string");
    assert.ok(AZURE_API_VERSION_FILEDIFFS.length > 0);
  });
});
