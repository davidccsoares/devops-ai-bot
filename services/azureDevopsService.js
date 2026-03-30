const { fetchWithRetry } = require("../utils/fetchWithRetry");

const AZURE_DEVOPS_ORG = process.env.AZURE_DEVOPS_ORG; // e.g. https://dev.azure.com/myorg
const AZURE_DEVOPS_PAT = process.env.AZURE_DEVOPS_PAT;

/** Default timeout for Azure DevOps API calls (15 seconds). */
const DEVOPS_TIMEOUT_MS = parseInt(process.env.DEVOPS_TIMEOUT_MS, 10) || 15000;

/**
 * Returns the Base-64-encoded authorisation header value for Azure DevOps.
 * Throws early if the PAT is not configured.
 */
function authHeader() {
  if (!AZURE_DEVOPS_PAT) {
    throw new Error("AZURE_DEVOPS_PAT environment variable is not set.");
  }
  const token = Buffer.from(`:${AZURE_DEVOPS_PAT}`).toString("base64");
  return `Basic ${token}`;
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
    workItemType: fields["System.WorkItemType"] || "Unknown",
    project:
      fields["System.TeamProject"] ||
      payload?.resourceContainers?.project?.id ||
      null,
    url: resource.url || resource?._links?.html?.href || null,
  };
}

/**
 * Extracts relevant pull-request data from an Azure DevOps webhook payload.
 *
 * @param {object} payload - The raw webhook body.
 * @returns {object}         { pullRequestId, title, description, repository, project, linkedWorkItems }
 */
function extractPullRequestDataFromWebhook(payload) {
  const resource = payload.resource || {};
  const repository = resource.repository || {};

  return {
    pullRequestId: resource.pullRequestId || null,
    title: resource.title || "(no title)",
    description: resource.description || "(no description)",
    repositoryName: repository.name || "Unknown",
    repositoryId: repository.id || null,
    project:
      repository?.project?.name ||
      payload?.resourceContainers?.project?.id ||
      null,
    sourceBranch: resource.sourceRefName || "",
    targetBranch: resource.targetRefName || "",
    linkedWorkItems: extractLinkedWorkItems(resource),
    url: resource.url || resource?._links?.web?.href || null,
  };
}

/**
 * Attempts to extract linked work-item references from a pull-request resource.
 */
function extractLinkedWorkItems(resource) {
  if (Array.isArray(resource.workItemRefs)) {
    return resource.workItemRefs.map((ref) => ({
      id: ref.id,
      url: ref.url,
    }));
  }

  if (resource?._links?.workItems) {
    return [{ url: resource._links.workItems.href }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// Comment helpers
// ---------------------------------------------------------------------------

/** Shared retry options for Azure DevOps API calls. */
function devopsRetryOpts(context) {
  return {
    maxRetries: 3,
    timeoutMs: DEVOPS_TIMEOUT_MS,
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
  if (!AZURE_DEVOPS_ORG || !AZURE_DEVOPS_PAT) {
    throw new Error(
      "AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT environment variables must be set."
    );
  }

  const url =
    `${AZURE_DEVOPS_ORG}/${encodeURIComponent(project)}` +
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

/**
 * Posts a comment thread to a pull request.
 *
 * Uses the Azure DevOps REST API:
 * POST {org}/{project}/_apis/git/repositories/{repoId}/pullRequests/{prId}/threads?api-version=7.1-preview.1
 *
 * @param {string}        project        - Project name or ID.
 * @param {string}        repositoryId   - Repository ID.
 * @param {number}        pullRequestId  - The pull request ID.
 * @param {string}        commentContent - The comment body (markdown supported).
 * @param {object}        context        - Azure Function context for logging.
 */
async function postCommentToPullRequest(
  project,
  repositoryId,
  pullRequestId,
  commentContent,
  context
) {
  if (!AZURE_DEVOPS_ORG || !AZURE_DEVOPS_PAT) {
    throw new Error(
      "AZURE_DEVOPS_ORG and AZURE_DEVOPS_PAT environment variables must be set."
    );
  }

  const url =
    `${AZURE_DEVOPS_ORG}/${encodeURIComponent(project)}` +
    `/_apis/git/repositories/${encodeURIComponent(repositoryId)}` +
    `/pullRequests/${encodeURIComponent(pullRequestId)}/threads?api-version=7.1-preview.1`;

  context.log(`Posting comment to PR #${pullRequestId} in repo "${repositoryId}"...`);

  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(),
      },
      body: JSON.stringify({
        comments: [
          {
            parentCommentId: 0,
            content: commentContent,
            commentType: 1, // 1 = text
          },
        ],
        status: 4, // 4 = closed (informational thread)
      }),
    },
    devopsRetryOpts(context)
  );

  if (!response.ok) {
    const errorBody = await response.text();
    context.log.error(
      `Failed to post PR comment (${response.status}): ${errorBody}`
    );
    throw new Error(
      `Azure DevOps API returned ${response.status} when posting PR comment.`
    );
  }

  context.log(`Comment posted successfully to PR #${pullRequestId}.`);
  return response.json();
}

module.exports = {
  extractWorkItemDataFromWebhook,
  extractPullRequestDataFromWebhook,
  postCommentToWorkItem,
  postCommentToPullRequest,
};
