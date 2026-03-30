/**
 * Builds a mock Azure Function context that captures log calls.
 * Shared across test files to avoid duplication.
 *
 * @returns {{ log: Function, logs: Array }} A context-like object.
 */
function mockContext() {
  const logs = [];
  const log = (...args) => logs.push(["log", ...args]);
  log.warn = (...args) => logs.push(["warn", ...args]);
  log.error = (...args) => logs.push(["error", ...args]);
  return { log, logs };
}

/**
 * Helper to create a mock fetch response.
 *
 * @param {object} body     - The response body (returned by .json()).
 * @param {object} [opts]   - Optional { ok, status } overrides.
 * @returns {object}           A mock Response-like object.
 */
function mockFetchResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

module.exports = { mockContext, mockFetchResponse };
