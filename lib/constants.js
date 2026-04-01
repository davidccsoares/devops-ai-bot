/**
 * Shared constants used across the PR review and Playwright workers.
 * Single source of truth — avoids drift when values change.
 */

// ─── Batching ───────────────────────────────────────────────────────────────
// In the original Cloudflare Workers this was driven by the 50-subrequest
// limit.  In Azure Functions there is no such limit, but we keep batching
// to avoid sending enormous prompts to the AI in a single call.
const MAX_BATCH_FILES = 30;

// ─── Playwright Branch ──────────────────────────────────────────────────────
const PLAYWRIGHT_TEST_BRANCH = "internship/playwright-unit-tests";

// ─── Azure DevOps API versions ──────────────────────────────────────────────
const AZURE_API_VERSION = "7.0";
const AZURE_API_VERSION_FILEDIFFS = "7.1";

module.exports = {
  MAX_BATCH_FILES,
  PLAYWRIGHT_TEST_BRANCH,
  AZURE_API_VERSION,
  AZURE_API_VERSION_FILEDIFFS,
};
