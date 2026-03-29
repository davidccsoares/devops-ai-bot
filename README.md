# DevOps AI Bot

An AI-powered Azure Function that integrates with Azure DevOps webhooks to automatically **analyse tickets**, **estimate effort**, and **generate release notes**.

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
| `git.pullrequest.merged` | Release Notes Generator | Produces technical + customer-friendly release notes |

---

## Project Structure

```
devops-ai-bot/
├── functions/
│   ├── ticketAnalyzer.js          # Feature 1 - AI ticket analysis
│   ├── timeEstimator.js           # Feature 2 - AI time estimation
│   └── releaseNotesGenerator.js   # Feature 3 - AI release notes
├── services/
│   ├── aiService.js               # Calls the AI API, parses JSON responses
│   └── azureDevopsService.js      # Azure DevOps REST API helpers
├── prompts/
│   ├── analyzeTicketPrompt.js     # Prompt for ticket analysis
│   ├── estimateTimePrompt.js      # Prompt for time estimation
│   └── releaseNotesPrompt.js      # Prompt for release notes
├── devops-webhook/
│   └── function.json              # Azure Function binding configuration
├── index.js                       # Main entry point & event router
├── host.json                      # Azure Functions host configuration
├── local.settings.json            # Local environment variables (do not commit)
├── package.json
└── README.md
```

---

## Prerequisites

- **Node.js** >= 18
- **Azure Functions Core Tools** v4 (`npm i -g azure-functions-core-tools@4`)
- An **Azure DevOps** organisation with a Personal Access Token (PAT) that has:
  - Work Items: Read & Write
  - Code: Read & Write (for PR comments)
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

### 3. Run locally

```bash
func start
```

The function will start at `http://localhost:7071/api/devops-webhook`.

### 4. Configure Azure DevOps Service Hooks

In your Azure DevOps project:

1. Go to **Project Settings > Service Hooks**.
2. Click **+ Create subscription**.
3. Choose **Web Hooks** as the service.
4. Create three subscriptions:

| Trigger | Filter | URL |
|---|---|---|
| Work item created | (any or specific type) | `https://<your-function-app>.azurewebsites.net/api/devops-webhook?code=<function-key>` |
| Work item updated | (any or specific type) | Same URL |
| Pull request merged | (any or specific repo) | Same URL |

---

## Testing Locally

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

### Test: pull request merged

```bash
curl -X POST http://localhost:7071/api/devops-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "git.pullrequest.merged",
    "resource": {
      "pullRequestId": 101,
      "title": "feat: add OAuth2 login",
      "description": "Adds Google and GitHub OAuth2 providers with MFA support.",
      "sourceRefName": "refs/heads/feature/oauth",
      "targetRefName": "refs/heads/main",
      "repository": {
        "id": "repo-guid-123",
        "name": "my-app",
        "project": { "name": "MyProject" }
      },
      "workItemRefs": [
        { "id": "42", "url": "https://dev.azure.com/myorg/MyProject/_workitems/edit/42" }
      ]
    }
  }'
```

---

## Deploying to Azure

```bash
# Create the Function App (one-time)
az functionapp create \
  --resource-group myResourceGroup \
  --consumption-plan-location westeurope \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --name devops-ai-bot \
  --storage-account mystorageaccount

# Set environment variables
az functionapp config appsettings set \
  --name devops-ai-bot \
  --resource-group myResourceGroup \
  --settings \
    AZURE_DEVOPS_ORG="https://dev.azure.com/myorg" \
    AZURE_DEVOPS_PAT="<your-pat>" \
    AI_API_URL="https://openrouter.ai/api/v1/chat/completions" \
    AI_API_KEY="<your-key>" \
    AI_MODEL="mistralai/mistral-7b-instruct:free"

# Deploy
func azure functionapp publish devops-ai-bot
```

---

## Extending the Bot

To add a new handler:

1. Create a new prompt file in `prompts/`.
2. Create a new handler in `functions/`.
3. Add a new `case` in the `switch` block in `index.js`.

---

## License

MIT
