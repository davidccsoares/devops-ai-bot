/**
 * AI prompt construction and response parsing for PR review.
 *
 * Ported from ai-pr-review/src/lib/prompts.js (ESM → CJS).
 * Uses callAIRaw() instead of Cloudflare Workers AI binding.
 */

const { callAIRaw } = require("../services/aiService");

const MAX_DIFF_SIZE = 60000;

// ─── Build Diff Block ───────────────────────────────────────────────────────

/**
 * Concatenate file diffs into a single markdown-formatted block for AI input.
 * Stops adding files once the diff budget (MAX_DIFF_SIZE) is reached.
 * @param {Array<{path: string, diff: string, isAdd: boolean}>} fileChanges
 * @returns {string}
 */
function buildDiffBlock(fileChanges) {
  let diffBlock = "";
  for (const fc of fileChanges) {
    const header = `\n### FILE: ${fc.path} (${fc.isAdd ? "new file" : "edited"})`;
    const section = `${header}\n\`\`\`\n${fc.diff}\n\`\`\`\n`;
    if (diffBlock.length + section.length > MAX_DIFF_SIZE) {
      break;
    }
    diffBlock += section;
  }
  return diffBlock;
}

// ─── AI Review Batch ────────────────────────────────────────────────────────

/**
 * Call AI to review a batch of file changes.
 *
 * @param {Array<{path: string, diff: string, changedLines: number[], isAdd: boolean}>} fileChanges
 * @param {string} prTitle
 * @param {string} backlogContext
 * @param {object} context - Azure Function context for logging
 * @returns {Promise<Array<{file: string, line: number, comment: string}>>}
 */
async function aiReviewBatch(fileChanges, prTitle, backlogContext, context) {
  const diffBlock = buildDiffBlock(fileChanges);
  const fileList = fileChanges.map((fc) => fc.path).join(", ");

  const changedLinesSummary = fileChanges
    .map((fc) => `${fc.path}: lines ${fc.changedLines.join(", ")}`)
    .join("\n");

  context.log(`[Review] AI batch review: ${fileChanges.length} files, ${diffBlock.length} chars`);

  const systemPrompt = `You are a senior code reviewer. Review ONLY the changed lines in the PR diff below.
${backlogContext ? "\nYou will also receive linked product backlog items (user stories, tasks, bugs). Use them to:\n- Understand the INTENT behind the changes and validate the code aligns with the requirements.\n- Check if the code changes are actually RELEVANT to the linked work items. If the work item describes a completely different feature or task than what the code changes implement, flag this mismatch.\n" : ""}
OUTPUT FORMAT — respond with ONLY a raw JSON array, no markdown, no code fences:
[{"file":"/path/to/file.cs","line":42,"comment":"Your feedback"}]

RULES:
1. ONLY comment on lines prefixed with "+" (these are the changed/added lines)
2. NEVER comment on context lines (prefixed with a space) or removed lines (prefixed with "-")
3. "file" must exactly match the file path from the diff header
4. "line" must be the exact line number shown after the "+" prefix — ONLY use line numbers from the CHANGED LINES list below
5. NEVER repeat the same line number — one comment per line, max
6. Keep each comment concise (1-2 sentences)
7. Focus on: actual bugs, null reference risks, security vulnerabilities, clear logic errors
8. Do NOT guess or speculate — only flag issues you are certain about
9. Do NOT comment on code style, naming, or formatting
10. If the changed code looks correct, return: [{"file":"/path","line":1,"comment":"LGTM"}] where "line" is the first changed line number
11. Do NOT flag syntax errors like missing braces, unmatched if/else, or try/catch structure — the diff shows partial code and the IDE already catches these${backlogContext ? "\n12. If the code contradicts or clearly misses a requirement from the linked work items, flag it\n13. If the linked work items describe a DIFFERENT feature/task than what the code actually does, add a comment on the first changed line: \"⚠️ Backlog mismatch: the linked work item is about [X] but this code changes [Y]. Verify the correct work item is linked to this PR.\"" : ""}

IMPORTANT: The ONLY valid line numbers you may use in your response are listed below. Any other line number is WRONG:
${changedLinesSummary}`;

  const userPrompt = `PR: "${prTitle}"
Files changed: ${fileList}
${backlogContext}
${diffBlock}`;

  const rawResponse = await callAIRaw(systemPrompt, userPrompt, context, {
    maxTokens: 2048,
  });

  context.log(`[Review] AI batch response: ${rawResponse?.substring(0, 200)}`);

  // Detect possible truncation — if the response doesn't contain a closing
  // bracket, the AI likely hit the token limit mid-JSON.
  if (typeof rawResponse === "string" && !rawResponse.includes("]")) {
    context.log.warn(
      `[Review] AI response appears truncated (no closing ']' found, ${rawResponse.length} chars). ` +
      "Some files may not have review comments. Consider reducing batch size."
    );
  }

  // Parse AI response into comments array
  try {
    let comments;
    if (typeof rawResponse === "string") {
      const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
      comments = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } else {
      comments = [];
    }
    if (!Array.isArray(comments)) comments = [];

    // Deduplicate: keep only the first comment per file+line
    if (comments.length > 0) {
      const seen = new Set();
      comments = comments.filter((c) => {
        const key = `${c.file}:${c.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // Validate: reject comments on lines that aren't actually changed
    const validLinesByFile = new Map();
    for (const fc of fileChanges) {
      validLinesByFile.set(fc.path, new Set(fc.changedLines));
    }
    const beforeCount = comments.length;
    comments = comments.filter((c) => {
      if (!c.file || !c.line) return false;
      const validLines = validLinesByFile.get(c.file);
      if (!validLines) return false;
      const lineNum = parseInt(c.line, 10);
      if (!validLines.has(lineNum)) return false;
      return true;
    });
    if (beforeCount !== comments.length) {
      context.log(`[Review] Filtered ${beforeCount - comments.length} invalid comments (wrong line numbers)`);
    }
    return comments;
  } catch (e) {
    context.log.error(`[Review] AI JSON parse failed for batch: ${e.message}`);
    return [];
  }
}

module.exports = { buildDiffBlock, aiReviewBatch };
