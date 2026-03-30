const crypto = require("node:crypto");
const { validateEnv } = require("./utils/validateEnv");
const { analyzeTicket } = require("./functions/ticketAnalyzer");
const { estimateTime } = require("./functions/timeEstimator");
const { generateReleaseNotes } = require("./functions/releaseNotesGenerator");

// Validate env vars once at cold-start, not on every request.
// In Azure Functions, this runs when the host loads the module.
validateEnv();

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

  try {
    const body = req.body;

    if (!body || !body.eventType) {
      ctx.log.warn("Request has no body or missing eventType.");
      context.res = {
        status: 400,
        body: { error: "Invalid webhook payload. Missing eventType." },
      };
      return;
    }

    const eventType = body.eventType;
    ctx.log(`Event type: ${eventType}`);

    let result;

    switch (eventType) {
      // ------------------------------------------------------------------
      // A work item was created → analyse ticket quality
      // ------------------------------------------------------------------
      case "workitem.created":
        ctx.log("Routing to Ticket Analyzer...");
        result = await analyzeTicket(body, ctx);
        break;

      // ------------------------------------------------------------------
      // A work item was updated → estimate duration / complexity
      // ------------------------------------------------------------------
      case "workitem.updated":
        ctx.log("Routing to Time Estimator...");
        result = await estimateTime(body, ctx);
        break;

      // ------------------------------------------------------------------
      // A pull request was merged → generate release notes
      // ------------------------------------------------------------------
      case "git.pullrequest.merged":
        ctx.log("Routing to Release Notes Generator...");
        result = await generateReleaseNotes(body, ctx);
        break;

      default:
        ctx.log(`Unhandled event type: ${eventType}. Acknowledging.`);
        result = { message: `Event type "${eventType}" is not handled.` };
        break;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result,
    };
  } catch (error) {
    ctx.log.error(`Unhandled error: ${error.message}`);
    ctx.log.error(error.stack);

    context.res = {
      status: 500,
      body: {
        error: "Internal server error while processing webhook.",
      },
    };
  }
};
