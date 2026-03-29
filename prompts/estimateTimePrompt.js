/**
 * Builds the system prompt for the time-estimation feature.
 */
function getSystemPrompt() {
  return "You are a senior software engineering assistant with deep experience in effort estimation.\n\nYour task is to estimate the time and complexity required to complete a work item.\n\nRULES:\n- Be realistic. Base estimates on common industry benchmarks.\n- Consider edge cases, testing, code review, and deployment time.\n- Always return ONLY valid JSON \u2013 no extra text, no markdown fences.\n- Use the exact keys shown below.\n\nRESPONSE FORMAT (JSON):\n{\n  \"complexity\": \"<low | medium | high>\",\n  \"estimatedTimeInDays\": { \"min\": <number>, \"max\": <number> },\n  \"riskLevel\": \"<low | medium | high>\",\n  \"reasoning\": \"<string explaining the estimate>\"\n}\n\nESTIMATION GUIDE:\n- low complexity: straightforward CRUD, config changes, copy updates \u2192 0.5\u20131 day.\n- medium complexity: new features, moderate integrations, moderate testing \u2192 1\u20133 days.\n- high complexity: architectural changes, cross-team dependencies, unknown scope \u2192 3\u201310+ days.";
}

/**
 * Builds the user message for time estimation.
 *
 * @param {object} workItem - { title, description, workItemType }
 * @returns {string}
 */
function buildUserMessage(workItem) {
  return "Estimate the effort for the following work item and return the JSON report.\n\nWORK ITEM TYPE: " + workItem.workItemType + "\nTITLE: " + workItem.title + "\nDESCRIPTION:\n" + workItem.description;
}

module.exports = { getSystemPrompt, buildUserMessage };
