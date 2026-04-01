const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { detectFlakiness } = require("../../functions/flakyDetective");

describe("detectFlakiness", () => {
  it("detects flaky test (same test passes and fails)", () => {
    const results = [
      { automatedTestName: "LoginTest", outcome: "Passed", durationInMs: 100 },
      { automatedTestName: "LoginTest", outcome: "Failed", durationInMs: 200, errorMessage: "Timeout" },
    ];
    const { flakyTests, stats } = detectFlakiness(results);
    assert.strictEqual(flakyTests.length, 1);
    assert.strictEqual(flakyTests[0].testName, "LoginTest");
    assert.strictEqual(flakyTests[0].errorMessage, "Timeout");
    assert.strictEqual(stats.total, 1);
  });

  it("does not flag consistently passing tests", () => {
    const results = [
      { automatedTestName: "StableTest", outcome: "Passed", durationInMs: 100 },
      { automatedTestName: "StableTest", outcome: "Passed", durationInMs: 110 },
    ];
    const { flakyTests, stats } = detectFlakiness(results);
    assert.strictEqual(flakyTests.length, 0);
    assert.strictEqual(stats.passed, 1);
  });

  it("does not flag consistently failing tests", () => {
    const results = [
      { automatedTestName: "BrokenTest", outcome: "Failed", durationInMs: 100 },
      { automatedTestName: "BrokenTest", outcome: "Failed", durationInMs: 110 },
    ];
    const { flakyTests, stats } = detectFlakiness(results);
    assert.strictEqual(flakyTests.length, 0);
    assert.strictEqual(stats.failed, 1);
  });

  it("handles multiple tests with mixed results", () => {
    const results = [
      { automatedTestName: "FlakyA", outcome: "Passed", durationInMs: 100 },
      { automatedTestName: "FlakyA", outcome: "Failed", durationInMs: 200, errorMessage: "err" },
      { automatedTestName: "Stable", outcome: "Passed", durationInMs: 50 },
      { automatedTestName: "FlakyB", outcome: "Failed", durationInMs: 300, errorMessage: "timeout" },
      { automatedTestName: "FlakyB", outcome: "Passed", durationInMs: 100 },
    ];
    const { flakyTests, stats } = detectFlakiness(results);
    assert.strictEqual(flakyTests.length, 2);
    assert.strictEqual(stats.total, 3);
  });

  it("handles empty results", () => {
    const { flakyTests, stats } = detectFlakiness([]);
    assert.strictEqual(flakyTests.length, 0);
    assert.strictEqual(stats.total, 0);
  });

  it("calculates total duration", () => {
    const results = [
      { automatedTestName: "A", outcome: "Passed", durationInMs: 100 },
      { automatedTestName: "A", outcome: "Passed", durationInMs: 200 },
    ];
    const { stats } = detectFlakiness(results);
    assert.strictEqual(stats.duration, 300);
  });

  it("uses testCaseTitle as fallback for name", () => {
    const results = [
      { testCaseTitle: "FallbackName", outcome: "Passed", durationInMs: 50 },
      { testCaseTitle: "FallbackName", outcome: "Failed", durationInMs: 60, errorMessage: "err" },
    ];
    const { flakyTests } = detectFlakiness(results);
    assert.strictEqual(flakyTests[0].testName, "FallbackName");
  });
});
