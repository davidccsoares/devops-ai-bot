const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { SECRET_PATTERNS, scanForSecrets } = require("../../lib/secrets");

describe("SECRET_PATTERNS", () => {
  it("is a non-empty array of patterns", () => {
    assert.ok(Array.isArray(SECRET_PATTERNS));
    assert.ok(SECRET_PATTERNS.length > 0);
    for (const p of SECRET_PATTERNS) {
      assert.ok(p.regex instanceof RegExp);
      assert.ok(typeof p.label === "string");
    }
  });
});

describe("scanForSecrets", () => {
  it("detects hardcoded password", () => {
    const files = [{ path: "/config.js", diff: '+5: password = "hunter2"' }];
    const findings = scanForSecrets(files);
    assert.ok(findings.some((f) => f.pattern === "Hardcoded password"));
    assert.strictEqual(findings[0].line, 5);
    assert.strictEqual(findings[0].file, "/config.js");
  });

  it("detects API key", () => {
    const files = [{ path: "/env.ts", diff: '+1: api_key = "sk-abc123def456"' }];
    const findings = scanForSecrets(files);
    assert.ok(findings.some((f) => f.pattern === "API key"));
  });

  it("detects Bearer token", () => {
    const files = [{ path: "/auth.js", diff: "+10: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI" }];
    const findings = scanForSecrets(files);
    assert.ok(findings.some((f) => f.pattern === "Bearer token"));
  });

  it("detects GitHub PAT", () => {
    const files = [{ path: "/ci.yml", diff: "+3: ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8" }];
    const findings = scanForSecrets(files);
    assert.ok(findings.some((f) => f.pattern === "GitHub PAT"));
  });

  it("detects private key header", () => {
    const files = [{ path: "/key.pem", diff: "+1: -----BEGIN RSA PRIVATE KEY-----" }];
    const findings = scanForSecrets(files);
    assert.ok(findings.some((f) => f.pattern === "Private key"));
  });

  it("detects connection string", () => {
    const files = [{ path: "/db.cs", diff: '+2: connectionString = "Server=mydb;Database=prod"' }];
    const findings = scanForSecrets(files);
    assert.ok(findings.some((f) => f.pattern === "Connection string"));
  });

  it("only scans added lines (+ prefix)", () => {
    const files = [{
      path: "/config.js",
      diff: ' 1: safe context\n-2: password = "old"\n+3: const x = 42;',
    }];
    const findings = scanForSecrets(files);
    assert.strictEqual(findings.length, 0);
  });

  it("returns empty array for clean files", () => {
    const files = [{ path: "/clean.js", diff: '+1: console.log("hello");' }];
    assert.strictEqual(scanForSecrets(files).length, 0);
  });

  it("handles files with no diff", () => {
    assert.deepStrictEqual(scanForSecrets([{ path: "/a.js", diff: null }]), []);
    assert.deepStrictEqual(scanForSecrets([{ path: "/a.js" }]), []);
  });

  it("handles empty file list", () => {
    assert.deepStrictEqual(scanForSecrets([]), []);
  });
});
