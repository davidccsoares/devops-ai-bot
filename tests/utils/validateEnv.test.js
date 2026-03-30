const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("validateEnv", () => {
  const REQUIRED_KEYS = [
    "AZURE_DEVOPS_ORG",
    "AZURE_DEVOPS_PAT",
    "AI_API_URL",
    "AI_API_KEY",
  ];
  const savedEnv = {};

  beforeEach(() => {
    // Save current values
    for (const key of REQUIRED_KEYS) {
      savedEnv[key] = process.env[key];
    }
    // Set all required env vars to valid values
    for (const key of REQUIRED_KEYS) {
      process.env[key] = "test-value";
    }
    // Fresh module each test
    delete require.cache[require.resolve("../../utils/validateEnv")];
  });

  afterEach(() => {
    // Restore
    for (const key of REQUIRED_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("does not throw when all required env vars are set", () => {
    const { validateEnv } = require("../../utils/validateEnv");
    assert.doesNotThrow(() => validateEnv());
  });

  it("throws when AZURE_DEVOPS_ORG is missing", () => {
    delete process.env.AZURE_DEVOPS_ORG;
    const { validateEnv } = require("../../utils/validateEnv");
    assert.throws(() => validateEnv(), {
      message: /AZURE_DEVOPS_ORG/,
    });
  });

  it("throws when multiple env vars are missing", () => {
    delete process.env.AZURE_DEVOPS_ORG;
    delete process.env.AI_API_KEY;
    const { validateEnv } = require("../../utils/validateEnv");
    assert.throws(() => validateEnv(), (err) => {
      assert.match(err.message, /AZURE_DEVOPS_ORG/);
      assert.match(err.message, /AI_API_KEY/);
      return true;
    });
  });

  it("throws when all env vars are missing", () => {
    for (const key of REQUIRED_KEYS) {
      delete process.env[key];
    }
    const { validateEnv } = require("../../utils/validateEnv");
    assert.throws(() => validateEnv(), (err) => {
      for (const key of REQUIRED_KEYS) {
        assert.match(err.message, new RegExp(key));
      }
      return true;
    });
  });

  it("treats empty string as missing", () => {
    process.env.AI_API_URL = "";
    const { validateEnv } = require("../../utils/validateEnv");
    assert.throws(() => validateEnv(), {
      message: /AI_API_URL/,
    });
  });
});
