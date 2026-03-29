const { analyzeTicket } = require("./functions/ticketAnalyzer");
const { estimateTime } = require("./functions/timeEstimator");
const { generateReleaseNotes } = require("./functions/releaseNotesGenerator");

/**
 * Main Azure Function entry point.
 * Receives Azure DevOps webhook events and routes them to the correct handler.
 *
 * POST /api/devops-webhook
 */
module.exports = async function (context, req) {
  context.log("DevOps AI Bot – Webhook received.");

  try {
    const body = req.body;

    if (!body || !body.eventType) {
      context.log.warn("Request has no body or missing eventType.");
      context.res = {
        status: 400,
        body: { error: "Invalid webhook payload. Missing eventType." },
      };
      return;
    }

    const eventType = body.eventType;
    context.log(`Event type: ${eventType}`);

    let result;

    switch (eventType) {
      // ------------------------------------------------------------------
      // A work item was created → analyse ticket quality
      // ------------------------------------------------------------------
      case "workitem.created":
        context.log("Routing to Ticket Analyzer...");
        result = await analyzeTicket(body, context);
        break;

      // ------------------------------------------------------------------
      // A work item was updated → estimate duration / complexity
      // ------------------------------------------------------------------
      case "workitem.updated":
        context.log("Routing to Time Estimator...");
        result = await estimateTime(body, context);
        break;

      // ------------------------------------------------------------------
      // A pull request was merged → generate release notes
      // ------------------------------------------------------------------
      case "git.pullrequest.merged":
        context.log("Routing to Release Notes Generator...");
        result = await generateReleaseNotes(body, context);
        break;

      default:
        context.log(`Unhandled event type: ${eventType}. Acknowledging.`);
        result = { message: `Event type "${eventType}" is not handled.` };
        break;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: result,
    };
  } catch (error) {
    context.log.error(`Unhandled error: ${error.message}`);
    context.log.error(error.stack);

    context.res = {
      status: 500,
      body: {
        error: "Internal server error while processing webhook.",
        details: error.message,
      },
    };
  }
};
