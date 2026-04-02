/**
 * Captures the actual AI-generated text from the top-scoring free models.
 * Saves raw responses to tests/benchmark-responses.json
 *
 * Run: AI_API_KEY=... node tests/capture-responses.js
 */

const fs = require("node:fs");
const path = require("node:path");

// Load API key
function loadApiKey() {
  if (process.env.AI_API_KEY) return process.env.AI_API_KEY;
  const settingsPath = path.join(__dirname, "..", "local.settings.json");
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const key = settings?.Values?.AI_API_KEY;
    if (key && key !== "YOUR_AI_API_KEY") return key;
  } catch {
    // ignore
  }
  console.error("No API key found.");
  process.exit(1);
}

const API_KEY = loadApiKey();
const API_URL = "https://openrouter.ai/api/v1/chat/completions";

// The 7 models that scored 15/15
const MODELS = [
  "liquid/lfm-2.5-1.2b-instruct:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "arcee-ai/trinity-large-preview:free",
  "qwen/qwen3.6-plus-preview:free",
  "openrouter/free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-nano-12b-v2-vl:free",
];

// --- Prompts ---

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
}`;

const TICKET_USER = `Analyse the following work item and return the JSON quality report.

WORK ITEM TYPE: User Story
TITLE: Implement SSO login with Azure AD for the admin dashboard
DESCRIPTION:
As an admin, I want to log in using my Azure AD credentials so that I don't need a separate password. The login should support MFA and redirect back to the dashboard after authentication.`;

const TIME_SYSTEM = `You are a senior software engineering assistant with deep experience in effort estimation.

Your task is to estimate the time and complexity required to complete a work item.

RULES:
- Be realistic. Base estimates on common industry benchmarks.
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
1. ONLY comment on lines prefixed with "+"
2. "file" must exactly match the file path from the diff header
3. "line" must be from the CHANGED LINES list below
4. Keep each comment concise (1-2 sentences)
5. Focus on: actual bugs, null reference risks, security vulnerabilities
6. If the changed code looks correct, return: [{"file":"/path","line":15,"comment":"LGTM"}]

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

// --- API call ---

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

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
        "HTTP-Referer": "https://github.com/devops-ai-bot/benchmark",
        "X-Title": "devops-ai-bot response capture",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return `(HTTP ${res.status}: ${errText.slice(0, 200)})`;
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "(empty response)";
  } catch (err) {
    return `(ERROR: ${err.name === "AbortError" ? "TIMEOUT after 90s" : err.message})`;
  }
}

// --- Main ---

async function main() {
  const results = {};

  for (let i = 0; i < MODELS.length; i++) {
    const model = MODELS[i];
    console.log(`[${i + 1}/${MODELS.length}] ${model}...`);

    results[model] = {
      ticketAnalysis: await callModel(model, TICKET_SYSTEM, TICKET_USER, true),
      timeEstimation: await callModel(model, TIME_SYSTEM, TIME_USER, true),
      prReview: await callModel(model, REVIEW_SYSTEM, REVIEW_USER, false),
    };

    // Polite delay
    if (i < MODELS.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  const outPath = path.join(__dirname, "benchmark-responses.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved to ${outPath}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
