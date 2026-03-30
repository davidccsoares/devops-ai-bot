# DevOps AI Bot

An AI-powered Azure Function that integrates with Azure DevOps webhooks to automatically **analyse tickets** and **estimate effort**.

---

## Architecture

```
Azure DevOps  ->  Service Hooks (webhook)  ->  Azure Function (HTTP trigger)  ->  AI API
                                                     |
                                           Posts comment back to Azure DevOps
```

A single HTTP endpoint receives all webhook events and routes them to the correct handler based on the `eventType` field.

| Event type | Handler | Action |
|---|---|---|
| `workitem.created` | Ticket Analyzer | Analyses quality, scores 1-10, suggests improvements |
| `workitem.updated` | Time Estimator | Estimates complexity, duration, and risk |

---

## Project Structure

```
devops-ai-bot/
├── functions/
│   ├── ticketAnalyzer.js          # Feature 1 - AI ticket analysis
│   └── timeEstimator.js           # Feature 2 - AI time estimation
├── services/
│   ├── aiService.js               # Calls the AI API, parses JSON responses
│   └── azureDevopsService.js      # Azure DevOps REST API helpers
├── prompts/
│   ├── analyzeTicketPrompt.js     # Prompt for ticket analysis
│   └── estimateTimePrompt.js      # Prompt for time estimation
├── utils/
│   ├── fetchWithRetry.js          # HTTP fetch with timeout + exponential backoff retry
│   ├── handlerFactory.js          # Shared handler pattern (extract → AI → post)
│   ├── htmlEscape.js              # HTML escaping for safe comment rendering
│   ├── capitalize.js              # Shared string capitalize utility
│   ├── sanitizeInput.js           # Prompt injection mitigation (input delimiting + truncation)
│   ├── validateAIResponse.js      # AI response schema validation (coerce with safe defaults)
│   └── validateEnv.js             # Startup env var validation
├── tests/                         # Unit tests (Node.js built-in test runner) — 114 tests
├── devops-webhook/
│   └── function.json              # Azure Function binding (POST /api/devops-webhook)
├── health/
│   └── function.json              # Azure Function binding (GET /api/health)
├── index.js                       # Main entry point & event router
├── healthCheck.js                 # Health-check endpoint handler
├── host.json                      # Azure Functions host configuration
├── local.settings.json.example    # Template for local environment variables
├── eslint.config.mjs              # ESLint flat configuration
├── .prettierrc                    # Prettier configuration
├── package.json
└── README.md
```

---

## Prerequisites

- **Node.js** >= 18
- **Azure Functions Core Tools** v4 (`npm i -g azure-functions-core-tools@4`)
- An **Azure DevOps** organisation with a Personal Access Token (PAT) that has:
  - Work Items: Read & Write
- An **AI API key** - the project defaults to [OpenRouter](https://openrouter.ai) with a free model, but any OpenAI-compatible API works.

---

## Setup

### 1. Clone & install

```bash
cd devops-ai-bot
npm install
```

### 2. Configure environment variables

Edit `local.settings.json` (never commit this file):

| Variable | Description |
|---|---|
| `AZURE_DEVOPS_ORG` | Your organisation URL, e.g. `https://dev.azure.com/myorg` |
| `AZURE_DEVOPS_PAT` | Personal Access Token |
| `AI_API_URL` | AI chat completions endpoint, e.g. `https://openrouter.ai/api/v1/chat/completions` |
| `AI_API_KEY` | Your API key for the AI service |
| `AI_MODEL` | Model identifier, e.g. `mistralai/mistral-7b-instruct:free` |

Optional tuning variables:

| Variable | Default | Description |
|---|---|---|
| `AI_TIMEOUT_MS` | `30000` | Timeout for AI API calls (ms) |
| `DEVOPS_TIMEOUT_MS` | `30000` | Timeout for Azure DevOps API calls (ms) |

### 3. Run locally

```bash
func start
```

The function will start at `http://localhost:7071/api/devops-webhook`.

### 4. Configure Azure DevOps Service Hooks

> **Note:** Azure DevOps webhook integration is planned but not yet configured. The Function endpoint is ready to receive webhook payloads — see the section below for manual testing with `curl`.

In your Azure DevOps project:

1. Go to **Project Settings > Service Hooks**.
2. Click **+ Create subscription**.
3. Choose **Web Hooks** as the service.
4. Create two subscriptions:

| Trigger | Filter | URL |
|---|---|---|
| Work item created | (any or specific type) | `https://<your-function-app>.azurewebsites.net/api/devops-webhook?code=<function-key>` |
| Work item updated | (any or specific type) | Same URL |

---

## Running Tests

The project uses Node's built-in test runner (no external test framework needed):

```bash
npm test
```

This runs all `*.test.js` files under `tests/`. Current coverage includes **114 tests across 17 suites**:

- **Router tests** — validates event routing, field-change filtering, 400/500 responses, correlation ID header, and error handling.
- **Health check tests** — validates 200/503 responses based on environment configuration.
- **AI service tests** — validates `callAI` (env validation, HTTP errors, payload structure, default model) and `parseAIResponse` (JSON, code fences, raw fallback).
- **Format comment tests** — validates HTML output for both handlers (ticket, time) including XSS prevention and edge cases.
- **Extractor tests** — validates webhook payload parsing for work items.
- **fetchWithRetry tests** — validates timeout, retry, backoff, jitter, and Retry-After behaviour.
- **Handler factory tests** — validates lifecycle ordering, result building, error propagation, and raw response fallback.
- **Utility tests** — validates `escapeHtml`, `capitalize`, `validateEnv`, `sanitizeInput`, `coerceNumber`, `coerceEnum`, `coerceString`, and `coerceStringArray`.

---

## Linting & Formatting

```bash
# Check for lint errors
npm run lint

# Auto-fix lint errors
npm run lint:fix

# Check formatting
npm run format:check

# Auto-format all files
npm run format
```

---

## Testing Locally with curl

You can simulate webhook payloads with `curl`:

### Test: work item created

```bash
curl -X POST http://localhost:7071/api/devops-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "workitem.created",
    "resource": {
      "id": 42,
      "fields": {
        "System.Title": "Add user authentication",
        "System.Description": "Implement OAuth2 login with Google and GitHub providers.",
        "System.WorkItemType": "User Story",
        "System.TeamProject": "MyProject"
      }
    }
  }'
```

### Test: work item updated

```bash
curl -X POST http://localhost:7071/api/devops-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "workitem.updated",
    "resource": {
      "id": 42,
      "fields": {
        "System.Title": "Add user authentication",
        "System.Description": "Implement OAuth2 login with Google and GitHub providers. Must support MFA.",
        "System.WorkItemType": "User Story",
        "System.TeamProject": "MyProject"
      }
    }
  }'
```

---

## Deploying to Azure

```bash
# Create the Function App (one-time) — replace placeholders with your values
az functionapp create \
  --resource-group <your-resource-group> \
  --consumption-plan-location <your-region> \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --name <your-function-app-name> \
  --storage-account <your-storage-account>

# Set environment variables
az functionapp config appsettings set \
  --name <your-function-app-name> \
  --resource-group <your-resource-group> \
  --settings \
    AZURE_DEVOPS_ORG="https://dev.azure.com/<your-org>" \
    AZURE_DEVOPS_PAT="<your-pat>" \
    AI_API_URL="https://openrouter.ai/api/v1/chat/completions" \
    AI_API_KEY="<your-key>" \
    AI_MODEL="mistralai/mistral-7b-instruct:free"

# Deploy
func azure functionapp publish <your-function-app-name>
```

---

## Extending the Bot

To add a new handler:

1. Create a new prompt file in `prompts/`.
2. Create a new handler in `functions/` using `createHandler()` from `utils/handlerFactory.js`.
3. Add a new entry in the `handlers` registry in `index.js`.

---

## Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| `Missing required environment variables` on startup | `local.settings.json` is missing or incomplete | Ensure all four required vars are set (see Setup step 2) |
| AI returns raw text instead of JSON | Model doesn't follow JSON-only instruction | The parser handles this gracefully, but try a more capable model or add stricter prompting |
| `401 Unauthorized` from Azure DevOps | PAT is expired or has insufficient permissions | Generate a new PAT with Work Items R/W |
| Function times out (no response) | AI provider is slow or unresponsive | Increase `AI_TIMEOUT_MS` or switch to a faster model/provider |
| `429 Too Many Requests` from AI API | Rate limit hit | Built-in retry with backoff handles this automatically (3 attempts). Consider upgrading your API plan |
| Comment not posted to work item | Missing `System.TeamProject` in webhook payload | Ensure the webhook subscription includes project context |

---

## License

MIT
