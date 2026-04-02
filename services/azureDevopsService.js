const { fetchWithRetry } = require("../utils/fetchWithRetry");

/**
 * Returns the Base-64-encoded authorisation header value for Azure DevOps.
 * Throws early if the PAT is not configured.
 */
function authHeader() {
  const pat = process.env.AZURE_DEVOPS_PAT;
  if (!pat) {
    throw new Error("AZURE_DEVOPS_PAT environment variable is not set.");
  }
  const token = Buffer.from(`:${pat}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Returns the Azure DevOps organisation URL, or throws if not configured.
 * Centralises the ORG env-var check so callers don't repeat it.
 */
function orgUrl() {
  const org = process.env.AZURE_DEVOPS_ORG;
  if (!org) {
    throw new Error("AZURE_DEVOPS_ORG environment variable is not set.");
  }
  return org;
}

// ---------------------------------------------------------------------------
// Webhook payload extractors
// ---------------------------------------------------------------------------

/**
 * Extracts relevant work-item data from an Azure DevOps webhook payload.
 *
 * @param {object} payload - The raw webhook body.
 * @returns {object}         { id, title, description, workItemType, project, url }
 */
function extractWorkItemDataFromWebhook(payload) {
  const resource = payload.resource || {};
  const fields = resource.fields || {};

  return {
    id: resource.id || resource.workItemId || null,
    title: fields["System.Title"] || "(no title)",
    description: fields["System.Description"] || "(no description)",
    acceptanceCriteria: fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || "",
    workItemType: fields["System.WorkItemType"] || "Unknown",
    project:
      fields["System.TeamProject"] ||
      payload?.resourceContainers?.project?.id ||
      null,
    url: resource.url || resource?._links?.html?.href || null,
  };
}

// ---------------------------------------------------------------------------
// Comment helpers
// ---------------------------------------------------------------------------

/** Shared retry options for Azure DevOps API calls. */
function devopsRetryOpts(context) {
  const timeoutMs = parseInt(process.env.DEVOPS_TIMEOUT_MS, 10) || 30000;
  const maxRetries = parseInt(process.env.DEVOPS_MAX_RETRIES, 10) || 3;
  return {
    maxRetries,
    timeoutMs,
    baseDelayMs: 1000,
    context,
  };
}

/**
 * Posts a comment (HTML) to a work item.
 *
 * Uses the Azure DevOps REST API:
 * POST {org}/{project}/_apis/wit/workItems/{id}/comments?api-version=7.1-preview.4
 *
 * @param {string|number} project     - Project name or ID.
 * @param {number}        workItemId  - The work item ID.
 * @param {string}        commentHtml - The comment body (HTML supported).
 * @param {object}        context     - Azure Function context for logging.
 */
async function postCommentToWorkItem(project, workItemId, commentHtml, context) {
  const url =
    `${orgUrl()}/${encodeURIComponent(project)}` +
    `/_apis/wit/workItems/${encodeURIComponent(workItemId)}/comments?api-version=7.1-preview.4`;

  context.log(`Posting comment to work item ${workItemId} in project "${project}"...`);

  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify({ text: commentHtml }),
    },
    devopsRetryOpts(context)
  );

  if (!response.ok) {
    const errorBody = await response.text();
    context.log.error(
      `Failed to post work-item comment (${response.status}): ${errorBody}`
    );
    throw new Error(
      `Azure DevOps API returned ${response.status} when posting work-item comment.`
    );
  }

  context.log(`Comment posted successfully to work item ${workItemId}.`);
  return response.json();
}

module.exports = {
  extractWorkItemDataFromWebhook,
  postCommentToWorkItem,
};
