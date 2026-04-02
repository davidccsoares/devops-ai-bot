const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("azurePr", () => {
  const ORIGINAL_ENV = {};

  beforeEach(() => {
    ORIGINAL_ENV.AZURE_DEVOPS_ORG = process.env.AZURE_DEVOPS_ORG;
    ORIGINAL_ENV.AZURE_DEVOPS_PAT = process.env.AZURE_DEVOPS_PAT;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(ORIGINAL_ENV)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  describe("orgUrl", () => {
    it("returns AZURE_DEVOPS_ORG from env", () => {
      process.env.AZURE_DEVOPS_ORG = "https://dev.azure.com/myorg";
      const { orgUrl } = require("../../lib/azurePr");
      assert.strictEqual(orgUrl(), "https://dev.azure.com/myorg");
    });

    it("falls back to default when env is not set", () => {
      delete process.env.AZURE_DEVOPS_ORG;
      // Need fresh require to pick up missing env
      delete require.cache[require.resolve("../../lib/azurePr")];
      const { orgUrl } = require("../../lib/azurePr");
      assert.strictEqual(orgUrl(), "https://dev.azure.com/bindtuning");
    });
  });

  describe("azureHeaders", () => {
    it("returns Basic auth header from PAT", () => {
      process.env.AZURE_DEVOPS_PAT = "my-test-pat";
      delete require.cache[require.resolve("../../lib/azurePr")];
      const { azureHeaders } = require("../../lib/azurePr");

      const headers = azureHeaders();
      assert.ok(headers.Authorization.startsWith("Basic "));

      // Decode and verify
      const decoded = Buffer.from(
        headers.Authorization.replace("Basic ", ""),
        "base64"
      ).toString();
      assert.strictEqual(decoded, ":my-test-pat");
    });

    it("uses token parameter over env", () => {
      process.env.AZURE_DEVOPS_PAT = "env-pat";
      delete require.cache[require.resolve("../../lib/azurePr")];
      const { azureHeaders } = require("../../lib/azurePr");

      const headers = azureHeaders("override-pat");
      const decoded = Buffer.from(
        headers.Authorization.replace("Basic ", ""),
        "base64"
      ).toString();
      assert.strictEqual(decoded, ":override-pat");
    });

    it("throws when PAT is not configured", () => {
      delete process.env.AZURE_DEVOPS_PAT;
      delete require.cache[require.resolve("../../lib/azurePr")];
      const { azureHeaders } = require("../../lib/azurePr");

      assert.throws(() => azureHeaders(), {
        message: /AZURE_DEVOPS_PAT is not configured/,
      });
    });
  });

  describe("retryOpts", () => {
    it("returns retry configuration object", () => {
      delete require.cache[require.resolve("../../lib/azurePr")];
      const { retryOpts } = require("../../lib/azurePr");

      const ctx = { log: () => {} };
      const opts = retryOpts(ctx, "test-tag");

      assert.strictEqual(opts.maxRetries, 3);
      assert.strictEqual(opts.timeoutMs, 15000);
      assert.strictEqual(opts.baseDelayMs, 1000);
      assert.strictEqual(opts.context, ctx);
    });
  });

  describe("exports", () => {
    it("exports AZURE_API_VERSION and AZURE_API_VERSION_FILEDIFFS", () => {
      delete require.cache[require.resolve("../../lib/azurePr")];
      const mod = require("../../lib/azurePr");

      assert.ok(typeof mod.AZURE_API_VERSION === "string");
      assert.ok(typeof mod.AZURE_API_VERSION_FILEDIFFS === "string");
    });
  });
});
