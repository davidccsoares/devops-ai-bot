const crypto = require("node:crypto");
const { validateEnv } = require("./utils/validateEnv");
const { analyzeTicket } = require("./functions/ticketAnalyzer");
const { estimateTime } = require("./functions/timeEstimator");
const { generateReleaseNotes } = require("./functions/releaseNotesGenerator");

// Validate env vars once at cold-start, not on every request.
// In Azure Functions, this runs when the host loads the module.
validateEnv();

/**
 * Handler registry – maps Azure DevOps webhook eventType strings to handler functions.
 * To add a new handler: import it above, then add an entry here. No switch editing needed.
 */
const handlers = {
  "workitem.created": { fn: analyzeTicket, label: "Ticket Analyzer" },
  "workitem.updated": { fn: estimateTime, label: "Time Estimator" },
  "git.pullrequest.merged": { fn: generateReleaseNotes, label: "Release Notes Generator" },
};

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

  ctx.log("DevOps AI Bot – Webhook received.");

  /** Standard response headers including correlation ID for tracing. */
  const responseHeaders = {
    "Content-Type": "application/json",
    "X-Correlation-Id": correlationId,
  };

  try {
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

    let result;
    const handler = handlers[eventType];

    if (handler) {
      ctx.log(`Routing to ${handler.label}...`);
      result = await handler.fn(body, ctx);
    } else {
      ctx.log(`Unhandled event type: ${eventType}. Acknowledging.`);
      result = { message: `Event type "${eventType}" is not handled.` };
    }

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
  }
};
