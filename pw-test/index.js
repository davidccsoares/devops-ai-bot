const { fetchWithRetry } = require("../utils/fetchWithRetry");
const { orgUrl, azureHeaders, retryOpts, AZURE_API_VERSION } = require("../lib/azurePr");
const { runTestGeneration } = require("../functions/playwrightContext");

const PLAYWRIGHT_REPO_NAME = "BindTuning.AdminApp";
const PLAYWRIGHT_TARGET_BRANCH = "refs/heads/Dev";
const PLAYWRIGHT_PROJECT = "BindTuning";
const MAX_COMPONENT_FILES = 10;

/**
 * Azure Function: Manual Playwright Test Trigger
 *
 * GET /api/pw-test          — Find a real open PR and trigger test generation
 * GET /api/pw-test?dryRun=true  — Same but skip push/pipeline/comment
 */
module.exports = async function (context, req) {
  const dryRun = req.query?.dryRun === "true";
  const ORG = orgUrl();
  const headers = azureHeaders();

  context.log("[PW-Test] /pw-test endpoint hit");

  try {
    // Find the AdminApp repo
    const repoUrl = `${ORG}/${PLAYWRIGHT_PROJECT}/_apis/git/repositories/${PLAYWRIGHT_REPO_NAME}?api-version=${AZURE_API_VERSION}`;
    const repoRes = await fetchWithRetry(repoUrl, { headers }, retryOpts(context, "PW-Test"));

    let repoId = null;
    if (repoRes.ok) {
      const repoData = await repoRes.json();
      repoId = repoData.id;
    }

    // Try to find a real open PR targeting Dev
    let realPr = null;
    if (repoId) {
      const prListUrl = `${ORG}/${PLAYWRIGHT_PROJECT}/_apis/git/repositories/${repoId}/pullrequests?searchCriteria.status=active&searchCriteria.targetRefName=${PLAYWRIGHT_TARGET_BRANCH}&$top=1&api-version=${AZURE_API_VERSION}`;
      const prListRes = await fetchWithRetry(prListUrl, { headers }, retryOpts(context, "PW-Test"));
      if (prListRes.ok) {
        const prListData = await prListRes.json();
        realPr = (prListData.value || [])[0] || null;
      }
    }

    if (realPr && repoId) {
      const prId = realPr.pullRequestId;
      const prTitle = realPr.title || "Test PR";
      const sourceCommit = realPr.lastMergeSourceCommit?.commitId;

      if (!sourceCommit) {
        context.res = { status: 422, body: { error: "Found PR but missing merge commit IDs" } };
        return;
      }

      // Get changed files
      const iterUrl = `${ORG}/${PLAYWRIGHT_PROJECT}/_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations?api-version=${AZURE_API_VERSION}`;
      const iterRes = await fetchWithRetry(iterUrl, { headers }, retryOpts(context, "PW-Test"));
      if (!iterRes.ok) { context.res = { status: 500, body: { error: "Failed to fetch PR iterations" } }; return; }
      const iterData = await iterRes.json();
      const latestIteration = Math.max(...iterData.value.map(i => i.id));

      const changesUrl = `${ORG}/${PLAYWRIGHT_PROJECT}/_apis/git/repositories/${repoId}/pullRequests/${prId}/iterations/${latestIteration}/changes?api-version=${AZURE_API_VERSION}`;
      const changesRes = await fetchWithRetry(changesUrl, { headers }, retryOpts(context, "PW-Test"));
      if (!changesRes.ok) { context.res = { status: 500, body: { error: "Failed to fetch PR changes" } }; return; }
      const changesData = await changesRes.json();
      const entries = changesData.changeEntries || changesData.changes || [];

      const eligibleEntries = entries.filter(e => {
        if (!e.item?.path || e.item.path.endsWith("/")) return false;
        const ct = typeof e.changeType === "string" ? e.changeType.toLowerCase() : e.changeType;
        return ct === "edit" || ct === 2 || ct === "add" || ct === 1;
      }).slice(0, MAX_COMPONENT_FILES);

      const fileResults = await Promise.allSettled(
        eligibleEntries.map(async (e) => {
          const ct = typeof e.changeType === "string" ? e.changeType.toLowerCase() : e.changeType;
          const isAdd = ct === "add" || ct === 1;
          const fileUrl = `${ORG}/${PLAYWRIGHT_PROJECT}/_apis/git/repositories/${repoId}/items?path=${encodeURIComponent(e.item.path)}&versionDescriptor.version=${sourceCommit}&versionDescriptor.versionType=commit&includeContent=true&api-version=${AZURE_API_VERSION}`;
          const fileRes = await fetchWithRetry(fileUrl, { headers }, { maxRetries: 1, timeoutMs: 10000 });
          if (!fileRes.ok) return null;
          const content = await fileRes.text();
          const lines = content.split("\n").slice(0, 80);
          const diff = lines.map((l, idx) => `+${idx + 1}: ${l}`).join("\n");
          return { path: e.item.path, diff, isAdd };
        })
      );

      const fileChanges = fileResults.filter(r => r.status === "fulfilled" && r.value !== null).map(r => r.value);

      await runTestGeneration({ prId, repoId, project: PLAYWRIGHT_PROJECT, prTitle, fileChanges, dryRun }, context);

      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          status: dryRun ? "Triggered (DRY RUN)" : "Triggered",
          dryRun, pr: prId, title: prTitle, filesAnalyzed: fileChanges.length,
        },
      };
    } else {
      // No real PR — use mock data
      const mockFileChanges = [
        { path: "/src/app/features/dashboard/dashboard.component.ts", diff: "+1: import { Component } from '@angular/core';", isAdd: true },
      ];

      await runTestGeneration({
        prId: 99999, repoId: repoId || "mock-repo-id",
        project: PLAYWRIGHT_PROJECT, prTitle: "[TEST] Mock PR", fileChanges: mockFileChanges, dryRun,
      }, context);

      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { status: "Triggered (MOCK DATA)", dryRun, note: "No real AdminApp PR found." },
      };
    }
  } catch (e) {
    context.log.error(`[PW-Test] Error: ${e.message}`);
    context.res = { status: 500, body: { error: e.message } };
  }
};
