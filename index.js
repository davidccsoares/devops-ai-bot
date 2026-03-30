const crypto = require("node:crypto");
const { validateEnv } = require("./utils/validateEnv");
const { verifyWebhookSignature } = require("./utils/verifySignature");
const { DedupCache } = require("./utils/dedupCache");
const { validatePayload } = require("./utils/validatePayload");
const { RateLimiter } = require("./utils/rateLimiter");
const { structuredLog } = require("./utils/structuredLog");
const { analyzeTicket } = require("./functions/ticketAnalyzer");
const { estimateTime } = require("./functions/timeEstimator");

// Validate env vars once at cold-start, not on every request.
// In Azure Functions, this runs when the host loads the module.
validateEnv();

/** In-memory deduplication cache to skip duplicate webhook deliveries. */
const dedupTtlMs = parseInt(process.env.DEDUP_TTL_MS, 10) || undefined;
const dedupCache = new DedupCache(dedupTtlMs);

/** In-memory rate limiter to protect against request floods. */
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX, 10) || undefined;
const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || undefined;
const rateLimiter = new RateLimiter({ max: rateLimitMax, windowMs: rateLimitWindowMs });

/**
 * Handler registry – maps Azure DevOps webhook eventType strings to handler functions.
 * To add a new handler: import it above, then add an entry here. No switch editing needed.
 *
 * Optional `shouldHandle(body)` predicate – if provided, the handler is skipped when it returns false.
 */
const handlers = {
  "workitem.created": { fn: analyzeTicket, label: "Ticket Analyzer" },
  "workitem.updated": {
    fn: estimateTime,
    label: "Time Estimator",
    shouldHandle: hasRelevantFieldChange,
  },
};

/**
 * Returns true if the workitem.updated payload contains a change to Title or Description.
 * Azure DevOps updated payloads include changed fields with oldValue/newValue pairs.
 * If the payload format is unexpected, defaults to true (process anyway).
 */
function hasRelevantFieldChange(body) {
  const fields = body?.resource?.fields;
  if (!fields) return true; // Can't determine — process anyway

  const relevant = ["System.Title", "System.Description"];
  return relevant.some(
    (key) => fields[key] && typeof fields[key] === "object" && "newValue" in fields[key]
  );
}

/**
 * Wraps the Azure Function context with a correlation-ID prefix on every log call.
 * This makes it trivial to filter logs for a single request in production.
 *
 * @param {object} context        - Original Azure Function context.
 * @param {string} correlationId  - Unique ID for this request.
 * @returns {object} A context-like object with prefixed logging.
 */
function withCorrelationId(context, correlationId) {
  const prefix = `[${correlationId}]`;

  const wrappedLog = (...args) => context.log(prefix, ...args);
  wrappedLog.warn = (...args) => context.log.warn(prefix, ...args);
  wrappedLog.error = (...args) => context.log.error(prefix, ...args);
  wrappedLog.verbose = context.log.verbose
    ? (...args) => context.log.verbose(prefix, ...args)
    : wrappedLog;
  wrappedLog.info = context.log.info
    ? (...args) => context.log.info(prefix, ...args)
    : wrappedLog;

  return {
    ...context,
    log: wrappedLog,
    correlationId,
  };
}

/**
 * Main Azure Function entry point.
 * Receives Azure DevOps webhook events and routes them to the correct handler.
 *
 * POST /api/devops-webhook
 */
module.exports = async function (context, req) {
  const correlationId = crypto.randomUUID();
  const ctx = withCorrelationId(context, correlationId);

  const startTime = Date.now();
  ctx.log("DevOps AI Bot – Webhook received.");

  /** Standard response headers including correlation ID for tracing. */
  const responseHeaders = {
    "Content-Type": "application/json",
    "X-Correlation-Id": correlationId,
  };

  try {
    // Optional HMAC signature validation (if WEBHOOK_SECRET is configured).
    const sigResult = verifyWebhookSignature(req, process.env.WEBHOOK_SECRET);
    if (!sigResult.valid) {
      ctx.log.warn(`Webhook signature validation failed: ${sigResult.reason}`);
      context.res = {
        status: 401,
        headers: responseHeaders,
        body: { error: `Unauthorized: ${sigResult.reason}` },
      };
      return;
    }

    // Rate-limit protection — reject if too many requests in the current window.
    const rateCheck = rateLimiter.check();
    if (!rateCheck.allowed) {
      ctx.log.warn("Rate limit exceeded.");
      context.res = {
        status: 429,
        headers: {
          ...responseHeaders,
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
        body: { error: "Too many requests. Please try again later." },
      };
      return;
    }

    const body = req.body;

    if (!body || !body.eventType) {
      ctx.log.warn("Request has no body or missing eventType.");
      context.res = {
        status: 400,
        headers: responseHeaders,
        body: { error: "Invalid webhook payload. Missing eventType." },
      };
      return;
    }

    const eventType = body.eventType;
    ctx.log(`Event type: ${eventType}`);

    // Validate payload structure for known event types.
    const handler = handlers[eventType];
    if (handler) {
      const payloadCheck = validatePayload(body, eventType);
      if (!payloadCheck.valid) {
        ctx.log.warn(`Payload validation failed: ${payloadCheck.reason}`);
        context.res = {
          status: 400,
          headers: responseHeaders,
          body: { error: `Invalid payload: ${payloadCheck.reason}` },
        };
        return;
      }
    }

    // Deduplicate: skip if we recently processed the same event for the same resource.
    const resourceId = body?.resource?.id || body?.resource?.workItemId || "";
    const dedupKey = `${eventType}:${resourceId}`;
    if (dedupCache.has(dedupKey)) {
      ctx.log(`Duplicate event detected (${dedupKey}). Skipping.`);
      context.res = {
        status: 200,
        headers: responseHeaders,
        body: { message: "Duplicate event skipped." },
      };
      return;
    }

    let result;

    if (handler) {
      // If the handler has a shouldHandle predicate, check it first.
      if (handler.shouldHandle && !handler.shouldHandle(body)) {
        ctx.log(`${handler.label} - skipped (no relevant field changes).`);
        result = { message: `Event acknowledged but skipped (no relevant changes).` };
      } else {
        ctx.log(`Routing to ${handler.label}...`);
        result = await handler.fn(body, ctx);
      }
    } else {
      ctx.log(`Unhandled event type: ${eventType}. Acknowledging.`);
      result = { message: `Event type "${eventType}" is not handled.` };
    }

    // Mark this event as processed for deduplication.
    dedupCache.add(dedupKey);

    context.res = {
      status: 200,
      headers: responseHeaders,
      body: result,
    };
  } catch (error) {
    ctx.log.error(`Unhandled error: ${error.message}`);
    ctx.log.error(error.stack);

    context.res = {
      status: 500,
      headers: responseHeaders,
      body: {
        error: "Internal server error while processing webhook.",
      },
    };
  } finally {
    const durationMs = Date.now() - startTime;
    structuredLog(ctx, "request_complete", {
      durationMs,
      status: context.res?.status || "unknown",
    });
  }
};
