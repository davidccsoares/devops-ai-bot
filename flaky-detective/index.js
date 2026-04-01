const { ingestBuild, handleReport } = require("../functions/flakyDetective");

/**
 * Azure Function: Flaky Test Detective
 *
 * Routes:
 *   GET  /api/flaky-detective          — Health check
 *   POST /api/flaky-detective/ingest   — Receive buildId, detect flakiness
 *   GET  /api/flaky-detective/report   — HTML dashboard (or JSON with ?format=json)
 *
 * POST /api/flaky-detective/ingest
 * GET  /api/flaky-detective/report
 */
module.exports = async function (context, req) {
  const action = context.bindingData.action || "";
  const method = req.method.toUpperCase();

  // ─── GET / — health check ─────────────────────────────────────
  if (method === "GET" && !action) {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { status: "ok", worker: "flaky-detective" },
    };
    return;
  }

  // ─── POST /ingest — receive build results ─────────────────────
  // Accepts { buildId: "123" } (direct call / pipeline task) or
  // Azure DevOps "Build completed" webhook payload where the build
  // ID lives at resource.id.
  if (method === "POST" && action === "ingest") {
    const body = req.body;
    const buildId = body?.buildId || body?.resource?.id;
    if (!buildId) {
      context.res = { status: 400, body: { error: "Missing buildId (expected body.buildId or body.resource.id)" } };
      return;
    }

    context.log(`[FlakyDetective] Ingesting build ${buildId}`);
    await ingestBuild(String(buildId), context);

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { accepted: true, buildId },
    };
    return;
  }

  // ─── GET /report — dashboard ──────────────────────────────────
  if (method === "GET" && action === "report") {
    const format = req.query?.format || null;
    const result = await handleReport(format);

    if (result.contentType === "application/json") {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
        body: result.body,
      };
    } else {
      context.res = {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
        body: result.body,
        isRaw: true,
      };
    }
    return;
  }

  // ─── Fallback ─────────────────────────────────────────────────
  context.res = { status: 404, body: { error: "Not found" } };
};
