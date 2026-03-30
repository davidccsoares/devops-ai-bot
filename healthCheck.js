const { validateEnv } = require("./utils/validateEnv");

/**
 * Lightweight health-check endpoint.
 *
 * GET /api/health
 *
 * Returns 200 with status info when the function app is running and
 * required environment variables are configured. Returns 503 if
 * critical env vars are missing.
 *
 * Auth level is "anonymous" so monitoring tools can hit it without a function key.
 */
module.exports = async function (context) {
  const uptime = process.uptime();

  try {
    validateEnv();
  } catch (err) {
    context.log.error(`Health check failed: ${err.message}`);
    context.res = {
      status: 503,
      headers: { "Content-Type": "application/json" },
      body: {
        status: "unhealthy",
        error: "Missing required environment variables.",
        uptime,
      },
    };
    return;
  }

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      status: "healthy",
      uptime,
      timestamp: new Date().toISOString(),
    },
  };
};
