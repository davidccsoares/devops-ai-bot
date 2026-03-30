# Webhook Setup Plan — Azure DevOps Service Hooks

This document contains everything you need to create both webhooks in Azure DevOps tomorrow.

---

## Prerequisites

Before creating the webhooks, make sure:

1. **The Function App is deployed** and running in Azure
2. **You have the Function Key** — find it in the Azure Portal:
   - Go to your Function App → Functions → `devops-webhook` → Function Keys
   - Copy the `default` key (or create a new one)
3. **The PAT is configured** — the Function App needs a PAT with **Work Items: Read & Write** permissions set in Application Settings (`AZURE_DEVOPS_PAT`)

---

## Your Webhook URL

```
https://<YOUR-FUNCTION-APP-NAME>.azurewebsites.net/api/devops-webhook?code=<YOUR-FUNCTION-KEY>
```

Replace:
- `<YOUR-FUNCTION-APP-NAME>` — your Azure Function App name
- `<YOUR-FUNCTION-KEY>` — the function-level key from the portal

> **Tip:** Test the URL first by sending a curl POST with a dummy payload to make sure you get a response (should return 400 "Missing eventType" — that confirms the function is reachable).

```bash
curl -X POST "https://<YOUR-FUNCTION-APP-NAME>.azurewebsites.net/api/devops-webhook?code=<YOUR-FUNCTION-KEY>" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

Expected response: `{"error":"Invalid webhook payload. Missing eventType."}`

---

## Webhook 1: Work Item Created (Ticket Analyzer)

This webhook fires when a new work item is created. The bot will analyse its quality and post a comment with a score, missing information, and improvement suggestions.

### Step-by-step

1. Go to your Azure DevOps **Project**
2. Navigate to **Project Settings** (gear icon, bottom-left)
3. Under **General**, click **Service hooks**
4. Click **+ Create subscription**
5. Select **Web Hooks** → click **Next**
6. Configure the trigger:

| Setting | Value |
|---|---|
| **Trigger on this type of event** | `Work item created` |
| **Area path** | _(leave as "Any" or filter to a specific area)_ |
| **Work item type** | _(leave as "Any" or filter — e.g., "User Story", "Bug", "Task")_ |

7. Click **Next**
8. Configure the action:

| Setting | Value |
|---|---|
| **URL** | `https://<YOUR-FUNCTION-APP-NAME>.azurewebsites.net/api/devops-webhook?code=<YOUR-FUNCTION-KEY>` |
| **HTTP headers** | _(leave empty unless using WEBHOOK_SECRET — see below)_ |
| **Resource details to send** | `All` |
| **Messages to send** | `All` |
| **Detailed messages to send** | `All` |

9. Click **Test** to send a test notification — you should see a 200 response
10. Click **Finish**

---

## Webhook 2: Work Item Updated (Time Estimator)

This webhook fires when a work item is updated. The bot will estimate effort/complexity and post a comment — but **only** if the Title or Description was changed (other field changes like State or AssignedTo are automatically skipped).

### Step-by-step

1. Stay in **Project Settings → Service hooks**
2. Click **+ Create subscription**
3. Select **Web Hooks** → click **Next**
4. Configure the trigger:

| Setting | Value |
|---|---|
| **Trigger on this type of event** | `Work item updated` |
| **Area path** | _(leave as "Any" or match Webhook 1)_ |
| **Work item type** | _(leave as "Any" or match Webhook 1)_ |

5. Click **Next**
6. Configure the action:

| Setting | Value |
|---|---|
| **URL** | Same URL as Webhook 1: `https://<YOUR-FUNCTION-APP-NAME>.azurewebsites.net/api/devops-webhook?code=<YOUR-FUNCTION-KEY>` |
| **HTTP headers** | _(leave empty unless using WEBHOOK_SECRET — see below)_ |
| **Resource details to send** | `All` |
| **Messages to send** | `All` |
| **Detailed messages to send** | `All` |

7. Click **Test** to send a test notification
8. Click **Finish**

---

## Optional: HMAC Signature Verification

If you want extra security, you can configure HMAC signing so the bot verifies that requests actually come from Azure DevOps.

### How to set it up

1. **Generate a secret** — any random string, e.g.:
   ```bash
   openssl rand -hex 32
   ```
   Example output: `a1b2c3d4e5f6...` (64 hex characters)

2. **Set the secret in your Function App settings:**
   - Azure Portal → Function App → Configuration → Application settings
   - Add: `WEBHOOK_SECRET` = `<your-generated-secret>`

3. **Add the secret to both webhook subscriptions:**
   - When creating (or editing) each Service Hook, in the **Action** step:
   - Set **HTTP headers** to:
     ```
     X-Hub-Signature: sha256=<will-be-computed-by-azure-devops>
     ```
   - Actually, Azure DevOps Service Hooks don't natively support HMAC signing.
     This feature is more useful if you put an API Gateway or Azure API Management in front,
     or if you later switch to GitHub-style webhooks.
   - **For now, you can skip this** — the `function` auth level on the URL (the `?code=` key) already
     provides authentication. The HMAC verification is an additional layer if you need it later.

---

## What Happens After Setup

| Event | What the bot does | Comment posted? |
|---|---|---|
| New work item created | Analyses quality (score 1-10), identifies missing info, suggests improvements | Yes — HTML table with analysis |
| Work item Title or Description updated | Estimates complexity, time range, risk level | Yes — HTML table with estimation |
| Work item updated (other fields only) | Acknowledges but skips processing | No |
| Duplicate event (same item within 5 min) | Skipped by dedup cache | No |
| AI API unreachable | Posts "temporarily unavailable" comment | Yes — degraded notice |

---

## Verifying It Works

After creating both webhooks:

1. **Create a new work item** (e.g., a User Story with a title and description)
2. Wait 10-30 seconds for the AI to process
3. Check the work item's **Discussion** tab — you should see an AI comment with:
   - Quality Score (1-10)
   - Missing Information list
   - Suggested Improvements

4. **Edit the work item** — change the Title or Description
5. Wait 10-30 seconds
6. Check Discussion again — you should see a Time Estimation comment with:
   - Complexity (low/medium/high)
   - Estimated Time (range in days)
   - Risk Level
   - Reasoning

---

## Troubleshooting

| Problem | Check |
|---|---|
| No comment appears | Check Function App logs in Azure Portal → Monitor → Log stream |
| 401 error in logs | PAT expired or insufficient permissions — regenerate with Work Items R/W |
| 500 error in logs | Check if AI_API_URL and AI_API_KEY are set in Application Settings |
| "Temporarily Unavailable" comment | AI API was down — check your OpenRouter/AI provider status |
| Comment appears on create but not on update | Make sure you changed Title or Description (not just State/AssignedTo) |
| Test notification works but real events don't | Check the webhook filter (Area path / Work item type) matches your items |

---

## Quick Reference

| Item | Value |
|---|---|
| **Webhook URL** | `https://<app>.azurewebsites.net/api/devops-webhook?code=<key>` |
| **HTTP Method** | `POST` |
| **Content-Type** | `application/json` |
| **Webhook 1 event** | `Work item created` |
| **Webhook 2 event** | `Work item updated` |
| **Both use same URL** | Yes |
| **Auth** | Function key in query string (`?code=`) |
| **Health check** | `GET https://<app>.azurewebsites.net/api/health` (no auth needed) |
