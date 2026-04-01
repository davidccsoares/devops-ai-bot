/**
 * Azure DevOps PR-level API helpers.
 *
 * Complements the existing services/azureDevopsService.js (which handles
 * work-item operations) with helpers for Git / Pull-Request APIs.
 */

const { fetchWithRetry } = require("../utils/fetchWithRetry");
const { AZURE_API_VERSION, AZURE_API_VERSION_FILEDIFFS } = require("./constants");

/**
 * Returns the Azure DevOps organisation URL from env.
 * Falls back to a hardcoded default for backward compat.
 */
function orgUrl() {
  return process.env.AZURE_DEVOPS_ORG || "https://dev.azure.com/bindtuning";
}

/**
 * Build Azure DevOps Basic-auth headers from the PAT.
 * @param {string} [token] - PAT override. Defaults to process.env.AZURE_DEVOPS_PAT.
 * @returns {{ Authorization: string }}
 */
function azureHeaders(token) {
  const pat = token || process.env.AZURE_DEVOPS_PAT;
  if (!pat) throw new Error("AZURE_DEVOPS_PAT is not configured.");
  return { Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}` };
}

/** Shared retry options for Azure DevOps API calls. */
function retryOpts(context, _tag) {
  return {
    maxRetries: 3,
    timeoutMs: 15000,
    baseDelayMs: 1000,
    context,
  };
}

/**
 * Fetch a single file's content at a specific commit.
 * @returns {Promise<string|null>}
 */
async function fetchFileAtCommit(project, repoId, path, commitId, headers, context) {
  const url =
    `${orgUrl()}/${project}/_apis/git/repositories/${repoId}/items` +
    `?path=${encodeURIComponent(path)}` +
    `&versionDescriptor.version=${commitId}` +
    `&versionDescriptor.versionType=commit` +
    `&includeContent=true` +
    `&api-version=${AZURE_API_VERSION}`;
  try {
    const res = await fetchWithRetry(url, { headers }, retryOpts(context));
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

module.exports = {
  orgUrl,
  azureHeaders,
  retryOpts,
  fetchFileAtCommit,
  AZURE_API_VERSION,
  AZURE_API_VERSION_FILEDIFFS,
};
