/**
 * Benchmark Google AI Studio (Gemini) Models
 *
 * Tests Gemini/Gemma models against the devops-ai-bot's three AI features.
 * Uses the OpenAI-compatible endpoint.
 * Captures both metrics AND full response text.
 *
 * Run: GOOGLE_AI_KEY=... node tests/benchmark-google.js
 */

const fs = require("node:fs");
const path = require("node:path");

const GOOGLE_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const REQUEST_TIMEOUT_MS = 90000;
const DELAY_BETWEEN_MODELS_MS = 1500;

// Chat-capable models to test (skip audio, TTS, image-gen, robotics, research)
const MODELS = [
  "gemini-3.1-pro-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemma-3-27b-it",
  "gemma-3-12b-it",
  "gemma-3-4b-it",
  "gemma-3n-e4b-it",
  "gemma-3n-e2b-it",
  "gemma-3-1b-it",
];

// ─── Load API Key ──────────────────────────────────────────────────────────

function loadApiKey() {
  if (process.env.GOOGLE_AI_KEY) return process.env.GOOGLE_AI_KEY;
  console.error("❌ No API key found. Set GOOGLE_AI_KEY env var.");
  process.exit(1);
}

const API_KEY = loadApiKey();

// ─── Prompts (same as other benchmarks) ────────────────────────────────────

const TICKET_SYSTEM = `You are a senior software engineering assistant specialising in agile project management.

Your task is to evaluate a work item (ticket) and provide a structured quality analysis.

RULES:
- Be concise and actionable.
- Always return ONLY valid JSON – no extra text, no markdown fences.
- Use the exact keys shown below.

RESPONSE FORMAT (JSON):
{
  "qualityScore": <number 1-10>,
  "missingInformation": [<string>, ...],
  "isTooLarge": <boolean>,
  "shouldSplit": <boolean>,
  "suggestedImprovements": "<string with concrete suggestions>"
}

SCORING GUIDE:
- 1-3: Very poor – missing critical info, vague, or contradictory.
- 4-6: Needs improvement – some useful detail but gaps remain.
- 7-8: Good – clear intent, minor polish needed.
- 9-10: Excellent – well-defined acceptance criteria, context, and scope.`;

const TICKET_USER = `Analyse the following work item and return the JSON quality report.

WORK ITEM TYPE: User Story
TITLE: Implement SSO login with Azure AD for the admin dashboard
DESCRIPTION:
As an admin, I want to log in using my Azure AD credentials so that I don't need a separate password. The login should support MFA and redirect back to the dashboard after authentication.`;

const TIME_SYSTEM = `You are a senior software engineering assistant with deep experience in effort estimation.

Your task is to estimate the time and complexity required to complete a work item.

RULES:
- Be realistic. Base estimates on common industry benchmarks.
- Consider edge cases, testing, code review, and deployment time.
- Always return ONLY valid JSON – no extra text, no markdown fences.
- Use the exact keys shown below.

RESPONSE FORMAT (JSON):
{
  "complexity": "<low | medium | high>",
  "estimatedTimeInDays": { "min": <number>, "max": <number> },
  "riskLevel": "<low | medium | high>",
  "reasoning": "<string explaining the estimate>"
}`;

const TIME_USER = `Estimate the effort for the following work item and return the JSON report.

WORK ITEM TYPE: User Story
TITLE: Implement SSO login with Azure AD for the admin dashboard
DESCRIPTION:
As an admin, I want to log in using my Azure AD credentials so that I don't need a separate password. The login should support MFA and redirect back to the dashboard after authentication.`;

const REVIEW_SYSTEM = `You are a senior code reviewer. Review ONLY the changed lines in the PR diff below.

OUTPUT FORMAT — respond with ONLY a raw JSON array, no markdown, no code fences:
[{"file":"/path/to/file.cs","line":42,"comment":"Your feedback"}]

RULES:
1. ONLY comment on lines prefixed with "+" (these are the changed/added lines)
2. NEVER comment on context lines or removed lines
3. "file" must exactly match the file path from the diff header
4. "line" must be from the CHANGED LINES list below
5. Keep each comment concise (1-2 sentences)
6. Focus on: actual bugs, null reference risks, security vulnerabilities, clear logic errors
7. Do NOT comment on code style, naming, or formatting
8. If the changed code looks correct, return: [{"file":"/path","line":15,"comment":"LGTM"}]

VALID line numbers: /src/services/AuthService.ts: lines 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29`;

const REVIEW_USER = `PR: "Add Azure AD SSO authentication service"
Files changed: /src/services/AuthService.ts

### FILE: /src/services/AuthService.ts (edited)
\`\`\`
@@ -10,6 +10,21 @@ import { ConfidentialClientApplication } from '@azure/msal-node';

 export class AuthService {
   private msalClient: ConfidentialClientApplication;

+15: async authenticateUser(authCode: string): Promise<UserSession> {
+16:   const tokenResponse = await this.msalClient.acquireTokenByCode({
+17:     code: authCode,
+18:     scopes: ['user.read', 'openid', 'profile'],
+19:     redirectUri: process.env.REDIRECT_URI,
+20:   });
+21:
+22:   const user = await this.graphClient.getUser(tokenResponse.accessToken);
+23:
+24:   const session = {
+25:     userId: user.id,
+26:     displayName: user.displayName,
+27:     email: user.mail,
+28:     token: tokenResponse.accessToken,
+29:   };
+30:
+31:   return session;
+32: }
\`\`\``;

// ─── Validation helpers ────────────────────────────────────────────────────

function coerceNumber(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num) || num < min || num > max) return fallback;
  return num;
}

function coerceEnum(value, allowed, fallback) {
  if (typeof value !== "string") return fallback;
  const lower = value.toLowerCase().trim();
  return allowed.includes(lower) ? lower : fallback;
}

function coerceString(value, fallback) {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return fallback;
}

function coerceStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item) => typeof item === "string" && item.trim().length > 0
  );
}

// ─── API call ──────────────────────────────────────────────────────────────

async function callModel(modelId, systemPrompt, userMessage, useJsonMode) {
  const payload = {
    model: modelId,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  };
  if (useJsonMode) {
    payload.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(GOOGLE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const elapsed = Date.now() - start;
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return {
        success: false,
        elapsed,
        error: `HTTP ${res.status}: ${errText.slice(0, 300)}`,
        rawContent: null,
        usage: null,
      };
    }

    const data = await res.json();
    const rawContent = data?.choices?.[0]?.message?.content || null;
    const usage = data?.usage || null;
    return { success: true, elapsed, rawContent, usage, error: null };
  } catch (err) {
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    return {
      success: false,
      elapsed,
      error: err.name === "AbortError" ? "TIMEOUT" : err.message,
      rawContent: null,
      usage: null,
    };
  }
}

// ─── Scoring ───────────────────────────────────────────────────────────────

function parseJson(raw) {
  if (!raw) return null;
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function scoreTicket(parsed) {
  if (!parsed) return { score: 0, max: 5 };
  let s = 0;
  if (coerceNumber(parsed.qualityScore, 1, 10, null) !== null) s++;
  if (coerceStringArray(parsed.missingInformation).length > 0) s++;
  if (typeof parsed.isTooLarge === "boolean") s++;
  if (typeof parsed.shouldSplit === "boolean") s++;
  if (coerceString(parsed.suggestedImprovements, null) !== null) s++;
  return { score: s, max: 5 };
}

function scoreTime(parsed) {
  if (!parsed) return { score: 0, max: 5 };
  let s = 0;
  if (coerceEnum(parsed.complexity, ["low", "medium", "high"], null) !== null) s++;
  const etd = parsed.estimatedTimeInDays;
  if (etd && typeof etd === "object" && coerceNumber(etd.min, 0, 365, null) !== null && coerceNumber(etd.max, 0, 365, null) !== null) s++;
  if (coerceEnum(parsed.riskLevel, ["low", "medium", "high"], null) !== null) s++;
  if (coerceString(parsed.reasoning, null) !== null) s++;
  if (etd && typeof etd === "object" && Number(etd.min) <= Number(etd.max) && Number(etd.min) > 0) s++;
  return { score: s, max: 5 };
}

function scoreReview(raw) {
  if (!raw) return { score: 0, max: 5 };
  let s = 0;
  let comments = null;
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) comments = JSON.parse(m[0]);
  } catch { /* ignore */ }
  if (Array.isArray(comments)) s++;
  else return { score: s, max: 5 };
  const valid = comments.filter(
    (c) => c && typeof c.file === "string" && c.line !== null && c.line !== undefined && c.comment
  );
  if (valid.length > 0) s++;
  if (valid.some((c) => c.file === "/src/services/AuthService.ts")) s++;
  if (valid.some((c) => Number(c.line) >= 15 && Number(c.line) <= 32)) s++;
  const hasConcern = valid.some((c) => {
    const l = (c.comment || "").toLowerCase();
    return /null|error|try|catch|valid|undefined|check|secur|token|expir|handling|missing/.test(l);
  });
  if (hasConcern) s++;
  return { score: s, max: 5 };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 devops-ai-bot — Google AI Studio Benchmark\n");
  console.log(`   API: ${GOOGLE_API_URL}`);
  console.log(`   Models: ${MODELS.length}`);
  console.log(`   Timeout: ${REQUEST_TIMEOUT_MS / 1000}s | Delay: ${DELAY_BETWEEN_MODELS_MS}ms\n`);

  MODELS.forEach((m, i) => console.log(`  ${i + 1}. ${m}`));
  console.log();

  const results = [];
  const startTime = Date.now();

  for (let i = 0; i < MODELS.length; i++) {
    const modelId = MODELS[i];
    console.log(`[${i + 1}/${MODELS.length}] ${modelId}...`);

    const r = { modelId, ticket: {}, time: {}, review: {} };

    const t1 = await callModel(modelId, TICKET_SYSTEM, TICKET_USER, true);
    r.ticket = {
      elapsed: t1.elapsed, rawContent: t1.rawContent,
      jsonOk: t1.success && parseJson(t1.rawContent) !== null,
      quality: scoreTicket(parseJson(t1.rawContent)),
      usage: t1.usage, error: t1.error,
    };

    const t2 = await callModel(modelId, TIME_SYSTEM, TIME_USER, true);
    r.time = {
      elapsed: t2.elapsed, rawContent: t2.rawContent,
      jsonOk: t2.success && parseJson(t2.rawContent) !== null,
      quality: scoreTime(parseJson(t2.rawContent)),
      usage: t2.usage, error: t2.error,
    };

    const t3 = await callModel(modelId, REVIEW_SYSTEM, REVIEW_USER, false);
    r.review = {
      elapsed: t3.elapsed, rawContent: t3.rawContent,
      jsonOk: t3.success && /\[[\s\S]*\]/.test(t3.rawContent || ""),
      quality: scoreReview(t3.rawContent),
      usage: t3.usage, error: t3.error,
    };

    const jsonOk = (r.ticket.jsonOk ? 1 : 0) + (r.time.jsonOk ? 1 : 0) + (r.review.jsonOk ? 1 : 0);
    const quality = r.ticket.quality.score + r.time.quality.score + r.review.quality.score;
    const avgMs = Math.round((r.ticket.elapsed + r.time.elapsed + r.review.elapsed) / 3);
    console.log(`         → JSON: ${jsonOk}/3 | Quality: ${quality}/15 | Avg: ${avgMs}ms`);

    results.push(r);

    if (i < MODELS.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_MODELS_MS));
    }
  }

  const totalTime = Date.now() - startTime;

  // Sort
  results.sort((a, b) => {
    const aJ = (a.ticket.jsonOk ? 1 : 0) + (a.time.jsonOk ? 1 : 0) + (a.review.jsonOk ? 1 : 0);
    const bJ = (b.ticket.jsonOk ? 1 : 0) + (b.time.jsonOk ? 1 : 0) + (b.review.jsonOk ? 1 : 0);
    if (bJ !== aJ) return bJ - aJ;
    const aQ = a.ticket.quality.score + a.time.quality.score + a.review.quality.score;
    const bQ = b.ticket.quality.score + b.time.quality.score + b.review.quality.score;
    if (bQ !== aQ) return bQ - aQ;
    return ((a.ticket.elapsed + a.time.elapsed + a.review.elapsed) / 3) -
           ((b.ticket.elapsed + b.time.elapsed + b.review.elapsed) / 3);
  });

  // Print table
  console.log("\n" + "═".repeat(125));
  console.log("  GOOGLE AI STUDIO BENCHMARK RESULTS");
  console.log("═".repeat(125));
  console.log("| Rank | Model                                    | Ticket (ms) | Time (ms) | Review (ms) | Avg (ms) | JSON | Quality |");
  console.log("|------|------------------------------------------|-------------|-----------|-------------|----------|------|---------|");

  results.forEach((r, i) => {
    const jOk = (r.ticket.jsonOk ? 1 : 0) + (r.time.jsonOk ? 1 : 0) + (r.review.jsonOk ? 1 : 0);
    const q = r.ticket.quality.score + r.time.quality.score + r.review.quality.score;
    const avg = Math.round((r.ticket.elapsed + r.time.elapsed + r.review.elapsed) / 3);
    const model = r.modelId.length > 40 ? r.modelId.slice(0, 39) + "…" : r.modelId.padEnd(40);
    console.log(
      `| ${String(i + 1).padStart(4)} | ${model} | ${String(r.ticket.elapsed).padStart(11)} | ${String(r.time.elapsed).padStart(9)} | ${String(r.review.elapsed).padStart(11)} | ${String(avg).padStart(8)} | ${(jOk + "/3").padStart(4)} | ${(q + "/15").padStart(5)}  |`
    );
  });
  console.log("═".repeat(125));

  // Print actual responses
  console.log("\n\n📝 ACTUAL AI RESPONSES:\n");
  results.forEach((r, i) => {
    console.log(`${"━".repeat(80)}`);
    console.log(`#${i + 1}  ${r.modelId}`);
    console.log(`${"━".repeat(80)}`);

    console.log("\n📋 TICKET ANALYSIS:");
    console.log(r.ticket.error ? `   ERROR: ${r.ticket.error}` : (r.ticket.rawContent || "(empty)"));

    console.log("\n⏱️  TIME ESTIMATION:");
    console.log(r.time.error ? `   ERROR: ${r.time.error}` : (r.time.rawContent || "(empty)"));

    console.log("\n🔍 PR CODE REVIEW:");
    console.log(r.review.error ? `   ERROR: ${r.review.error}` : (r.review.rawContent || "(empty)"));
    console.log();
  });

  console.log(`\n⏱️  Total: ${(totalTime / 1000).toFixed(1)}s for ${results.length} models\n`);

  const reportPath = path.join(__dirname, "benchmark-google-results.json");
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), totalTimeMs: totalTime, results }, null, 2));
  console.log(`💾 Saved to: ${reportPath}\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
