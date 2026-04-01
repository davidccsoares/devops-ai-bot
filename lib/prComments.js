/**
 * Post comment threads on Azure DevOps pull requests.
 *
 * Different from services/azureDevopsService.js postCommentToWorkItem()
 * which posts to work-item discussions. This posts to PR thread comments.
 */

const { fetchWithRetry } = require("../utils/fetchWithRetry");
const { orgUrl, retryOpts, AZURE_API_VERSION } = require("./azurePr");

/**
 * Post a comment thread on an Azure DevOps pull request.
 * @param {string} project
 * @param {string} repoId
 * @param {number} prId
 * @param {object} headers – Azure authorization headers
 * @param {string} content – Markdown content of the comment
 * @param {object} context – Azure Function context for logging
 * @param {string} [tag=""] – Logging tag
 */
async function postPrComment(project, repoId, prId, headers, content, context, tag = "") {
  const threadUrl =
    `${orgUrl()}/${project}/_apis/git/repositories/${repoId}` +
    `/pullRequests/${prId}/threads?api-version=${AZURE_API_VERSION}`;

  const payload = {
    comments: [
      {
        parentCommentId: 0,
        content,
        commentType: 1,
      },
    ],
    status: 4,
  };

  try {
    const res = await fetchWithRetry(
      threadUrl,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      retryOpts(context, tag)
    );

    if (res.ok) {
      context.log(`[${tag}] Comment posted to PR ${prId}`);
    } else {
      const errText = await res.text();
      context.log.error(`[${tag}] Comment post failed: ${res.status} ${errText}`);
    }
  } catch (e) {
    context.log.error(`[${tag}] Comment post error: ${e.message}`);
  }
}

module.exports = { postPrComment };
