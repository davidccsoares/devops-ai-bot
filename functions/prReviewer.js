/**
 * PR Reviewer — "The Reviewer"
 *
 * Ported from ai-pr-review/src/review-worker.js (Cloudflare Workers → Azure Functions).
 *
 * Fetches file diffs from Azure DevOps, calls AI for code review in batches,
 * and posts a unified review comment on the PR.
 *
 * Key simplification from Cloudflare: no self-call HTTP chain.  We just loop.
 */

const { fetchWithRetry } = require("../utils/fetchWithRetry");
const { orgUrl, azureHeaders, retryOpts, fetchFileAtCommit, AZURE_API_VERSION, AZURE_API_VERSION_FILEDIFFS } = require("../lib/azurePr");
const { postPrComment } = require("../lib/prComments");
const { CONTEXT_LINES, truncateDiffAtHunkBoundary } = require("../lib/diffs");
const { scanForSecrets } = require("../lib/secrets");
const { aiReviewBatch } = require("../lib/prompts");
const { MAX_BATCH_FILES } = require("../lib/constants");
const { kvStore } = require("../lib/kvStore");

const MAX_FILE_DIFF = 12000;
const REVIEW_ISSUES_TTL = 7 * 24 * 3600; // 7 days

// ─── Risk Scoring ─────────────────────────────────────────────────────────────

function calculateRisk(fileChanges, totalChangedLines) {
  let score = 0;
  score += fileChanges.length * 2;
  score += Math.floor(totalChangedLines / 10);
  for (const fc of fileChanges) {
    if (fc.diff.length > 1500) score += 3;
  }
  return Math.min(score, 100);
}

function riskLevel(score) {
  if (score < 15) return "LOW";
  if (score < 35) return "MEDIUM";
  return "HIGH";
}

// ─── Re-review Tracking ───────────────────────────────────────────────────────

function extractIssues(comments) {
  if (!Array.isArray(comments)) return [];
  return comments
    .filter(c => {
      if (!c.file || !c.comment) return false;
      const lower = c.comment.toLowerCase().trim();
      if (lower.includes("lgtm")) return false;
      if (lower.startsWith("\u26a0\ufe0f ai review skipped")) return false;
      return true;
    })
    .map(c => ({
      file: c.file,
      line: c.line,
      comment: c.comment,
      key: `${c.file}::${c.comment.trim().toLowerCase().replace(/\s+/g, " ")}`,
    }));
}

function diffReviewIssues(previousIssues, currentIssues) {
  const prevKeys = new Set(previousIssues.map(i => i.key));
  const currKeys = new Set(currentIssues.map(i => i.key));
  return {
    resolved: previousIssues.filter(i => !currKeys.has(i.key)),
    stillOpen: currentIssues.filter(i => prevKeys.has(i.key)),
    new: currentIssues.filter(i => !prevKeys.has(i.key)),
  };
}

function buildFollowUpSection(diff, reviewNumber) {
  const lines = [`### \ud83d\udd04 Follow-up Review (iteration #${reviewNumber})`, ``];
  if (diff.resolved.length > 0) {
    lines.push(`**\u2705 ${diff.resolved.length} issue${diff.resolved.length !== 1 ? "s" : ""} resolved** since last review:`);
    for (const issue of diff.resolved) {
      const fileName = issue.file.split("/").pop();
      lines.push(`- ~\`${fileName}\` line ${issue.line}: ${issue.comment}~`);
    }
    lines.push(``);
  }
  if (diff.stillOpen.length > 0) {
    lines.push(`**\u26a0\ufe0f ${diff.stillOpen.length} issue${diff.stillOpen.length !== 1 ? "s" : ""} still open:**`);
    for (const issue of diff.stillOpen) {
      const fileName = issue.file.split("/").pop();
      lines.push(`- \`${fileName}\` line ${issue.line}: ${issue.comment}`);
    }
    lines.push(``);
  }
  if (diff.new.length > 0) {
    lines.push(`**\ud83c\udd95 ${diff.new.length} new issue${diff.new.length !== 1 ? "s" : ""} found:**`);
    for (const issue of diff.new) {
      const fileName = issue.file.split("/").pop();
      lines.push(`- \`${fileName}\` line ${issue.line}: ${issue.comment}`);
    }
    lines.push(``);
  }
  if (diff.resolved.length > 0 && diff.stillOpen.length === 0 && diff.new.length === 0) {
    lines.push(`\ud83c\udf89 **All previous issues have been addressed!**`, ``);
  }
  lines.push(`---`, ``);
  return lines.join("\n");
}

// ─── Fetch + Diff Files ─────────────────────────────────────────────────────

async function fetchAndDiffFiles(files, project, repoId, sourceCommit, targetCommit, headers, context) {
  const ORG = orgUrl();
  const fileChanges = [];
  let totalChangedLines = 0;

  // 1. Get line-level diffs from Azure for all files in the batch
  const fileDiffParams = files.map((f) => ({ path: f.path, originalPath: f.path }));
  const fileDiffsUrl = `${ORG}/${project}/_apis/git/repositories/${repoId}/filediffs?api-version=${AZURE_API_VERSION_FILEDIFFS}`;

  let fileDiffsData = [];
  try {
    const fileDiffsRes = await fetchWithRetry(
      fileDiffsUrl,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          baseVersionCommit: targetCommit,
          targetVersionCommit: sourceCommit,
          fileDiffParams,
        }),
      },
      retryOpts(context, "Review")
    );

    if (fileDiffsRes.ok) {
      const data = await fileDiffsRes.json();
      fileDiffsData = data.value || data || [];
    } else {
      context.log.error(`[Review] File diffs API failed: ${fileDiffsRes.status}`);
    }
  } catch (e) {
    context.log.error(`[Review] File diffs API error: ${e.message}`);
  }

  // Build a map of path → lineDiffBlocks
  const diffBlocksByPath = new Map();
  for (const fd of fileDiffsData) {
    const p = fd.path || fd.originalPath;
    if (p && fd.lineDiffBlocks) diffBlocksByPath.set(p, fd.lineDiffBlocks);
  }

  // 2. Fetch all file contents in parallel, then build diffs
  const contentResults = await Promise.allSettled(
    files.map(async (f) => {
      const content = await fetchFileAtCommit(project, repoId, f.path, sourceCommit, headers, context);
      return { file: f, content };
    })
  );

  for (const result of contentResults) {
    if (result.status !== "fulfilled") continue;
    const { file: f, content: newContent } = result.value;
    if (newContent === null) continue;

    const newLines = newContent.split("\n");

    if (f.isAdd) {
      const lines = newLines.slice(0, 80);
      const diff = lines.map((l, idx) => `+${idx + 1}: ${l}`).join("\n");
      const changedLines = lines.map((_, idx) => idx + 1);
      totalChangedLines += changedLines.length;
      fileChanges.push({
        path: f.path,
        changeTrackingId: f.changeTrackingId,
        isAdd: true,
        diff: truncateDiffAtHunkBoundary(diff, MAX_FILE_DIFF),
        changedLines,
      });
      continue;
    }

    // Edited file — use Azure's lineDiffBlocks
    const blocks = diffBlocksByPath.get(f.path);
    if (!blocks || blocks.length === 0) continue;

    const output = [];
    const changedLines = [];

    for (const block of blocks) {
      const ct = typeof block.changeType === "string" ? block.changeType.toLowerCase() : block.changeType;
      if (ct === 0 || ct === "none") continue;

      const modStart = block.modifiedLineNumberStart;
      const modCount = block.modifiedLinesCount;
      const isDelete = ct === 2 || ct === "delete";

      const ctxBefore = Math.max(0, modStart - 1 - CONTEXT_LINES);
      const ctxAfter = Math.min(newLines.length, modStart - 1 + modCount + CONTEXT_LINES);

      output.push(`@@ line ${modStart} @@`);
      for (let i = ctxBefore; i < ctxAfter; i++) {
        const lineNum = i + 1;
        const isChanged = lineNum >= modStart && lineNum < modStart + modCount;
        if (isChanged) {
          if (isDelete) {
            output.push(`-${lineNum}: (deleted)`);
          } else {
            if (i < newLines.length) {
              output.push(`+${lineNum}: ${newLines[i]}`);
              changedLines.push(lineNum);
            }
          }
        } else {
          if (i < newLines.length) {
            output.push(` ${lineNum}: ${newLines[i]}`);
          }
        }
      }
      output.push("---");
    }

    if (changedLines.length > 0) {
      const diff = output.join("\n");
      totalChangedLines += changedLines.length;
      fileChanges.push({
        path: f.path,
        changeTrackingId: f.changeTrackingId,
        isAdd: false,
        diff: truncateDiffAtHunkBoundary(diff, MAX_FILE_DIFF),
        changedLines,
      });
    }
  }

  return { fileChanges, totalChangedLines };
}

// ─── Post Unified Review Comment ────────────────────────────────────────────

async function postUnifiedReview({
  project, repoId, prId, prTitle,
  allFileChanges, allComments,
  workItems, totalFiles, skippedFiles,
  batchCount, headers, context, backlogContext,
}) {
  const ORG = orgUrl();

  // Re-review tracking
  let previousIssues = [];
  let reviewNumber = 1;
  const reviewKey = `review:${prId}`;
  try {
    const stored = kvStore.get(reviewKey, "json");
    if (stored && Array.isArray(stored.issues)) {
      previousIssues = stored.issues;
      reviewNumber = (stored.reviewNumber || 1) + 1;
    }
  } catch (e) {
    context.log(`[Review] KV read for previous review failed: ${e.message}`);
  }

  // Risk
  const totalChangedLines = allFileChanges.reduce((sum, fc) => sum + (fc.changedLines?.length || 0), 0);
  const riskScore = calculateRisk(allFileChanges, totalChangedLines);
  const risk = riskLevel(riskScore);

  const largestFiles = allFileChanges
    .sort((a, b) => (b.diff?.length || 0) - (a.diff?.length || 0))
    .slice(0, 3)
    .filter(f => f.diff?.length > 500)
    .map(f => f.path);

  // PR summary for large PRs (using cheap model)
  let prSummary = "";
  if (allFileChanges.length >= 5 || totalChangedLines > 100) {
    try {
      const { callAIRaw } = require("../services/aiService");
      const summaryPrompt = `Summarize the following PR changes in 2-3 sentences. Focus on what the PR does, not individual files.
PR Title: "${prTitle}"
Files changed: ${allFileChanges.map(f => f.path).join(", ")}
${backlogContext || ""}`;
      prSummary = await callAIRaw(
        "You are a concise technical writer. Summarize code changes in 2-3 sentences.",
        summaryPrompt,
        context,
        { model: process.env.AI_MODEL_CHEAP, maxTokens: 256 }
      );
    } catch (e) {
      context.log.error(`[Review] PR summary failed: ${e.message}`);
    }
  }

  // Build summary
  const summary = [`## \ud83e\udd16 AI Code Review`, ``];

  const currentIssues = extractIssues(allComments);
  if (previousIssues.length > 0) {
    const diff = diffReviewIssues(previousIssues, currentIssues);
    summary.push(buildFollowUpSection(diff, reviewNumber));
  }

  summary.push(
    `\ud83d\udcca **Reviewed ${allFileChanges.length} of ${totalFiles} files** (${skippedFiles} skipped as non-reviewable)`,
    batchCount > 1 ? `\ud83d\udd04 Processed in **${batchCount} batches**` : ``,
    ``
  );

  if (prSummary) {
    summary.push(`### \ud83d\udccb PR Summary`, ``, prSummary, ``);
  }

  summary.push(`### \u26a0 Risk Analysis`, ``, `Score: **${riskScore}/100**`, `Level: **${risk}**`, ``);

  if (largestFiles.length > 0) {
    summary.push(`### Largest Changes`, ``);
    for (const f of largestFiles) summary.push(`* ${f.split("/").pop()}`);
    summary.push(``);
  }

  // Secret detection
  const secretFindings = scanForSecrets(allFileChanges);
  if (secretFindings.length > 0) {
    summary.push(`### \ud83d\udd12 Security Alerts`, ``);
    for (const f of secretFindings) {
      summary.push(`- **${f.pattern}** found in \`${f.file.split("/").pop()}\` at line ${f.line}`);
    }
    summary.push(``);

    // Apply security-alert label (fire-and-forget)
    const labelUrl = `${ORG}/${project}/_apis/git/repositories/${repoId}/pullRequests/${prId}/labels?api-version=${AZURE_API_VERSION}`;
    fetchWithRetry(
      labelUrl,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "security-alert" }),
      },
      { maxRetries: 1, timeoutMs: 5000 }
    ).catch(() => {});
  }

  if (workItems.length > 0) {
    summary.push(`### \ud83d\udccb Linked Work Items`, ``);
    for (const wi of workItems) {
      summary.push(`* **${wi.type} #${wi.id}:** ${wi.title} (${wi.state})`);
      if (wi.parent) summary.push(`  * \u21b3 Parent: **${wi.parent.type} #${wi.parent.id}:** ${wi.parent.title}`);
    }
    summary.push(``);
  }

  // Per-file results
  if (allComments.length > 0) {
    const byFile = {};
    for (const c of allComments) {
      if (!c.file || !c.comment) continue;
      if (!byFile[c.file]) byFile[c.file] = [];
      byFile[c.file].push(c);
    }

    let hasIssues = false;
    for (const fc of allFileChanges) {
      const fileComments = byFile[fc.path] || [];
      const fileName = fc.path.split("/").pop();
      const isLgtm = fileComments.length > 0 && fileComments.every((c) => c.comment?.toLowerCase().includes("lgtm"));
      if (fileComments.length === 0 || isLgtm) {
        summary.push(`### \u2705 \`${fileName}\``, `No issues found.`, ``);
      } else {
        hasIssues = true;
        summary.push(`### \ud83d\udcdd \`${fileName}\``);
        for (const c of fileComments) {
          if (c.comment?.toLowerCase().includes("lgtm")) continue;
          summary.push(`- **Line ${parseInt(c.line, 10)}:** ${c.comment}`);
        }
        summary.push(``);
      }
    }
    if (!hasIssues) summary.push(`---`, `\u2705 **All changes look good!**`);
  } else {
    summary.push(`\u2705 **No issues found.** Code looks good!`);
  }

  // Post the review
  await postPrComment(project, repoId, prId, headers, summary.join("\n"), context, "Review");

  // Store current issues for future re-review comparison
  try {
    kvStore.put(reviewKey, JSON.stringify({
      issues: currentIssues,
      reviewNumber,
      timestamp: Date.now(),
    }), { expirationTtl: REVIEW_ISSUES_TTL });
  } catch (e) {
    context.log(`[Review] KV write for review issues failed: ${e.message}`);
  }
}

// ─── Main Review Entry Point ────────────────────────────────────────────────

/**
 * Process a PR review request.
 *
 * Unlike the Cloudflare version which self-called via HTTP to handle
 * batches (50-subrequest limit), this simply loops.
 *
 * @param {object} payload
 * @param {object} context - Azure Function context
 */
async function processReview(payload, context) {
  const {
    pr, batchFiles, remainingFiles,
    backlogContext, workItems,
    totalFiles, skippedFiles,
  } = payload;

  const headers = azureHeaders();

  context.log(`[Review] Processing PR ${pr.id}: "${pr.title}"`);

  const allFileChanges = [];
  const allComments = [];
  let batchCount = 0;

  // Process all files in batches — simple loop, no self-calls needed
  const allFiles = [...batchFiles, ...remainingFiles];

  while (allFiles.length > 0) {
    const batch = allFiles.splice(0, MAX_BATCH_FILES);
    batchCount++;
    context.log(`[Review] Batch ${batchCount}: processing ${batch.length} files, ${allFiles.length} remaining`);

    const { fileChanges } = await fetchAndDiffFiles(
      batch, pr.project, pr.repoId, pr.sourceCommit, pr.targetCommit, headers, context
    );

    let batchComments = [];
    try {
      batchComments = await aiReviewBatch(fileChanges, pr.title, backlogContext, context);
    } catch (e) {
      context.log.error(`[Review] AI failed for batch ${batchCount}: ${e.message}`);
      for (const fc of fileChanges) {
        batchComments.push({ file: fc.path, line: 1, comment: "\u26a0\ufe0f Could not review this file (AI error)" });
      }
    }

    allFileChanges.push(...fileChanges);
    allComments.push(...batchComments);
  }

  // Post the unified review
  await postUnifiedReview({
    project: pr.project, repoId: pr.repoId, prId: pr.id, prTitle: pr.title,
    allFileChanges,
    allComments,
    workItems: workItems || [],
    totalFiles,
    skippedFiles,
    batchCount,
    headers, context, backlogContext,
  });

  context.log(`[Review] Done for PR ${pr.id}`);
}

module.exports = {
  processReview,
  calculateRisk,
  riskLevel,
  extractIssues,
  diffReviewIssues,
  buildFollowUpSection,
};
