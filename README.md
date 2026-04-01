# DevOps AI Bot

An AI-powered Azure Functions app that integrates with Azure DevOps to automatically **analyse tickets**, **estimate effort**, **review pull requests**, **generate Playwright tests**, and **track flaky tests**.

---

## Architecture

```
Azure DevOps  ─>  Service Hooks (webhooks)  ─>  Azure Functions (HTTP triggers)  ─>  AI API (OpenRouter)
                                                       │
                                             Posts comments back to Azure DevOps
                                             (work items, PR threads, labels, git pushes)
```

### Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/devops-webhook` | POST | function key | Work item webhooks (ticket analysis + time estimation) |
| `/api/pr-review-gateway` | POST | function key | PR webhooks (AI code review + Playwright test gen) |
| `/api/flaky-detective/{action?}` | GET/POST | function key | Flaky test tracking + HTML dashboard |
| `/api/pw-test` | GET | function key | Manual Playwright test generation trigger |
| `/api/health` | GET | anonymous | Health check |

### Features

| Feature | Trigger | What It Does |
|---------|---------|-------------|
| **Ticket Analyzer** | `workitem.created` | AI grades ticket quality (1-10), identifies missing info, suggests improvements |
| **Time Estimator** | `workitem.updated` (Title/Description change) | AI estimates complexity, time range, risk level |
| **PR Code Review** | `git.pullrequest.created/updated` | AI reviews code diffs, detects secrets, scores risk, auto-labels PR |
| **Playwright Test Gen** | PR created on AdminApp targeting Dev | AI generates E2E tests, pushes to test branch, triggers pipeline |
| **Flaky Detective** | Build completed (pipeline) | Tracks flaky tests over 14-day window, HTML/JSON dashboard |

### Security & Resilience

- **HMAC-SHA256 webhook verification** via optional `WEBHOOK_SECRET`
- **Rate limiting** — sliding-window per endpoint
- **Deduplication** — TTL cache prevents duplicate webhook processing
- **Payload validation** — rejects malformed payloads with clear 400 errors
- **Graceful degradation** — AI outage posts "temporarily unavailable" comment
- **Prompt injection mitigation** — user data delimited and truncated
- **AI response validation** — coerces output to expected types with safe defaults
- **Secret detection** — scans PR diffs for accidentally committed credentials

---

## Project Structure

```
devops-ai-bot/
├── functions/
│   ├── ticketAnalyzer.js          # AI ticket quality analysis
│   ├── timeEstimator.js           # AI effort estimation
│   ├── prGateway.js               # PR webhook orchestration + file classification
│   ├── prReviewer.js              # AI code review + risk scoring
│   ├── playwrightContext.js       # Gathers Angular context for test generation
│   ├── playwrightGenerate.js      # AI Playwright test generation
│   ├── playwrightPush.js          # Pushes tests to git + triggers pipeline
│   └── flakyDetective.js          # Flaky test tracking + HTML dashboard
├── services/
│   ├── aiService.js               # AI API client (JSON + raw modes)
│   └── azureDevopsService.js      # Azure DevOps work item API helpers
├── lib/
│   ├── azurePr.js                 # Azure DevOps PR/Git API helpers
│   ├── prComments.js              # PR thread comment posting
│   ├── diffs.js                   # Myers diff algorithm + diff formatting
│   ├── secrets.js                 # Secret/credential detection in diffs
│   ├── prompts.js                 # AI prompt construction for PR review
│   ├── constants.js               # Shared constants (API versions, batch size)
│   └── kvStore.js                 # In-memory KV store with TTL (replaces CF KV)
├── prompts/
│   ├── analyzeTicketPrompt.js     # System + user prompts for ticket analysis
│   └── estimateTimePrompt.js      # System + user prompts for time estimation
├── utils/
│   ├── capitalize.js              # String capitalize
│   ├── dedupCache.js              # Dedup cache with TTL + periodic pruning
│   ├── fetchWithRetry.js          # HTTP fetch with timeout + exponential backoff
│   ├── handlerFactory.js          # Shared handler pattern (extract → AI → post)
│   ├── htmlEscape.js              # HTML escaping for XSS prevention
│   ├── rateLimiter.js             # Sliding-window rate limiter
│   ├── sanitizeInput.js           # Prompt injection mitigation
│   ├── structuredLog.js           # Structured JSON logging
│   ├── validateAIResponse.js      # AI response coercion (number, enum, string, array)
│   ├── validateEnv.js             # Startup env var validation
│   ├── validatePayload.js         # Webhook payload structure validation
│   └── verifySignature.js         # HMAC-SHA256 signature verification
├── tests/                         # Unit, integration, and simulation tests
├── devops-webhook/function.json   # POST /api/devops-webhook
├── pr-review-gateway/             # POST /api/pr-review-gateway
├── flaky-detective/               # GET/POST /api/flaky-detective/{action?}
├── pw-test/                       # GET /api/pw-test
├── health/function.json           # GET /api/health
├── index.js                       # Main entry point & event router
├── healthCheck.js                 # Health-check endpoint
├── host.json                      # Azure Functions host config
├── local.settings.json.example    # Template for local env vars
├── WEBHOOK-SETUP-GUIDE.md         # Step-by-step webhook configuration guide
└── README.md
```

---

## Prerequisites

- **Node.js** >= 18
- **Azure Functions Core Tools** v4 (`npm i -g azure-functions-core-tools@4`)
- An **Azure DevOps** organisation with a PAT that has:
  - Work Items: Read & Write
  - Code: Read & Write
  - Build: Read
- An **AI API key** — defaults to [OpenRouter](https://openrouter.ai) free models, but any OpenAI-compatible API works

---

## Setup

### 1. Clone & install

```bash
cd devops-ai-bot
npm install
```

### 2. Configure environment variables

Copy the example file and fill in your values:

```bash
cp local.settings.json.example local.settings.json
```

Never commit `local.settings.json` (it's in `.gitignore`).

#### Required variables

| Variable | Description |
|----------|-------------|
| `AZURE_DEVOPS_ORG` | Organisation URL, e.g. `https://dev.azure.com/myorg` |
| `AZURE_DEVOPS_PAT` | Personal Access Token |
| `AI_API_URL` | AI chat completions endpoint |
| `AI_API_KEY` | API key for the AI service |

#### Optional variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_MODEL` | `mistralai/mistral-7b-instruct:free` | Model for ticket/time analysis (JSON mode) |
| `AI_MODEL_REVIEW` | (same as AI_MODEL) | Model for PR code review |
| `AI_MODEL_CHEAP` | (same as AI_MODEL) | Model for PR summaries |
| `AZURE_PROJECT` | `BindTuning` | Default Azure DevOps project name |
| `PLAYWRIGHT_REPO_NAME` | `BindTuning.AdminApp` | Repo to enable Playwright test gen |
| `PLAYWRIGHT_TARGET_BRANCH` | `refs/heads/Dev` | Target branch that triggers test gen |
| `PLAYWRIGHT_TEST_BRANCH` | `internship/playwright-unit-tests` | Branch to push generated tests to |
| `PIPELINE_ID` | `88` | Pipeline to trigger after pushing tests |
| `WEBHOOK_SECRET` | _(empty)_ | HMAC secret for signature verification |
| `AI_TIMEOUT_MS` | `30000` | AI API call timeout (ms) |
| `AI_MAX_RETRIES` | `3` | AI API retry attempts |
| `DEDUP_TTL_MS` | `300000` | Dedup cache TTL (5 min) |
| `RATE_LIMIT_MAX` | `60` | Max requests per rate-limit window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window (1 min) |

### 3. Run locally

```bash
func start
```

Endpoints:
- `http://localhost:7071/api/health`
- `http://localhost:7071/api/devops-webhook`
- `http://localhost:7071/api/pr-review-gateway`
- `http://localhost:7071/api/flaky-detective`
- `http://localhost:7071/api/pw-test`

### 4. Configure webhooks

See **[WEBHOOK-SETUP-GUIDE.md](./WEBHOOK-SETUP-GUIDE.md)** for complete step-by-step instructions.

---

## Running Tests

```bash
# Run all tests (158 tests across 23 suites)
npm test

# Run webhook simulations (31 integration scenarios)
node tests/simulate-webhooks.js

# Lint + test combined
npm run check
```

---

## Linting & Formatting

```bash
npm run lint          # Check for lint errors
npm run lint:fix      # Auto-fix lint errors
npm run format:check  # Check formatting
npm run format        # Auto-format all files
```

---

## Deploying to Azure

```bash
# Deploy
func azure functionapp publish <your-function-app-name>

# Set environment variables
az functionapp config appsettings set \
  --name <your-function-app-name> \
  --resource-group <your-resource-group> \
  --settings \
    AZURE_DEVOPS_ORG="https://dev.azure.com/<your-org>" \
    AZURE_DEVOPS_PAT="<your-pat>" \
    AI_API_URL="https://openrouter.ai/api/v1/chat/completions" \
    AI_API_KEY="<your-key>"
```

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|-------------|-----|
| `Missing required environment variables` | `local.settings.json` missing or incomplete | Set all four required vars |
| AI returns raw text instead of JSON | Model ignores JSON instruction | Parser handles gracefully; try a more capable model |
| `401` from Azure DevOps | PAT expired or insufficient permissions | Regenerate PAT with Work Items R/W, Code R/W |
| `429 Too Many Requests` from bot | Rate limiter triggered | Increase `RATE_LIMIT_MAX` |
| `429` from AI API | Provider rate limit | Built-in retry handles this; consider upgrading plan |
| Function times out | AI provider slow | Increase `AI_TIMEOUT_MS` or use faster model |
| "AI Temporarily Unavailable" comment | AI API unreachable | Bot degrades gracefully; check AI provider status |
| PR review missing some files | AI response truncated | Check logs for truncation warning; reduce batch size |
| Flaky detective shows empty | No builds ingested yet | Run a pipeline and check the `/report` endpoint |

---

## License

MIT
