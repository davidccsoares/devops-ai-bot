/**
 * Performs an HTTP fetch with timeout and automatic retry for transient errors.
 *
 * Retries on:
 *   - HTTP 429 (rate limit)
 *   - HTTP 500, 502, 503, 504 (server errors)
 *   - Network / abort errors
 *
 * Uses exponential backoff with jitter: ~1s → ~2s → ~4s (by default).
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
    let overrideDelayMs = null;

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

      // Respect Retry-After header if present (value in seconds or HTTP-date).
      const retryAfter = response.headers?.get?.("retry-after");
      if (retryAfter && attempt < maxRetries) {
        const retryDelaySec = Number(retryAfter);
        if (!Number.isNaN(retryDelaySec) && retryDelaySec > 0) {
          overrideDelayMs = Math.min(retryDelaySec * 1000, 60000); // Cap at 60s
        }
      }

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

    // Wait before retrying (exponential backoff with jitter, or Retry-After if provided).
    if (attempt < maxRetries) {
      const baseDelay = overrideDelayMs || baseDelayMs * Math.pow(2, attempt - 1);
      const delay = addJitter(baseDelay);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adds ±25% random jitter to a delay value to prevent thundering herd.
 * @param {number} ms - The base delay in milliseconds.
 * @returns {number}    The jittered delay (always >= 1ms).
 */
function addJitter(ms) {
  const jitter = ms * 0.25 * (2 * Math.random() - 1); // ±25%
  return Math.max(1, Math.round(ms + jitter));
}

module.exports = { fetchWithRetry };
