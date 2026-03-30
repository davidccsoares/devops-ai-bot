/**
 * Validates that an Azure DevOps webhook payload has the minimum expected
 * structure before passing it to a handler.
 *
 * Returns an object: { valid: true } or { valid: false, reason: string }.
 *
 * @param {object} body       - The parsed webhook body.
 * @param {string} eventType  - The eventType string (e.g. "workitem.created").
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePayload(body, eventType) {
  // All payloads must have a resource object.
  if (!body.resource || typeof body.resource !== "object") {
    return { valid: false, reason: "Payload is missing the 'resource' object." };
  }

  // Work-item events must have either an id or workItemId on the resource.
  if (eventType.startsWith("workitem.")) {
    const hasId =
      body.resource.id !== undefined && body.resource.id !== null;
    const hasWorkItemId =
      body.resource.workItemId !== undefined &&
      body.resource.workItemId !== null;

    if (!hasId && !hasWorkItemId) {
      return {
        valid: false,
        reason: "Work-item payload is missing resource.id or resource.workItemId.",
      };
    }
  }

  return { valid: true };
}

module.exports = { validatePayload };
