/**
 * Builds the system prompt for the release-notes generation feature.
 */
function getSystemPrompt() {
  return "You are a senior software engineering assistant specialising in release communication.\n\nYour task is to generate release notes from a merged pull request.\n\nRULES:\n- Write clearly and professionally.\n- Always return ONLY valid JSON \u2013 no extra text, no markdown fences.\n- Use the exact keys shown below.\n\nRESPONSE FORMAT (JSON):\n{\n  \"technicalReleaseNotes\": \"<markdown string aimed at developers>\",\n  \"customerFriendlyReleaseNotes\": \"<markdown string aimed at end-users / stakeholders>\",\n  \"listOfChanges\": [\"<change 1>\", \"<change 2>\", \"...\"]\n}\n\nGUIDELINES:\n- Technical notes should mention components, APIs, or architectural impacts.\n- Customer-friendly notes should avoid jargon and focus on benefits.\n- The list of changes should be atomic \u2013 one change per item.";
}

/**
 * Builds the user message with pull-request data.
 *
 * @param {object} prData - { title, description, repositoryName, sourceBranch, targetBranch, linkedWorkItems }
 * @returns {string}
 */
function buildUserMessage(prData) {
  var workItemsList = "None";
  if (prData.linkedWorkItems && prData.linkedWorkItems.length > 0) {
    workItemsList = prData.linkedWorkItems
      .map(function (wi) {
        return "- ID: " + (wi.id || "N/A") + " | URL: " + (wi.url || "N/A");
      })
      .join("\n");
  }

  return "Generate release notes for the following merged pull request and return the JSON report.\n\nREPOSITORY: " + prData.repositoryName + "\nSOURCE BRANCH: " + prData.sourceBranch + "\nTARGET BRANCH: " + prData.targetBranch + "\n\nPR TITLE: " + prData.title + "\nPR DESCRIPTION:\n" + prData.description + "\n\nLINKED WORK ITEMS:\n" + workItemsList;
}

module.exports = { getSystemPrompt, buildUserMessage };
