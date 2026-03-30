const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml } = require("../../utils/htmlEscape");

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    assert.equal(escapeHtml("A & B"), "A &amp; B");
  });

  it("escapes angle brackets", () => {
    assert.equal(escapeHtml("<script>alert('xss')</script>"), "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
  });

  it("escapes double quotes", () => {
    assert.equal(escapeHtml('value="test"'), "value=&quot;test&quot;");
  });

  it("escapes single quotes", () => {
    assert.equal(escapeHtml("it's"), "it&#39;s");
  });

  it("handles all special characters together", () => {
    assert.equal(
      escapeHtml(`<a href="x" title='y'>&</a>`),
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });

  it("returns the same string when no escaping is needed", () => {
    assert.equal(escapeHtml("Hello World 123"), "Hello World 123");
  });

  it("handles empty string", () => {
    assert.equal(escapeHtml(""), "");
  });

  it("converts non-string input to string", () => {
    assert.equal(escapeHtml(42), "42");
    assert.equal(escapeHtml(null), "null");
    assert.equal(escapeHtml(undefined), "undefined");
  });
});
