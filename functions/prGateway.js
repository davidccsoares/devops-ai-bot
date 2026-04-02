/**
 * PR Review Gateway — orchestration + file classification.
 *
 * Ported from ai-pr-review/src/worker.js (Cloudflare Workers → Azure Functions).
 *
 * Receives Azure DevOps PR webhooks, classifies files, fetches work items,
 * auto-tags the PR, then delegates to the reviewer and optionally to Playwright.
 */

const { fetchWithRetry } = require("../utils/fetchWithRetry");
const { orgUrl, azureHeaders, retryOpts, AZURE_API_VERSION } = require("../lib/azurePr");
const { MAX_BATCH_FILES } = require("../lib/constants");
const { processReview } = require("./prReviewer");

const MAX_BACKLOG_SIZE = 3000;

// ─── HTML Stripping ──────────────────────────────────────────────────────────

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|ul|ol|h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ─── Work Items ──────────────────────────────────────────────────────────────

async function fetchLinkedWorkItems(project, repoId, prId, headers, context) {
  const ORG = orgUrl();
  try {
    const refsUrl = `${ORG}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/workitems?api-version=${AZURE_API_VERSION}`;
    const refsRes = await fetchWithRetry(refsUrl, { headers }, retryOpts(context, "Gateway"));
    if (!refsRes.ok) return [];
    const refsData = await refsRes.json();
    const refs = refsData.value || [];
    if (refs.length === 0) return [];

    const ids = refs.map((r) => r.id).join(",");
    const wiUrl = `${ORG}/${project}/_apis/wit/workitems?ids=${ids}&$expand=relations&api-version=${AZURE_API_VERSION}`;
    const wiRes = await fetchWithRetry(wiUrl, { headers }, retryOpts(context, "Gateway"));
    if (!wiRes.ok) return [];
    const wiData = await wiRes.json();
    const workItems = (wiData.value || []).map((wi) => ({
      id: wi.id,
      type: wi.fields["System.WorkItemType"],
      title: wi.fields["System.Title"],
      state: wi.fields["System.State"],
      description: stripHtml(wi.fields["System.Description"]),
      acceptanceCriteria: stripHtml(wi.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || ""),
      tags: wi.fields["System.Tags"] || "",
      _relations: wi.relations || [],
    }));

    // Fetch parent work items
    const parentIds = new Set();
    for (const wi of workItems) {
      const parentRel = wi._relations.find((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse");
      if (parentRel) {
        const parentId = parentRel.url.split("/").pop();
        if (!refs.some((r) => String(r.id) === parentId)) parentIds.add(parentId);
      }
    }

    const parentMap = {};
    if (parentIds.size > 0) {
      const parentUrl = `${ORG}/${project}/_apis/wit/workitems?ids=${[...parentIds].join(",")}&api-version=${AZURE_API_VERSION}`;
      const parentRes = await fetchWithRetry(parentUrl, { headers }, retryOpts(context, "Gateway"));
      if (parentRes.ok) {
        const parentData = await parentRes.json();
        for (const pw of parentData.value || []) {
          parentMap[pw.id] = {
            id: pw.id,
            type: pw.fields["System.WorkItemType"],
            title: pw.fields["System.Title"],
            description: stripHtml(pw.fields["System.Description"]),
            acceptanceCriteria: stripHtml(pw.fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || ""),
          };
        }
      }
    }

    return workItems.map((wi) => {
      const parentRel = wi._relations.find((r) => r.rel === "System.LinkTypes.Hierarchy-Reverse");
      const parentId = parentRel ? parentRel.url.split("/").pop() : null;
      const { _relations: _rel, ...clean } = wi;
      return { ...clean, parent: parentId ? parentMap[parentId] || null : null };
    });
  } catch (err) {
    context.log.error(`[Gateway] Error fetching work items: ${err.message}`);
    return [];
  }
}

function buildBacklogContext(workItems) {
  if (workItems.length === 0) return "";
  let context = "\n## Linked Work Items (Product Backlog)\n";
  for (const wi of workItems) {
    let section = `\n### ${wi.type} #${wi.id}: ${wi.title}`;
    section += `\nState: ${wi.state}`;
    if (wi.tags) section += ` | Tags: ${wi.tags}`;
    section += "\n";
    if (wi.description) section += `**Description:** ${wi.description.substring(0, 500)}\n`;
    if (wi.acceptanceCriteria) section += `**Acceptance Criteria:** ${wi.acceptanceCriteria.substring(0, 500)}\n`;
    if (wi.parent) {
      section += `\n> **Parent ${wi.parent.type} #${wi.parent.id}:** ${wi.parent.title}\n`;
      if (wi.parent.acceptanceCriteria) section += `> **Parent Acceptance Criteria:** ${wi.parent.acceptanceCriteria.substring(0, 400)}\n`;
    }
    if (context.length + section.length > MAX_BACKLOG_SIZE) break;
    context += section;
  }
  return context;
}

// ─── File Classification ─────────────────────────────────────────────────────

const SKIP_PATTERNS = [
  /package-lock\.json$/i, /yarn\.lock$/i, /pnpm-lock\.yaml$/i,
  /\.designer\.cs$/i, /\.g\.cs$/i, /\.g\.i\.cs$/i, /\.generated\.cs$/i,
  /AssemblyInfo\.cs$/i, /\.csproj$/i, /\.sln$/i, /\.suo$/i, /\.user$/i,
  /\/bin\//, /\/obj\//, /\/migrations\//i, /\.migration\.cs$/i,
  /\.resx$/i, /\.xaml$/i, /appsettings(\.\w+)?\.json$/i, /launchSettings\.json$/i,
  /\.min\.js$/i, /\.min\.css$/i, /\.bundle\.js$/i,
  /\/dist\//, /\/node_modules\//, /\/lib\//, /\/coverage\//,
  /angular\.json$/i, /karma\.conf\.js$/i, /protractor\.conf\.js$/i,
  /polyfills\.ts$/i, /environment\.(prod|dev|staging)\.ts$/i, /\.browserslistrc$/i,
  /\.manifest\.json$/i, /\.yo-rc\.json$/i,
  /\/config\/(config|deploy-azure-storage|package-solution|serve|write-manifests)\.json$/i,
  /gulpfile\.js$/i, /\/loc\/[^/]+\.(d\.ts|js)$/i,
  /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|mp4|mp3|zip|pdf|webp)$/i,
  /\.md$/i, /\.txt$/i, /LICENSE/i, /\.gitignore$/i, /\.gitattributes$/i,
  /\.editorconfig$/i, /\.prettierrc/i, /\.eslintrc/i, /tsconfig.*\.json$/i,
  /\.dockerignore$/i, /Dockerfile$/i, /docker-compose/i,
  /tslint\.json$/i, /\.npmignore$/i,
];

const HIGH_EXTENSIONS = /\.(cs|ts|tsx|js|jsx|py|go|rs|java|kt|rb|swift|vue|svelte)$/i;
const LOW_EXTENSIONS = /\.(test\.|spec\.|tests\.|_test\.|_spec\.)/i;
const LOW_PATHS = /\/(tests?|__tests__|specs?|testing|stylesheets?|styles|e2e)\//i;
const LOW_FILE_EXTENSIONS = /\.(css|scss|sass|less)$/i;
const ANGULAR_TEMPLATE = /\.component\.html$/i;

const PRIORITY_KEYWORDS = [
  { pattern: /(controller|handler|endpoint)/i, score: 10 },
  { pattern: /(service|repository|provider|manager)/i, score: 8 },
  { pattern: /(middleware|filter|interceptor|guard|attribute)/i, score: 7 },
  { pattern: /(startup|program)\.cs$/i, score: 7 },
  { pattern: /(model|entity|schema|dto|viewmodel)/i, score: 5 },
  { pattern: /\.component\.ts$/i, score: 9 },
  { pattern: /\.service\.ts$/i, score: 8 },
  { pattern: /\.guard\.ts$/i, score: 7 },
  { pattern: /\.interceptor\.ts$/i, score: 7 },
  { pattern: /\.resolver\.ts$/i, score: 7 },
  { pattern: /\.directive\.ts$/i, score: 6 },
  { pattern: /\.pipe\.ts$/i, score: 5 },
  { pattern: /\.module\.ts$/i, score: 4 },
  { pattern: /\.component\.html$/i, score: 6 },
  { pattern: /WebPart\.ts$/i, score: 9 },
  { pattern: /\.extension\.ts$/i, score: 8 },
  { pattern: /\.command\.ts$/i, score: 8 },
  { pattern: /(api|route)/i, score: 9 },
  { pattern: /(util|helper|extension|config)/i, score: 3 },
];

function classifyFiles(entries) {
  const skip = [], high = [], low = [];
  for (const c of entries) {
    const path = c.item?.path;
    const changeType = c.changeType;
    if (!path || path.endsWith("/")) continue;
    const ct = typeof changeType === "string" ? changeType.toLowerCase() : changeType;
    const isEdit = ct === "edit" || ct === 2;
    const isAdd = ct === "add" || ct === 1;
    if (!isEdit && !isAdd) continue;
    const fileInfo = { path, changeType: ct, isEdit, isAdd, changeTrackingId: c.changeTrackingId };
    if (SKIP_PATTERNS.some((re) => re.test(path))) { skip.push(fileInfo); continue; }
    if (ANGULAR_TEMPLATE.test(path)) {
      let priorityScore = 6;
      for (const kw of PRIORITY_KEYWORDS) if (kw.pattern.test(path)) priorityScore = Math.max(priorityScore, kw.score);
      fileInfo.priorityScore = priorityScore;
      high.push(fileInfo); continue;
    }
    if (LOW_EXTENSIONS.test(path) || LOW_PATHS.test(path) || LOW_FILE_EXTENSIONS.test(path)) { low.push(fileInfo); continue; }
    if (HIGH_EXTENSIONS.test(path)) {
      let priorityScore = 1;
      for (const kw of PRIORITY_KEYWORDS) if (kw.pattern.test(path)) priorityScore = Math.max(priorityScore, kw.score);
      fileInfo.priorityScore = priorityScore;
      high.push(fileInfo); continue;
    }
    low.push(fileInfo);
  }
  high.sort((a, b) => b.priorityScore - a.priorityScore);
  return { skip, high, low };
}

// ─── PR Auto-Tagging ─────────────────────────────────────────────────────────

const BACKEND_PATTERN = /\.(cs|py|go|rs|java|kt|rb)$/i;
const FRONTEND_PATTERN = /\.(ts|tsx|js|jsx|vue|svelte|component\.html)$/i;

function computePrLabels(classified, workItems = []) {
  const labels = [];
  const allReviewable = [...classified.high, ...classified.low];
  if (allReviewable.length === 0 && classified.skip.length > 0) { labels.push("docs-only"); return labels; }
  if (allReviewable.length > 0 && allReviewable.every(f => LOW_EXTENSIONS.test(f.path) || LOW_PATHS.test(f.path))) labels.push("tests-only");
  if (allReviewable.length >= 15) labels.push("large-pr");
  if (classified.high.length >= 5) labels.push("high-risk");
  if (workItems.length === 0) labels.push("needs-backlog");
  if (!labels.includes("tests-only")) {
    if (allReviewable.some(f => BACKEND_PATTERN.test(f.path))) labels.push("backend");
    if (allReviewable.some(f => FRONTEND_PATTERN.test(f.path))) labels.push("frontend");
  }
  return labels;
}

async function applyPrLabels(project, repoId, prId, labels, headers, context) {
  if (labels.length === 0) return;
  const ORG = orgUrl();
  const baseUrl = `${ORG}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/labels?api-version=${AZURE_API_VERSION}`;
  const results = await Promise.allSettled(
    labels.map(label =>
      fetchWithRetry(baseUrl, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: label }),
      }, { maxRetries: 1, timeoutMs: 5000 })
    )
  );
  const succeeded = results.filter(r => r.status === "fulfilled" && r.value?.ok).length;
  context.log(`[Gateway] PR labels: ${succeeded}/${labels.length} applied (${labels.join(", ")})`);
}

// ─── Playwright Eligibility ──────────────────────────────────────────────────

function isPlaywrightEligible(payload) {
  const repoName = payload.resource?.repository?.name;
  const targetBranch = payload.resource?.targetRefName;
  const expectedRepo = process.env.PLAYWRIGHT_REPO_NAME || "BindTuning.AdminApp";
  const expectedBranch = process.env.PLAYWRIGHT_TARGET_BRANCH || "refs/heads/Dev";
  return repoName === expectedRepo && targetBranch === expectedBranch;
}

// ─── Main Gateway Entry Point ────────────────────────────────────────────────

async function processGateway(payload, context) {
  const prId = payload.resource.pullRequestId;
  const repoId = payload.resource.repository.id;
  const project = payload.resource.repository.project.name;
  const prTitle = payload.resource.title || "";
  const sourceCommit = payload.resource.lastMergeSourceCommit.commitId;
  const targetCommit = payload.resource.lastMergeTargetCommit.commitId;

  context.log(`[Gateway] Processing PR ${prId}: "${prTitle}"`);
  const headers = azureHeaders();
  const ORG = orgUrl();

  // 1. Get latest iteration
  const iterUrl = `${ORG}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations?api-version=${AZURE_API_VERSION}`;
  const iterRes = await fetchWithRetry(iterUrl, { headers }, retryOpts(context, "Gateway"));
  if (!iterRes.ok) { context.log.error(`[Gateway] Failed to fetch iterations: ${iterRes.status}`); return; }
  const iterData = await iterRes.json();
  const latestIteration = Math.max(...iterData.value.map((i) => i.id));

  // 2. Get changed files
  const changesUrl = `${ORG}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations/${latestIteration}/changes?api-version=${AZURE_API_VERSION}`;
  const changesRes = await fetchWithRetry(changesUrl, { headers }, retryOpts(context, "Gateway"));
  if (!changesRes.ok) { context.log.error(`[Gateway] Failed to fetch changes: ${changesRes.status}`); return; }
  const changesData = await changesRes.json();
  const entries = changesData.changeEntries || changesData.changes || [];

  // 3. Fetch linked work items
  const workItems = await fetchLinkedWorkItems(project, repoId, prId, headers, context);
  context.log(`[Gateway] Linked work items: ${workItems.length}`);
  const backlogContext = buildBacklogContext(workItems);

  // 4. Classify files
  const classified = classifyFiles(entries);
  context.log(`[Gateway] Classification: ${classified.high.length} HIGH, ${classified.low.length} LOW, ${classified.skip.length} SKIP`);

  // 4b. Auto-tag PR
  const prLabels = computePrLabels(classified, workItems);
  if (prLabels.length > 0) {
    applyPrLabels(project, repoId, prId, prLabels, headers, context).catch(e => context.log(`[Gateway] Label error: ${e.message}`));
  }

  const reviewableFiles = [...classified.high, ...classified.low];
  const totalFiles = classified.high.length + classified.low.length + classified.skip.length;
  const skippedFiles = classified.skip.length;

  if (reviewableFiles.length === 0) {
    context.log("[Gateway] No reviewable files found after classification");
    return;
  }

  // 5. Delegate to reviewer
  const batchFiles = reviewableFiles.slice(0, MAX_BATCH_FILES);
  const remainingFiles = reviewableFiles.slice(MAX_BATCH_FILES);

  await processReview({
    pr: { id: prId, repoId, project, title: prTitle, sourceCommit, targetCommit },
    batchFiles,
    remainingFiles,
    backlogContext,
    workItems,
    totalFiles,
    skippedFiles,
  }, context);

  // 6. Playwright test generation (if eligible)
  if (isPlaywrightEligible(payload)) {
    context.log("[Gateway] PR is eligible for Playwright, delegating");
    try {
      const { runTestGeneration } = require("./playwrightContext");
      await runTestGeneration({
        prId, repoId, project, prTitle,
        fileChanges: reviewableFiles.map(f => ({ path: f.path, diff: "", isAdd: f.isAdd })),
      }, context);
    } catch (e) {
      context.log.error(`[Gateway] Playwright delegation failed: ${e.message}`);
    }
  }

  context.log(`[Gateway] Done routing PR ${prId}`);
}

module.exports = {
  processGateway,
  stripHtml,
  classifyFiles,
  computePrLabels,
  buildBacklogContext,
  SKIP_PATTERNS,
  PRIORITY_KEYWORDS,
};
