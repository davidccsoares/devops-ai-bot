const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  formatComment: formatTicket,
} = require("../../functions/ticketAnalyzer");
const {
  formatComment: formatEstimation,
} = require("../../functions/timeEstimator");

// ---------------------------------------------------------------------------
// ticketAnalyzer.formatComment
// ---------------------------------------------------------------------------

describe("ticketAnalyzer.formatComment", () => {
  it("formats a complete analysis", () => {
    const html = formatTicket({
      qualityScore: 7,
      missingInformation: ["acceptance criteria", "priority"],
      isTooLarge: false,
      shouldSplit: true,
      suggestedImprovements: "Add acceptance criteria.",
    });
    assert.ok(html.includes("7 / 10"));
    assert.ok(html.includes("acceptance criteria"));
    assert.ok(html.includes("priority"));
    assert.ok(html.includes("No"));  // isTooLarge
    assert.ok(html.includes("Yes")); // shouldSplit
    assert.ok(html.includes("Add acceptance criteria."));
  });

  it("handles qualityScore of 0", () => {
    const html = formatTicket({
      qualityScore: 0,
      missingInformation: [],
      isTooLarge: false,
      shouldSplit: false,
      suggestedImprovements: "N/A",
    });
    assert.ok(html.includes("0 / 10"));
  });

  it("handles null qualityScore", () => {
    const html = formatTicket({
      qualityScore: null,
      missingInformation: null,
    });
    // coerceNumber(null, 0, 10, null) → Number(null) = 0, which is in range → returns 0
    assert.ok(html.includes("0 / 10"));
    assert.ok(html.includes("None identified"));
  });

  it("handles non-numeric qualityScore", () => {
    const html = formatTicket({
      qualityScore: "banana",
      missingInformation: null,
    });
    assert.ok(html.includes("N/A / 10"));
    assert.ok(html.includes("None identified"));
  });

  it("handles missing fields entirely", () => {
    const html = formatTicket({});
    assert.ok(html.includes("N/A / 10"));
    assert.ok(html.includes("None identified"));
    assert.ok(html.includes("No suggestions."));
    assert.ok(html.includes("No")); // isTooLarge defaults falsy
  });

  it("escapes HTML in missingInformation items", () => {
    const html = formatTicket({
      qualityScore: 5,
      missingInformation: ['<script>alert("xss")</script>'],
    });
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("escapes HTML in suggestedImprovements", () => {
    const html = formatTicket({
      suggestedImprovements: 'Use <b>bold</b> & "quotes"',
    });
    assert.ok(html.includes("&lt;b&gt;bold&lt;/b&gt;"));
    assert.ok(html.includes("&amp;"));
    assert.ok(html.includes("&quot;quotes&quot;"));
  });
});

// ---------------------------------------------------------------------------
// timeEstimator.formatComment
// ---------------------------------------------------------------------------

describe("timeEstimator.formatComment", () => {
  it("formats a complete estimation", () => {
    const html = formatEstimation({
      complexity: "medium",
      riskLevel: "low",
      reasoning: "Standard CRUD feature.",
      estimatedTimeInDays: { min: 2, max: 5 },
    });
    assert.ok(html.includes("[MEDIUM]"));
    assert.ok(html.includes("Medium"));
    assert.ok(html.includes("[LOW]"));
    assert.ok(html.includes("Low"));
    assert.ok(html.includes("2 - 5 days"));
    assert.ok(html.includes("Standard CRUD feature."));
  });

  it("handles missing estimatedTimeInDays", () => {
    const html = formatEstimation({
      complexity: "high",
      riskLevel: "high",
    });
    assert.ok(html.includes("N/A")); // timeRange
    assert.ok(html.includes("No reasoning provided."));
  });

  it("handles zero min/max values", () => {
    const html = formatEstimation({
      estimatedTimeInDays: { min: 0, max: 1 },
    });
    assert.ok(html.includes("0 - 1 days"));
  });

  it("handles null min/max values", () => {
    const html = formatEstimation({
      estimatedTimeInDays: { min: null, max: null },
    });
    assert.ok(html.includes("? - ? days"));
  });

  it("handles missing fields entirely", () => {
    const html = formatEstimation({});
    assert.ok(html.includes("[HIGH] N/A")); // unknown complexity defaults to HIGH icon
    assert.ok(html.includes("No reasoning provided."));
  });

  it("coerces unexpected complexity to N/A", () => {
    const html = formatEstimation({
      complexity: '<img src=x onerror="alert(1)">',
      riskLevel: "low",
    });
    // coerceEnum rejects invalid values, so malicious input becomes "N/A"
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("N/A"));
    assert.ok(html.includes("[HIGH]")); // N/A falls through to HIGH icon
  });
});
