/**
 * Validates that all required environment variables are present.
 * Throws a clear, aggregated error message if any are missing.
 *
 * Call this at application startup (top of index.js) so misconfigurations
 * surface immediately rather than deep inside a request handler.
 */
function validateEnv() {
  const required = [
    "AZURE_DEVOPS_ORG",
    "AZURE_DEVOPS_PAT",
    "AI_API_URL",
    "AI_API_KEY",
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Check your local.settings.json or Azure Function App Settings."
    );
  }
}

module.exports = { validateEnv };
