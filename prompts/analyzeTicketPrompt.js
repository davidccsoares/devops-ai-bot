/**
 * Builds the system prompt for the ticket-analysis feature.
 */
function getSystemPrompt() {
  return "You are a senior software engineering assistant specialising in agile project management.\n\nYour task is to evaluate a work item (ticket) and provide a structured quality analysis.\n\nRULES:\n- Be concise and actionable.\n- Always return ONLY valid JSON \u2013 no extra text, no markdown fences.\n- Use the exact keys shown below.\n\nRESPONSE FORMAT (JSON):\n{\n  \"qualityScore\": <number 1-10>,\n  \"missingInformation\": [<string>, ...],\n  \"isTooLarge\": <boolean>,\n  \"shouldSplit\": <boolean>,\n  \"suggestedImprovements\": \"<string with concrete suggestions>\"\n}\n\nSCORING GUIDE:\n- 1-3: Very poor \u2013 missing critical info, vague, or contradictory.\n- 4-6: Needs improvement \u2013 some useful detail but gaps remain.\n- 7-8: Good \u2013 clear intent, minor polish needed.\n- 9-10: Excellent \u2013 well-defined acceptance criteria, context, and scope.";
}

/**
 * Builds the user message containing the work-item data to analyse.
 *
 * @param {object} workItem - { title, description, workItemType }
 * @returns {string}
 */
function buildUserMessage(workItem) {
  return "Analyse the following work item and return the JSON quality report.\n\nWORK ITEM TYPE: " + workItem.workItemType + "\nTITLE: " + workItem.title + "\nDESCRIPTION:\n" + workItem.description;
}

module.exports = { getSystemPrompt, buildUserMessage };
