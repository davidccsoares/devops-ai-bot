const crypto = require("node:crypto");
const { DedupCache } = require("../utils/dedupCache");
const { RateLimiter } = require("../utils/rateLimiter");
const { structuredLog } = require("../utils/structuredLog");
const { processGateway } = require("../functions/prGateway");

/** In-memory deduplication cache for PR webhooks (PR+commit key). */
const dedupCache = new DedupCache(3600_000); // 1 hour TTL

/** Rate limiter: 30 PR webhooks per hour. */
const rateLimiter = new RateLimiter({ max: 30, windowMs: 3600_000 });

/**
 * Azure Function: PR Review Gateway
 *
 * Receives Azure DevOps PR webhooks (git.pullrequest.created / updated)
 * and delegates to the AI code review + Playwright test generation pipeline.
 *
 * POST /api/pr-review-gateway
 */
module.exports = async function (context, req) {
  const correlationId = crypto.randomUUID();
  const startTime = Date.now();

  // Wrap context.log with correlation ID
  const originalLog = context.log;
  const log = (...args) => originalLog(`[${correlationId}]`, ...args);
  log.warn = (...args) => originalLog.warn(`[${correlationId}]`, ...args);
  log.error = (...args) => originalLog.error(`[${correlationId}]`, ...args);
  const ctx = { ...context, log, correlationId };

  const responseHeaders = {
    "Content-Type": "application/json",
    "X-Correlation-Id": correlationId,
  };

  try {
    // Rate limiting
    const rateCheck = rateLimiter.check();
    if (!rateCheck.allowed) {
      log.warn("Rate limit exceeded.");
      context.res = {
        status: 429,
        headers: { ...responseHeaders, "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)) },
        body: { error: "Too many requests. Please try again later." },
      };
      return;
    }

    const body = req.body;
    if (!body) {
      context.res = { status: 400, headers: responseHeaders, body: { error: "Empty request body." } };
      return;
    }

    const eventType = body?.eventType || "unknown";
    log(`PR webhook received (eventType: ${eventType})`);

    // Must have a PR ID
    if (!body?.resource?.pullRequestId) {
      log("No pull request ID found — acknowledging.");
      context.res = { status: 200, headers: responseHeaders, body: { message: "No PR ID. Acknowledged." } };
      return;
    }

    // Must have a source commit (filters out non-push PR updates like reviewer-added, vote-cast)
    if (!body.resource?.lastMergeSourceCommit?.commitId) {
      log("No merge source commit — skipping (likely a non-push PR update).");
      context.res = { status: 200, headers: responseHeaders, body: { message: "No source commit. Skipped." } };
      return;
    }

    // Deduplication
    const prId = body.resource.pullRequestId;
    const sourceCommit = body.resource.lastMergeSourceCommit.commitId;
    const dedupKey = `pr:${prId}:${sourceCommit}`;
    if (dedupCache.has(dedupKey)) {
      log(`Duplicate webhook for PR ${prId} @ ${sourceCommit}, skipping.`);
      context.res = { status: 200, headers: responseHeaders, body: { message: "Duplicate event skipped." } };
      return;
    }

    // Process the PR review
    await processGateway(body, ctx);

    // Mark as processed only after success
    dedupCache.add(dedupKey);

    context.res = {
      status: 202,
      headers: responseHeaders,
      body: { message: "Accepted", prId, sourceCommit },
    };
  } catch (error) {
    log.error(`Unhandled error: ${error.message}`);
    log.error(error.stack);
    context.res = {
      status: 500,
      headers: responseHeaders,
      body: { error: "Internal server error while processing PR webhook." },
    };
  } finally {
    structuredLog(ctx, "pr_review_complete", { durationMs: Date.now() - startTime, status: context.res?.status || "unknown" });
  }
};
