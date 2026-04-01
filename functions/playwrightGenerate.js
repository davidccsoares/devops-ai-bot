/**
 * Playwright Generate — "The Brain"
 *
 * Ported from ai-pr-review/src/pw-generate-worker.js.
 * Calls AI to generate Playwright tests from component diffs.
 */

const { callAIRaw } = require("../services/aiService");

// ─── AI Test Generation ──────────────────────────────────────────────────────

async function generateTests(componentFiles, mdDocs, existingFiles, prTitle, context) {
  // Build documentation context
  let docsContext = "";
  if (mdDocs.length > 0) {
    docsContext = "\n## Project Documentation (from test branch)\n\n";
    for (const doc of mdDocs) docsContext += `### ${doc.path}\n\`\`\`markdown\n${doc.content}\n\`\`\`\n\n`;
  }

  // Build existing test files context
  let existingContext = "";
  if (existingFiles.length > 0) {
    existingContext = "\n## Existing Test Files (already on the test branch)\n\n";
    existingContext += "These files ALREADY EXIST. Do NOT regenerate them. Reuse their classes and imports.\n\n";
    for (const ef of existingFiles) {
      const source = ef.fullContent || ef.content;
      if (ef.path.includes("actionsFixture")) {
        existingContext += `### ${ef.path}\nThis fixture provides these action objects: ${extractFixtureActions(source).join(", ")}\n\n`;
      } else if (/Actions\.ts$/i.test(ef.path)) {
        const methods = extractMethodSignatures(source);
        existingContext += `### ${ef.path}\nClass with these methods:\n${methods.map(m => "- " + m).join("\n")}\n\n`;
      } else {
        const testNames = extractTestNames(source);
        existingContext += `### ${ef.path}\nExisting tests:\n${testNames.map(n => "- " + n).join("\n")}\n\n`;
      }
    }
  }

  const filesDescription = componentFiles.map(f =>
    `### ${f.path} (${f.isAdd ? "new" : "edited"})\n\`\`\`\n${f.diff}\n\`\`\``
  ).join("\n\n");

  // The system prompt is the same massive prompt from the CF worker
  const systemPrompt = buildSystemPrompt(docsContext, existingContext);

  const userPrompt = `PR: "${prTitle}"\n\nGenerate Playwright test files for the following changed components:\n\n${filesDescription}`;

  try {
    context.log(`[PW-Generate] Generating tests for ${componentFiles.length} files with ${mdDocs.length} docs`);

    const raw = await callAIRaw(systemPrompt, userPrompt, context, { maxTokens: 4096 });
    const rawStr = typeof raw === "string" ? raw.trim() : JSON.stringify(raw);
    context.log(`[PW-Generate] AI response length: ${rawStr?.length ?? 0}`);

    // Parse the JSON array from the AI response
    let tests;
    if (typeof raw === "string") {
      let cleaned = raw.trim();
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          tests = JSON.parse(jsonMatch[0]);
        } catch (_jsonErr) {
          try {
            tests = JSON.parse(sanitizeJsonStringValues(jsonMatch[0]));
          } catch (e2) {
            context.log.error(`[PW-Generate] JSON parse failed after sanitization: ${e2.message}`);
            tests = null;
          }
        }
      }
    }

    if (!Array.isArray(tests) || tests.length === 0) {
      context.log("[PW-Generate] AI did not return valid test array");
      return null;
    }

    const existingPaths = new Set(existingFiles.map(ef => ef.path.replace(/^\//, "").toLowerCase()));

    // Extract registered actions from fixture
    const fixtureFile = existingFiles.find(ef => ef.path.includes("actionsFixture"));
    const registeredActions = new Set();
    if (fixtureFile) {
      const fixtureSource = fixtureFile.fullContent || fixtureFile.content;
      const actionMatches = fixtureSource.matchAll(/(\w+):\s*new\s+\w+Actions\(page\)/g);
      for (const m of actionMatches) registeredActions.add(m[1].toLowerCase());
    }

    // Post-process tests
    return tests.filter(t => t.filePath && t.content).map(t => {
      let filePath = t.filePath.replace(/^\//, "");
      const isAppendOnly = !!t.appendOnly;

      if (filePath.match(/^tests\/[^/]+\.spec\.ts$/) && !filePath.startsWith("tests/components/")) {
        const name = filePath.replace("tests/", "").replace(".spec.ts", "");
        filePath = `tests/components/${name}/${name}.spec.ts`;
      }

      let content = t.content;

      // Handle existing spec files: merge new tests
      const existingSpec = existingFiles.find(ef => ef.path.replace(/^\//, "").toLowerCase() === filePath.toLowerCase());
      if (existingSpec && filePath.endsWith(".spec.ts")) {
        const existingFull = existingSpec.fullContent || existingSpec.content;
        if (isAppendOnly) {
          const lastClose = existingFull.lastIndexOf("});");
          if (lastClose !== -1) {
            content = existingFull.substring(0, lastClose) + "\n" + content.trim() + "\n\n" + existingFull.substring(lastClose);
          } else {
            content = existingFull + "\n\n" + content;
          }
        } else {
          const newTestBlocks = extractTestBlocks(content);
          const existingTestNamesList = extractTestNames(existingFull);
          const uniqueNewTests = newTestBlocks.filter(block => !existingTestNamesList.some(name => block.includes(name)));
          if (uniqueNewTests.length === 0) {
            content = null;
          } else {
            const lastClose = existingFull.lastIndexOf("});");
            if (lastClose !== -1) {
              content = existingFull.substring(0, lastClose) + "\n" + uniqueNewTests.join("\n\n") + "\n\n" + existingFull.substring(lastClose);
            } else {
              content = existingFull + "\n\n" + uniqueNewTests.join("\n\n");
            }
          }
        }
        if (content) return { filePath, content };
        return { filePath, content: null };
      }

      // Fix wrong imports
      content = content.replace(/import\s*\{\s*test\s*,\s*expect\s*\}\s*from\s*['"]@playwright\/test['"]/g, "import { test, expect } from '../../fixtures/actionsFixture'");
      content = content.replace(/import\s*\{\s*test\s*\}\s*from\s*['"]@playwright\/test['"]/g, "import { test } from '../../fixtures/actionsFixture'");

      // Rewrite manual instantiation to use fixture
      if (filePath.endsWith(".spec.ts") && registeredActions.size > 0) {
        const manualInstMatch = content.match(/new\s+(\w+)Actions\(page\)/);
        if (manualInstMatch) {
          const className = manualInstMatch[1];
          const fixtureKey = className.charAt(0).toLowerCase() + className.slice(1);
          if (registeredActions.has(fixtureKey.toLowerCase())) {
            content = content.replace(new RegExp(`import\\s*\\{\\s*${className}Actions\\s*\\}\\s*from\\s*['"][^'"]+['"];?\\n?`, "g"), "");
            const varName = fixtureKey + "Actions";
            content = content.replace(new RegExp(`\\s*(let|const)\\s+${varName}\\s*[:=][^;]*;?\\n?`, "gi"), "\n");
            content = content.replace(new RegExp(`\\s*${varName}\\s*=\\s*new\\s+${className}Actions\\(page\\);?\\n?`, "gi"), "\n");
            content = content.replace(new RegExp(`${varName}\\.`, "g"), `actions.${fixtureKey}.`);
            content = content.replace(/async\s*\(\{\s*\}\)/g, "async ({ actions })");
            content = content.replace(/async\s*\(\{\s*page\s*\}\)/g, "async ({ actions, page })");
          }
        }
      }

      return { filePath, content };
    }).filter(t => {
      if (!t.content) return false;
      if (/Actions\.ts$/i.test(t.filePath) && existingPaths.has(t.filePath.toLowerCase())) return false;
      return true;
    });
  } catch (e) {
    context.log.error(`[PW-Generate] AI test generation failed: ${e.message}`);
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractMethodSignatures(content) {
  const methods = [];
  const pattern = /async\s+(\w+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    if (match[1] === "constructor") continue;
    methods.push(`async ${match[1]}(${match[2].trim()})`);
  }
  return methods;
}

function extractFixtureActions(content) {
  const actions = [];
  const pattern = /(\w+):\s*new\s+\w+Actions\(page\)/g;
  let match;
  while ((match = pattern.exec(content)) !== null) actions.push(`actions.${match[1]}`);
  return actions;
}

function extractTestBlocks(content) {
  const blocks = [];
  const testPattern = /^[ \t]*test\s*\(/gm;
  let match;
  while ((match = testPattern.exec(content)) !== null) {
    const arrowIdx = content.indexOf("=> {", match.index);
    if (arrowIdx === -1) continue;
    const bodyStart = content.indexOf("{", arrowIdx + 2);
    if (bodyStart === -1) continue;
    let depth = 1;
    let end = bodyStart + 1;
    for (let i = bodyStart + 1; i < content.length; i++) {
      if (content[i] === "{") depth++;
      if (content[i] === "}") depth--;
      if (depth === 0) { end = Math.min(i + 3, content.length); break; }
    }
    blocks.push(content.substring(match.index, end).trim());
  }
  return blocks;
}

function extractTestNames(content) {
  const names = [];
  const pattern = /test\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = pattern.exec(content)) !== null) names.push(match[1]);
  return names;
}

function sanitizeJsonStringValues(jsonStr) {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < jsonStr.length; i++) {
    const ch = jsonStr[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (inString) {
      if (ch === "\\") { escaped = true; result += ch; }
      else if (ch === '"') { inString = false; result += ch; }
      else if (ch === "\n") result += "\\n";
      else if (ch === "\r") result += "\\r";
      else if (ch === "\t") result += "\\t";
      else if (ch.charCodeAt(0) < 0x20) continue;
      else result += ch;
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
  }
  return result;
}

// ─── System Prompt (kept as-is from the CF worker) ──────────────────────────

function buildSystemPrompt(docsContext, existingContext) {
  return `You are a senior QA engineer generating Playwright E2E tests for the BindTuning AdminApp \u2014 an Angular-based web administration application.

${docsContext}
${existingContext}

You MUST follow the patterns, imports, constants, and conventions described in the documentation above.

\u2500\u2500\u2500 CRITICAL IMPORT RULES \u2500\u2500\u2500
- ALWAYS import \`test\` from the custom fixture: import { test, expect } from '../../fixtures/actionsFixture';
- NEVER import \`test\` from '@playwright/test'.
- Import route constants: import { ROUTES } from '../../constants';
- Import URL helpers: import { withBase } from '../../utils/envUrls';

\u2500\u2500\u2500 OUTPUT FORMAT \u2500\u2500\u2500
Respond with ONLY a raw JSON array, no markdown, no code fences.
[{"filePath": "tests/components/feature/feature.spec.ts", "content": "..."}]
If the spec already exists, set "appendOnly": true and return ONLY new test() blocks.
If no new tests are needed, return an empty array: []

\u2500\u2500\u2500 RULES \u2500\u2500\u2500
1. Generate one spec file per logical component/feature changed.
2. Check existing files FIRST before generating.
3. Each test file must be a valid, runnable Playwright test.
4. Focus on: navigation, user interactions, expected outcomes.
5. Use descriptive test names: "should [expected behavior] when [condition]".
6. Do NOT import \`test\` from '@playwright/test' \u2014 ALWAYS use actionsFixture.`;
}

module.exports = {
  generateTests,
  extractTestBlocks,
  extractTestNames,
  sanitizeJsonStringValues,
};
