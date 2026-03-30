/**
 * Builds the system prompt for the release-notes generation feature.
 */
function getSystemPrompt() {
  return `You are a senior software engineering assistant specialising in release communication.

Your task is to generate release notes from a merged pull request.

RULES:
- Write clearly and professionally.
- Always return ONLY valid JSON – no extra text, no markdown fences.
- Use the exact keys shown below.

RESPONSE FORMAT (JSON):
{
  "technicalReleaseNotes": "<markdown string aimed at developers>",
  "customerFriendlyReleaseNotes": "<markdown string aimed at end-users / stakeholders>",
  "listOfChanges": ["<change 1>", "<change 2>", "..."]
}

GUIDELINES:
- Technical notes should mention components, APIs, or architectural impacts.
- Customer-friendly notes should avoid jargon and focus on benefits.
- The list of changes should be atomic – one change per item.

EXAMPLE INPUT:
PR TITLE: feat: add dark mode support
PR DESCRIPTION: Adds a theme toggle to the settings page. Users can switch between light and dark themes. Persisted in localStorage.

EXAMPLE OUTPUT:
{
  "technicalReleaseNotes": "Added theme provider with CSS custom properties for light/dark themes. Theme preference is persisted to localStorage and read on initial load. Settings page now includes a toggle component.",
  "customerFriendlyReleaseNotes": "You can now switch between light and dark mode from the Settings page. Your preference is saved automatically.",
  "listOfChanges": ["Added dark mode theme with CSS custom properties", "Added theme toggle to Settings page", "Theme preference persisted to localStorage"]
}`;
}

/**
 * Builds the user message with pull-request data.
 *
 * @param {object} prData - { title, description, repositoryName, sourceBranch, targetBranch, linkedWorkItems }
 * @returns {string}
 */
function buildUserMessage(prData) {
  let workItemsList = "None";
  if (prData.linkedWorkItems && prData.linkedWorkItems.length > 0) {
    workItemsList = prData.linkedWorkItems
      .map((wi) => `- ID: ${wi.id || "N/A"} | URL: ${wi.url || "N/A"}`)
      .join("\n");
  }

  return `Generate release notes for the following merged pull request and return the JSON report.

REPOSITORY: ${prData.repositoryName}
SOURCE BRANCH: ${prData.sourceBranch}
TARGET BRANCH: ${prData.targetBranch}

PR TITLE: ${prData.title}
PR DESCRIPTION:
${prData.description}

LINKED WORK ITEMS:
${workItemsList}`;
}

module.exports = { getSystemPrompt, buildUserMessage };
