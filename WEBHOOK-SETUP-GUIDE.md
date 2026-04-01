# Webhook Setup Guide — devops-ai-bot

Complete step-by-step guide to configure all Azure DevOps webhooks.

---

## Overview

You need to create **4 webhooks** (service hooks) across **2 different endpoints**:

| # | Webhook | Endpoint | Trigger Event | What It Does |
|---|---------|----------|---------------|-------------|
| 1 | Ticket Analyzer | `/api/devops-webhook` | Work item created | AI grades ticket quality, posts comment |
| 2 | Time Estimator | `/api/devops-webhook` | Work item updated | AI estimates complexity/time, posts comment |
| 3 | PR Code Review | `/api/pr-review-gateway` | Pull request created | AI reviews code, posts unified review on PR |
| 4 | PR Code Review (updates) | `/api/pr-review-gateway` | Pull request updated | Re-reviews on new pushes |

Plus **1 optional pipeline hook**:

| # | Webhook | Endpoint | Trigger Event | What It Does |
|---|---------|----------|---------------|-------------|
| 5 | Flaky Detective | `/api/flaky-detective/ingest` | Build complete (pipeline) | Tracks flaky Playwright tests over 14 days |

And **2 endpoints that need NO webhooks** (on-demand):

| Endpoint | How to use |
|----------|-----------|
| `GET /api/health` | Hit in browser — no auth needed |
| `GET /api/pw-test` | Hit in browser with function key — manually triggers Playwright test generation for the latest open PR |
| `GET /api/flaky-detective/report` | Hit in browser with function key — shows flaky test dashboard |

---

## Prerequisites

Before starting, confirm these are done:

- [ ] Function App is **deployed and running** in Azure
- [ ] All **Application Settings** are configured in the Azure Portal (the env vars from `local.settings.json`)
- [ ] PAT has permissions: **Work Items: Read & Write**, **Code: Read & Write**, **Build: Read**
- [ ] You have the **Function Keys** for each endpoint (see Step 0)

---

## Step 0 — Get Your Function Keys

Each endpoint with `authLevel: "function"` has its own function key.

1. Go to **Azure Portal** > your Function App (`devops-ai-bot-bindtuning`)
2. Click **Functions** in the left sidebar
3. For each function (`devops-webhook`, `pr-review-gateway`, `flaky-detective`), click on it and go to **Function Keys**
4. Copy the `default` key for each

You will end up with these URLs:

```
WEBHOOK_URL     = https://devops-ai-bot-bindtuning.azurewebsites.net/api/devops-webhook?code=<KEY_1>
PR_REVIEW_URL   = https://devops-ai-bot-bindtuning.azurewebsites.net/api/pr-review-gateway?code=<KEY_2>
FLAKY_INGEST_URL= https://devops-ai-bot-bindtuning.azurewebsites.net/api/flaky-detective/ingest?code=<KEY_3>
HEALTH_URL      = https://devops-ai-bot-bindtuning.azurewebsites.net/api/health
```

### Quick smoke test

Verify the app is alive before creating any hooks:

```bash
# Health check (no auth needed)
curl https://devops-ai-bot-bindtuning.azurewebsites.net/api/health
# Expected: {"status":"healthy","version":"1.0.0","uptime":...,"timestamp":"..."}

# Webhook endpoint reachability test
curl -X POST "<WEBHOOK_URL>" -H "Content-Type: application/json" -d "{}"
# Expected: {"error":"Invalid webhook payload. Missing eventType."}

# PR review endpoint reachability test
curl -X POST "<PR_REVIEW_URL>" -H "Content-Type: application/json" -d "{}"
# Expected: {"error":"Empty request body."} or similar
```

If all three respond, you are ready to proceed.

---

## Webhook 1 — Ticket Analyzer (Work Item Created)

**What it does:** When someone creates a new work item (User Story, Bug, Task, etc.), the AI analyses its quality and posts a comment with a score (1-10), missing information, and suggestions.

### Steps

1. Go to **https://dev.azure.com/bindtuning**
2. Select the project: **BindTuning**
3. Click **Project Settings** (gear icon, bottom-left)
4. In the left sidebar, scroll to **Service hooks**
5. Click **+ Create subscription**
6. Select **Web Hooks** > click **Next**

**Trigger configuration:**

| Setting | Value |
|---------|-------|
| Trigger on this type of event | **Work item created** |
| Area path | `[Any]` (or filter to specific areas) |
| Work item type | `[Any]` (or filter to: User Story, Bug, Task) |

7. Click **Next**

**Action configuration:**

| Setting | Value |
|---------|-------|
| URL | `https://devops-ai-bot-bindtuning.azurewebsites.net/api/devops-webhook?code=<KEY_1>` |
| Resource details to send | **All** |
| Messages to send | **All** |
| Detailed messages to send | **All** |

8. Click **Test** — verify you get a 200 response
9. Click **Finish**

---

## Webhook 2 — Time Estimator (Work Item Updated)

**What it does:** When someone edits a work item's **Title** or **Description**, the AI estimates complexity (low/medium/high), time range (days), and risk level. Changes to other fields (AssignedTo, State, Priority, etc.) are automatically ignored.

### Steps

1. Stay in **Project Settings > Service hooks**
2. Click **+ Create subscription**
3. Select **Web Hooks** > click **Next**

**Trigger configuration:**

| Setting | Value |
|---------|-------|
| Trigger on this type of event | **Work item updated** |
| Area path | `[Any]` |
| Work item type | `[Any]` |

4. Click **Next**

**Action configuration:**

| Setting | Value |
|---------|-------|
| URL | Same as Webhook 1: `https://devops-ai-bot-bindtuning.azurewebsites.net/api/devops-webhook?code=<KEY_1>` |
| Resource details to send | **All** |
| Messages to send | **All** |
| Detailed messages to send | **All** |

5. Click **Test** — verify 200 response
6. Click **Finish**

> **Note:** Both Webhook 1 and 2 use the **same URL**. The bot routes internally based on the `eventType` field in the payload.

---

## Webhook 3 — PR Code Review (Pull Request Created)

**What it does:** When a new PR is created, the bot:
- Classifies all changed files (skip lock files, docs, images, etc.)
- Fetches linked work items for context
- Auto-labels the PR (backend, frontend, large-pr, needs-backlog, etc.)
- Calls AI to review each file for bugs, security issues, null risks
- Scans for accidentally committed secrets/credentials
- Posts a unified review comment with risk score, per-file findings, and a summary
- If the PR targets the `Dev` branch in `BindTuning.AdminApp`, also generates Playwright tests

### Steps

1. Stay in **Project Settings > Service hooks**
2. Click **+ Create subscription**
3. Select **Web Hooks** > click **Next**

**Trigger configuration:**

| Setting | Value |
|---------|-------|
| Trigger on this type of event | **Pull request created** |
| Repository | `[Any]` (or filter to specific repos) |
| Target branch | `[Any]` (or filter to e.g. `main`, `Dev`) |

4. Click **Next**

**Action configuration:**

| Setting | Value |
|---------|-------|
| URL | `https://devops-ai-bot-bindtuning.azurewebsites.net/api/pr-review-gateway?code=<KEY_2>` |
| Resource details to send | **All** |
| Messages to send | **All** |
| Detailed messages to send | **All** |

5. Click **Test** — verify you get a 200 or 202 response
6. Click **Finish**

---

## Webhook 4 — PR Code Review (Pull Request Updated)

**What it does:** Same as Webhook 3, but fires on new pushes to an existing PR. The bot re-reviews and shows a follow-up section comparing resolved, still-open, and new issues since the last review.

### Steps

1. Click **+ Create subscription** again
2. Select **Web Hooks** > click **Next**

**Trigger configuration:**

| Setting | Value |
|---------|-------|
| Trigger on this type of event | **Pull request updated** |
| Repository | Same filter as Webhook 3 |
| Target branch | Same filter as Webhook 3 |
| Change | **Source branch updated** (if the filter is available — otherwise leave as Any) |

> **Important:** The bot automatically ignores non-push PR updates (reviewer added, vote cast, etc.) by checking for the presence of `lastMergeSourceCommit`. So even if Azure fires "updated" for all PR changes, only actual code pushes trigger a review.

3. Click **Next**

**Action configuration:**

| Setting | Value |
|---------|-------|
| URL | Same as Webhook 3: `https://devops-ai-bot-bindtuning.azurewebsites.net/api/pr-review-gateway?code=<KEY_2>` |
| Resource details to send | **All** |
| Messages to send | **All** |
| Detailed messages to send | **All** |

4. Click **Test** — verify response
5. Click **Finish**

> **Note:** Webhooks 3 and 4 use the **same URL**. The bot deduplicates by PR ID + source commit hash, so even if both fire for the same push, only one review is produced.

---

## Webhook 5 (Optional) — Flaky Test Detective (Build Complete)

**What it does:** After a pipeline run completes, the bot fetches all test results, detects flaky tests (same test both passed AND failed in the same run), and stores the data. You can then view a dashboard at `/api/flaky-detective/report`.

### Option A: Service Hook (recommended)

1. Click **+ Create subscription**
2. Select **Web Hooks** > click **Next**

**Trigger configuration:**

| Setting | Value |
|---------|-------|
| Trigger on this type of event | **Build completed** |
| Build pipeline | Select pipeline **#88** (or whichever runs your Playwright tests) |
| Build status | **Succeeded** (or `[Any]` to also track failures) |

3. Click **Next**

**Action configuration:**

| Setting | Value |
|---------|-------|
| URL | `https://devops-ai-bot-bindtuning.azurewebsites.net/api/flaky-detective/ingest?code=<KEY_3>` |
| Resource details to send | **All** |
| Messages to send | **All** |
| Detailed messages to send | **All** |

4. Click **Test** — should return 400 (because the test payload won't have a valid buildId)
5. Click **Finish**

> **Note:** The `ingest` endpoint expects `{ "buildId": 12345 }` in the body. Azure DevOps build-complete payloads include `resource.id` as the build ID. You may need to verify the payload structure — the bot looks for `body.buildId`, so if Azure sends it as `body.resource.id` you'd need a small mapping. Check the first real delivery in the Service Hook history.

### Option B: Pipeline YAML task (alternative)

Add a step at the end of your pipeline YAML to call the ingest endpoint directly:

```yaml
- task: PowerShell@2
  displayName: 'Report to Flaky Detective'
  condition: always()
  inputs:
    targetType: 'inline'
    script: |
      $url = "https://devops-ai-bot-bindtuning.azurewebsites.net/api/flaky-detective/ingest?code=<KEY_3>"
      $body = @{ buildId = "$(Build.BuildId)" } | ConvertTo-Json
      Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json"
```

This is more reliable since you control exactly what `buildId` is sent.

---

## Post-Setup: Verify Everything Works

### Test 1 — Ticket Analyzer
1. Create a new **User Story** in BindTuning with:
   - Title: "Add user password reset functionality"
   - Description: "Users should be able to reset their password via email."
2. Wait 15-30 seconds
3. Check the work item's **Discussion** tab
4. Expected: AI comment with quality score, missing info, suggestions

### Test 2 — Time Estimator
1. Edit that same work item — change the **Title** to add more detail
2. Wait 15-30 seconds
3. Check Discussion again
4. Expected: AI comment with complexity, time estimate, risk level, reasoning

### Test 3 — PR Code Review
1. Create a new branch, make a code change, create a **Pull Request** targeting `main` or `Dev`
2. Wait 30-60 seconds (longer — more API calls involved)
3. Check the PR's **Comments** section
4. Expected: Unified AI review with risk score, per-file comments, linked work items, auto-labels on the PR

### Test 4 — PR Re-review
1. Push a new commit to the same PR branch
2. Wait 30-60 seconds
3. Check PR comments again
4. Expected: Follow-up review showing resolved/still-open/new issues

### Test 5 — Flaky Detective (if configured)
1. Run your Playwright pipeline
2. After it completes, visit: `https://devops-ai-bot-bindtuning.azurewebsites.net/api/flaky-detective/report?code=<KEY_3>`
3. Expected: HTML dashboard showing the build run and any flaky tests detected

### Test 6 — Playwright Test Generation (automatic)
1. Create a PR in the **BindTuning.AdminApp** repo targeting the **Dev** branch
2. Ensure the PR changes Angular component files (`.component.ts`, `.service.ts`, etc.)
3. Wait 60-90 seconds
4. Expected: A "Playwright Test Generation" comment on the PR + tests pushed to `internship/playwright-unit-tests` branch + pipeline #88 triggered

---

## Troubleshooting

| Problem | What to check |
|---------|--------------|
| No comment appears on work item | Check Service Hook **History** tab for delivery status + Azure Function **Monitor > Log stream** |
| 401 Unauthorized in Function logs | PAT expired or wrong — regenerate with Work Items R/W, Code R/W, Build Read |
| 403 from Azure DevOps API | PAT missing required scope — needs Work Items R/W for comments, Code R/W for PR threads |
| 500 Internal Server Error | Check Function App logs — likely missing env var (AI_API_URL, AI_API_KEY, etc.) |
| "AI Temporarily Unavailable" comment | AI API (OpenRouter) was down or rate-limited — check again later |
| Comment on create but not on update | Verify you changed **Title** or **Description** — changes to State/AssignedTo/Priority are intentionally skipped |
| PR review never appears | Check Service Hook delivery — ensure the payload includes `lastMergeSourceCommit.commitId` |
| "Duplicate event skipped" in logs | Normal — the dedup cache prevents reprocessing the same event within 5 min (work items) or 1 hour (PRs) |
| Test notification works but real events don't | The webhook filter (Area path, Work item type, Repository, Branch) doesn't match your actual items |
| Flaky Detective shows empty dashboard | Either no builds have been ingested yet, or the pipeline didn't have test runs |

---

## Quick Reference Card

| Endpoint | Method | Auth | URL |
|----------|--------|------|-----|
| Health | GET | anonymous | `/api/health` |
| Work item webhook | POST | function key | `/api/devops-webhook?code=<KEY>` |
| PR review webhook | POST | function key | `/api/pr-review-gateway?code=<KEY>` |
| Flaky ingest | POST | function key | `/api/flaky-detective/ingest?code=<KEY>` |
| Flaky report (HTML) | GET | function key | `/api/flaky-detective/report?code=<KEY>` |
| Flaky report (JSON) | GET | function key | `/api/flaky-detective/report?code=<KEY>&format=json` |
| Playwright manual trigger | GET | function key | `/api/pw-test?code=<KEY>` |
| Playwright dry run | GET | function key | `/api/pw-test?code=<KEY>&dryRun=true` |

| Service Hook # | Event | Target URL |
|----------------|-------|-----------|
| 1 | Work item created | `/api/devops-webhook` |
| 2 | Work item updated | `/api/devops-webhook` |
| 3 | Pull request created | `/api/pr-review-gateway` |
| 4 | Pull request updated | `/api/pr-review-gateway` |
| 5 (optional) | Build completed | `/api/flaky-detective/ingest` |

---

## Checklist

Copy this to track your progress tomorrow:

```
[ ] Step 0: Get function keys for devops-webhook, pr-review-gateway, flaky-detective
[ ] Step 0: Smoke test — curl health endpoint, get "healthy"
[ ] Step 0: Smoke test — curl webhook endpoint, get "Missing eventType" error
[ ] Webhook 1: Work item created → /api/devops-webhook (Test: create a User Story)
[ ] Webhook 2: Work item updated → /api/devops-webhook (Test: edit Title of a work item)
[ ] Webhook 3: Pull request created → /api/pr-review-gateway (Test: create a PR)
[ ] Webhook 4: Pull request updated → /api/pr-review-gateway (Test: push a commit to PR)
[ ] Webhook 5: Build completed → /api/flaky-detective/ingest (Test: run pipeline, check report)
[ ] Verify: Flaky Detective report loads in browser
[ ] Verify: Playwright test generation works on AdminApp PR targeting Dev
```
