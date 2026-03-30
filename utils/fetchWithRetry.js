/**
 * Performs an HTTP fetch with timeout and automatic retry for transient errors.
 *
 * Retries on:
 *   - HTTP 429 (rate limit)
 *   - HTTP 500, 502, 503, 504 (server errors)
 *   - Network / abort errors
 *
 * Uses exponential backoff: 1s → 2s → 4s (by default).
 *
 * @param {string}  url                - The URL to fetch.
 * @param {object}  options            - Standard fetch options (method, headers, body, etc.).
 * @param {object}  [retryOpts]        - Retry configuration.
 * @param {number}  [retryOpts.maxRetries=3]    - Maximum number of attempts (including the first).
 * @param {number}  [retryOpts.timeoutMs=30000] - Per-request timeout in milliseconds.
 * @param {number}  [retryOpts.baseDelayMs=1000] - Base delay before first retry.
 * @param {object}  [retryOpts.context]          - Azure Function context for logging (optional).
 * @returns {Promise<Response>} The fetch Response object.
 */
async function fetchWithRetry(url, options = {}, retryOpts = {}) {
  const {
    maxRetries = 3,
    timeoutMs = 30000,
    baseDelayMs = 1000,
    context = null,
  } = retryOpts;

  const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // If the response is OK or a non-retryable error, return immediately.
      if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status)) {
        return response;
      }

      // Retryable HTTP error – log and continue to retry.
      lastError = new Error(`HTTP ${response.status}`);
      if (context) {
        context.log.warn(
          `Attempt ${attempt}/${maxRetries} failed with HTTP ${response.status}. ` +
          (attempt < maxRetries ? "Retrying..." : "No retries left.")
        );
      }
    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === "AbortError") {
        lastError = new Error(`Request timed out after ${timeoutMs}ms.`);
      } else {
        lastError = err;
      }

      if (context) {
        context.log.warn(
          `Attempt ${attempt}/${maxRetries} failed: ${lastError.message}. ` +
          (attempt < maxRetries ? "Retrying..." : "No retries left.")
        );
      }
    }

    // Wait before retrying (exponential backoff).
    if (attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { fetchWithRetry };
