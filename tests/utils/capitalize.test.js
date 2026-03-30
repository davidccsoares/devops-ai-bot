const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { capitalize } = require("../../utils/capitalize");

describe("capitalize", () => {
  it("capitalises the first letter of a lowercase string", () => {
    assert.equal(capitalize("hello"), "Hello");
  });

  it("leaves an already-capitalised string unchanged", () => {
    assert.equal(capitalize("Hello"), "Hello");
  });

  it("handles single-character strings", () => {
    assert.equal(capitalize("a"), "A");
  });

  it("handles all-uppercase strings", () => {
    assert.equal(capitalize("HIGH"), "HIGH");
  });

  it("returns empty string for empty string", () => {
    assert.equal(capitalize(""), "");
  });

  it("returns null for null", () => {
    assert.equal(capitalize(null), null);
  });

  it("returns undefined for undefined", () => {
    assert.equal(capitalize(undefined), undefined);
  });
});
