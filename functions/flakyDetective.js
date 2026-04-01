/**
 * Flaky Test Detective
 *
 * Ported from ai-pr-review/src/flaky-detective-worker.js.
 * Tracks Playwright test flakiness over a 14-day rolling window.
 */

const { fetchWithRetry } = require("../utils/fetchWithRetry");
const { orgUrl, azureHeaders, retryOpts, AZURE_API_VERSION } = require("../lib/azurePr");
const { kvStore } = require("../lib/kvStore");

const TTL_14_DAYS = 1_209_600;
const MAX_RUNS_INDEX = 100;

// ─── Ingest Build ────────────────────────────────────────────────────────────

async function ingestBuild(buildId, context) {
  const headers = { ...azureHeaders(), "Content-Type": "application/json" };
  const ORG = orgUrl();
  const project = process.env.AZURE_PROJECT || "BindTuning";

  try {
    // 1. List test runs for this build
    const runsUrl = `${ORG}/${project}/_apis/test/runs?buildUri=vstfs:///Build/Build/${buildId}&api-version=${AZURE_API_VERSION}`;
    const runsRes = await fetchWithRetry(runsUrl, { headers }, retryOpts(context, "FlakyDetective"));
    if (!runsRes.ok) { context.log.error(`[FlakyDetective] Failed to fetch test runs: ${runsRes.status}`); return; }

    const runsData = await runsRes.json();
    const testRuns = runsData.value || [];
    if (testRuns.length === 0) { context.log(`[FlakyDetective] No test runs for build ${buildId}`); return; }

    // 2. Fetch all test results
    const resultsBatches = await Promise.allSettled(
      testRuns.map(run => fetchTestResults(ORG, project, run.id, headers, context))
    );
    const allResults = [];
    for (const batch of resultsBatches) {
      if (batch.status === "fulfilled") allResults.push(...batch.value);
    }

    // 3. Detect flaky tests
    const { flakyTests, stats } = detectFlakiness(allResults);
    context.log(`[FlakyDetective] Build ${buildId}: ${stats.total} total, ${stats.passed} passed, ${stats.failed} failed, ${flakyTests.length} flaky`);

    // 4. Store flaky data
    const now = new Date().toISOString();
    for (const flaky of flakyTests) await upsertFlakyTest(flaky, buildId, now);

    // 5. Store run summary
    kvStore.put(`flaky-run:${buildId}`, JSON.stringify({
      date: now, totalTests: stats.total, passed: stats.passed, failed: stats.failed,
      flaky: flakyTests.length, flakyTests: flakyTests.map(f => f.testName), duration: stats.duration,
    }), { expirationTtl: TTL_14_DAYS });

    // 6. Update runs index
    await updateRunsIndex(buildId, now);
    context.log(`[FlakyDetective] Build ${buildId} ingestion complete`);
  } catch (err) {
    context.log.error(`[FlakyDetective] Ingestion error: ${err.message}`);
  }
}

async function fetchTestResults(orgBaseUrl, project, runId, headers, context) {
  const results = [];
  let skip = 0;
  const top = 1000;
  while (true) {
    const url = `${orgBaseUrl}/${project}/_apis/test/runs/${runId}/results?api-version=${AZURE_API_VERSION}&$top=${top}&$skip=${skip}`;
    const res = await fetchWithRetry(url, { headers }, retryOpts(context, "FlakyDetective"));
    if (!res.ok) break;
    const data = await res.json();
    const batch = data.value || [];
    results.push(...batch);
    if (batch.length < top) break;
    skip += top;
  }
  return results;
}

function detectFlakiness(results) {
  const byTestName = new Map();
  for (const r of results) {
    const name = r.automatedTestName || r.testCaseTitle || "Unknown";
    if (!byTestName.has(name)) byTestName.set(name, []);
    byTestName.get(name).push(r);
  }

  const flakyTests = [];
  let totalUniqueTests = 0, passedUnique = 0, failedUnique = 0, totalDuration = 0;

  for (const [testName, attempts] of byTestName) {
    totalUniqueTests++;
    const hasPass = attempts.some(a => a.outcome === "Passed");
    const hasFail = attempts.some(a => a.outcome === "Failed");
    for (const a of attempts) totalDuration += a.durationInMs || 0;

    if (hasPass && hasFail) {
      const failedAttempt = attempts.find(a => a.outcome === "Failed");
      flakyTests.push({ testName, errorMessage: failedAttempt?.errorMessage || "", stackTrace: failedAttempt?.stackTrace || "" });
      passedUnique++;
    } else if (hasPass) passedUnique++;
    else if (hasFail) failedUnique++;
  }

  return { flakyTests, stats: { total: totalUniqueTests, passed: passedUnique, failed: failedUnique, duration: totalDuration } };
}

async function upsertFlakyTest(flaky, buildId, date) {
  const key = `flaky:${flaky.testName}`;
  let existing;
  try { existing = kvStore.get(key, "json"); } catch { existing = null; }

  if (existing) {
    if (!existing.occurrences.some(o => o.buildId === buildId)) {
      existing.occurrences.push({ date, buildId, errorMessage: truncate(flaky.errorMessage, 500) });
      existing.lastSeen = date;
      existing.totalFlakes = existing.occurrences.length;
    }
  } else {
    existing = {
      occurrences: [{ date, buildId, errorMessage: truncate(flaky.errorMessage, 500) }],
      firstSeen: date, lastSeen: date, totalFlakes: 1,
    };
  }
  kvStore.put(key, JSON.stringify(existing), { expirationTtl: TTL_14_DAYS });
}

async function updateRunsIndex(buildId, date) {
  let index;
  try { index = kvStore.get("flaky-runs-index", "json") || []; } catch { index = []; }
  if (!index.some(entry => entry.buildId === buildId)) index.unshift({ buildId, date });
  if (index.length > MAX_RUNS_INDEX) index = index.slice(0, MAX_RUNS_INDEX);
  kvStore.put("flaky-runs-index", JSON.stringify(index), { expirationTtl: TTL_14_DAYS });
}

// ─── Report ──────────────────────────────────────────────────────────────────

async function handleReport(format) {
  let runsIndex;
  try { runsIndex = kvStore.get("flaky-runs-index", "json") || []; } catch { runsIndex = []; }

  const validRuns = runsIndex.map(entry => {
    try { const raw = kvStore.get(`flaky-run:${entry.buildId}`, "json"); return raw ? { buildId: entry.buildId, ...raw } : null; } catch { return null; }
  }).filter(Boolean);

  // List all flaky entries
  const flakyEntries = [];
  const listResult = kvStore.list({ prefix: "flaky:" });
  for (const keyObj of listResult.keys) {
    if (keyObj.name.startsWith("flaky-run") || keyObj.name === "flaky-runs-index") continue;
    try {
      const data = kvStore.get(keyObj.name, "json");
      if (data) flakyEntries.push({ testName: keyObj.name.replace(/^flaky:/, ""), ...data });
    } catch { /* skip */ }
  }
  flakyEntries.sort((a, b) => b.totalFlakes - a.totalFlakes);

  const reportData = {
    generatedAt: new Date().toISOString(),
    totalRuns: validRuns.length,
    totalUniqueFlaky: flakyEntries.length,
    mostFlaky: flakyEntries[0] ? { testName: flakyEntries[0].testName, count: flakyEntries[0].totalFlakes } : null,
    flakyTests: flakyEntries,
    recentRuns: validRuns,
  };

  if (format === "json") return { contentType: "application/json", body: reportData };
  return { contentType: "text/html", body: buildHtml(reportData) };
}

// ─── HTML Report Builder ─────────────────────────────────────────────────────

function buildHtml(data) {
  const { generatedAt, totalRuns, totalUniqueFlaky, mostFlaky, flakyTests, recentRuns } = data;

  const flakyRows = flakyTests.map(f => `
    <tr>
      <td class="test-name" title="${esc(f.testName)}">${esc(shortenTestName(f.testName))}</td>
      <td class="center">${f.totalFlakes}</td>
      <td class="error" title="${esc(f.occurrences?.[f.occurrences.length - 1]?.errorMessage || "")}">${esc(truncate(f.occurrences?.[f.occurrences.length - 1]?.errorMessage || "\u2014", 120))}</td>
      <td class="center">${formatDate(f.firstSeen)}</td>
      <td class="center">${formatDate(f.lastSeen)}</td>
    </tr>`).join("");

  const runRows = recentRuns.map(r => `
    <tr>
      <td class="center">${esc(r.buildId)}</td>
      <td class="center">${formatDate(r.date)}</td>
      <td class="center">${r.totalTests}</td>
      <td class="center passed">${r.passed}</td>
      <td class="center failed">${r.failed}</td>
      <td class="center flaky">${r.flaky}</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flaky Test Detective</title>
<style>
  :root{--bg:#f8f9fa;--surface:#fff;--text:#1a1a2e;--text-secondary:#6c757d;--border:#dee2e6;--accent:#4361ee;--passed-bg:#d4edda;--passed-text:#155724;--failed-bg:#f8d7da;--failed-text:#721c24;--flaky-bg:#fff3cd;--flaky-text:#856404;--card-shadow:0 2px 8px rgba(0,0,0,.08)}@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--surface:#161b22;--text:#e6edf3;--text-secondary:#8b949e;--border:#30363d;--accent:#58a6ff;--passed-text:#3fb950;--failed-text:#f85149;--flaky-text:#e3b341;--card-shadow:0 2px 8px rgba(0,0,0,.3)}}*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;padding:2rem;max-width:1200px;margin:0 auto}h1{font-size:1.8rem;margin-bottom:.25rem}.subtitle{color:var(--text-secondary);font-size:.9rem;margin-bottom:2rem}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem;margin-bottom:2rem}.card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:1.25rem;box-shadow:var(--card-shadow)}.card .label{font-size:.8rem;color:var(--text-secondary);text-transform:uppercase;letter-spacing:.05em}.card .value{font-size:1.8rem;font-weight:700;margin-top:.25rem}.card .detail{font-size:.8rem;color:var(--text-secondary);margin-top:.25rem;word-break:break-all}h2{font-size:1.3rem;margin:2rem 0 1rem}.table-wrap{overflow-x:auto;margin-bottom:2rem}table{width:100%;border-collapse:collapse;background:var(--surface);border-radius:8px;overflow:hidden;box-shadow:var(--card-shadow)}th{background:var(--border);padding:.75rem 1rem;text-align:left;font-size:.8rem;text-transform:uppercase;color:var(--text-secondary)}td{padding:.6rem 1rem;border-top:1px solid var(--border);font-size:.875rem}.center{text-align:center}.test-name{max-width:400px;word-break:break-all;font-family:'SF Mono',Consolas,monospace;font-size:.8rem}.error{max-width:300px;font-size:.8rem;color:var(--failed-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.passed{color:var(--passed-text);font-weight:600}.failed{color:var(--failed-text);font-weight:600}.flaky{color:var(--flaky-text);font-weight:600}.empty{text-align:center;padding:3rem;color:var(--text-secondary)}footer{text-align:center;color:var(--text-secondary);font-size:.8rem;margin-top:3rem;padding-top:1rem;border-top:1px solid var(--border)}tr:hover{background:color-mix(in srgb,var(--accent) 5%,transparent)}
</style>
</head>
<body>
  <h1>&#128269; Flaky Test Detective</h1>
  <p class="subtitle">Last updated: ${formatDate(generatedAt)} &bull; <a href="?format=json" style="color:var(--accent)">JSON</a></p>
  <div class="cards">
    <div class="card"><div class="label">Runs Analyzed (14d)</div><div class="value">${totalRuns}</div></div>
    <div class="card"><div class="label">Unique Flaky Tests</div><div class="value flaky">${totalUniqueFlaky}</div></div>
    <div class="card"><div class="label">Most Flaky Test</div><div class="value flaky">${mostFlaky ? mostFlaky.count + "x" : "\u2014"}</div><div class="detail">${mostFlaky ? esc(shortenTestName(mostFlaky.testName)) : "No flaky tests detected"}</div></div>
  </div>
  <h2>Flaky Tests</h2>
  <div class="table-wrap">
  ${flakyTests.length === 0 ? '<div class="empty">No flaky tests detected in the last 14 days. &#127881;</div>' : `<table><thead><tr><th>Test Name</th><th>Flake Count</th><th>Last Error</th><th>First Seen</th><th>Last Seen</th></tr></thead><tbody>${flakyRows}</tbody></table>`}
  </div>
  <h2>Recent Pipeline Runs</h2>
  <div class="table-wrap">
  ${recentRuns.length === 0 ? '<div class="empty">No runs ingested yet.</div>' : `<table><thead><tr><th>Build ID</th><th>Date</th><th>Total</th><th>Passed</th><th>Failed</th><th>Flaky</th></tr></thead><tbody>${runRows}</tbody></table>`}
  </div>
  <footer>Data retained for 14 days &bull; Powered by Azure Functions</footer>
</body></html>`;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function truncate(str, max) { if (!str) return ""; return str.length > max ? str.slice(0, max) + "\u2026" : str; }
function esc(str) { if (!str) return ""; return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function shortenTestName(name) { if (!name) return ""; const m = name.match(/([^.> ]*\.(?:spec|test)\.[^>]+>.*)/); if (m) return m[1].trim(); if (name.length > 80) return "\u2026" + name.slice(-79); return name; }
function formatDate(isoStr) { if (!isoStr) return "\u2014"; try { const d = new Date(isoStr); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return isoStr; } }

module.exports = {
  ingestBuild,
  handleReport,
  detectFlakiness,
  upsertFlakyTest,
  updateRunsIndex,
};
