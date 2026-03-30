/**
 * Emits a structured JSON log entry via the Azure Function context logger.
 *
 * Structured logs are easy to query in Azure Application Insights / Log Analytics.
 * Each entry includes the event name, correlation ID (if available on the context),
 * a timestamp, and any additional data fields.
 *
 * Falls back to plain text logging if the context doesn't support structured data.
 *
 * @param {object} context       - Azure Function context (or wrapped context).
 * @param {string} event         - A short, machine-friendly event name (e.g. "ai_call_complete").
 * @param {object} [data={}]     - Additional key-value data to include.
 * @param {"log"|"warn"|"error"} [level="log"] - Log level.
 */
function structuredLog(context, event, data = {}, level = "log") {
  const entry = {
    event,
    correlationId: context.correlationId || undefined,
    timestamp: new Date().toISOString(),
    ...data,
  };

  const logFn =
    level === "error"
      ? context.log.error
      : level === "warn"
        ? context.log.warn
        : context.log;

  logFn(JSON.stringify(entry));
}

module.exports = { structuredLog };
