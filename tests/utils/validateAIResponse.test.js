const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  coerceNumber,
  coerceEnum,
  coerceString,
  coerceStringArray,
} = require("../../utils/validateAIResponse");

// ---------------------------------------------------------------------------
// coerceNumber
// ---------------------------------------------------------------------------

describe("coerceNumber", () => {
  it("returns the number when within range", () => {
    assert.strictEqual(coerceNumber(5, 0, 10, null), 5);
  });

  it("returns the number when at the minimum boundary", () => {
    assert.strictEqual(coerceNumber(0, 0, 10, null), 0);
  });

  it("returns the number when at the maximum boundary", () => {
    assert.strictEqual(coerceNumber(10, 0, 10, null), 10);
  });

  it("returns fallback when below min", () => {
    assert.strictEqual(coerceNumber(-1, 0, 10, "bad"), "bad");
  });

  it("returns fallback when above max", () => {
    assert.strictEqual(coerceNumber(11, 0, 10, null), null);
  });

  it("coerces a numeric string", () => {
    assert.strictEqual(coerceNumber("7", 0, 10, null), 7);
  });

  it("returns fallback for non-numeric string", () => {
    assert.strictEqual(coerceNumber("banana", 0, 10, -1), -1);
  });

  it("returns fallback for NaN", () => {
    assert.strictEqual(coerceNumber(NaN, 0, 10, null), null);
  });

  it("returns fallback for undefined", () => {
    assert.strictEqual(coerceNumber(undefined, 0, 10, 0), 0);
  });

  it("coerces null to 0 (Number(null) === 0)", () => {
    // Number(null) is 0; if 0 is within range, it returns 0
    assert.strictEqual(coerceNumber(null, 0, 10, -1), 0);
  });
});

// ---------------------------------------------------------------------------
// coerceEnum
// ---------------------------------------------------------------------------

describe("coerceEnum", () => {
  const allowed = ["low", "medium", "high"];

  it("returns the value when it matches (exact case)", () => {
    assert.strictEqual(coerceEnum("low", allowed, "N/A"), "low");
  });

  it("returns the value lowercased when case differs", () => {
    assert.strictEqual(coerceEnum("HIGH", allowed, "N/A"), "high");
  });

  it("trims whitespace", () => {
    assert.strictEqual(coerceEnum("  medium  ", allowed, "N/A"), "medium");
  });

  it("returns fallback for non-allowed value", () => {
    assert.strictEqual(coerceEnum("extreme", allowed, "N/A"), "N/A");
  });

  it("returns fallback for non-string value", () => {
    assert.strictEqual(coerceEnum(42, allowed, "N/A"), "N/A");
  });

  it("returns fallback for null", () => {
    assert.strictEqual(coerceEnum(null, allowed, "N/A"), "N/A");
  });

  it("returns fallback for undefined", () => {
    assert.strictEqual(coerceEnum(undefined, allowed, "fallback"), "fallback");
  });
});

// ---------------------------------------------------------------------------
// coerceString
// ---------------------------------------------------------------------------

describe("coerceString", () => {
  it("returns the string when non-empty", () => {
    assert.strictEqual(coerceString("hello", "fallback"), "hello");
  });

  it("returns fallback for empty string", () => {
    assert.strictEqual(coerceString("", "fallback"), "fallback");
  });

  it("returns fallback for whitespace-only string", () => {
    assert.strictEqual(coerceString("   ", "fallback"), "fallback");
  });

  it("returns fallback for null", () => {
    assert.strictEqual(coerceString(null, "fallback"), "fallback");
  });

  it("returns fallback for undefined", () => {
    assert.strictEqual(coerceString(undefined, "default"), "default");
  });

  it("returns fallback for number", () => {
    assert.strictEqual(coerceString(42, "fallback"), "fallback");
  });

  it("returns fallback for boolean", () => {
    assert.strictEqual(coerceString(true, "fallback"), "fallback");
  });
});

// ---------------------------------------------------------------------------
// coerceStringArray
// ---------------------------------------------------------------------------

describe("coerceStringArray", () => {
  it("returns the array when all items are strings", () => {
    assert.deepStrictEqual(coerceStringArray(["a", "b"]), ["a", "b"]);
  });

  it("filters out non-string items", () => {
    assert.deepStrictEqual(coerceStringArray(["a", 42, null, "b"]), ["a", "b"]);
  });

  it("filters out empty strings", () => {
    assert.deepStrictEqual(coerceStringArray(["a", "", "  ", "b"]), ["a", "b"]);
  });

  it("returns empty array for non-array input", () => {
    assert.deepStrictEqual(coerceStringArray("not an array"), []);
  });

  it("returns empty array for null", () => {
    assert.deepStrictEqual(coerceStringArray(null), []);
  });

  it("returns empty array for undefined", () => {
    assert.deepStrictEqual(coerceStringArray(undefined), []);
  });

  it("returns empty array for empty array", () => {
    assert.deepStrictEqual(coerceStringArray([]), []);
  });
});
