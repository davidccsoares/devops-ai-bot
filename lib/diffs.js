/**
 * Diff algorithms for PR review.
 * Myers diff (optimised) + fallback strategies.
 *
 * Ported from ai-pr-review/src/lib/diffs.js (ESM → CJS).
 * Pure logic — no external dependencies.
 */

const CONTEXT_LINES = 10;

// ─── Myers Diff ─────────────────────────────────────────────────────────────

function myersDiff(oldLines, newLines) {
  const N = oldLines.length;
  const M = newLines.length;

  if (N + M > 20000) {
    return simpleFallbackDiff(oldLines, newLines);
  }

  const MAX = N + M;
  const size = 2 * MAX + 1;
  const vForward = new Int32Array(size);
  const vBackward = new Int32Array(size);

  // eslint-disable-next-line no-unused-vars -- retained for future Myers optimization
  function findMiddleSnake(aStart, aEnd, bStart, bEnd) {
    const n = aEnd - aStart;
    const m = bEnd - bStart;
    if (n === 0 && m === 0) return null;
    if (n === 0) {
      const ops = [];
      for (let j = bStart; j < bEnd; j++) {
        ops.push({ op: "insert", newLine: j + 1, text: newLines[j] });
      }
      return { ops };
    }
    if (m === 0) {
      const ops = [];
      for (let i = aStart; i < aEnd; i++) {
        ops.push({ op: "delete", oldLine: i + 1, text: oldLines[i] });
      }
      return { ops };
    }

    const delta = n - m;
    const odd = (delta & 1) !== 0;
    const midOffset = MAX;

    vForward.fill(0);
    vBackward.fill(0);
    vForward[midOffset + 1] = 0;
    vBackward[midOffset + 1] = 0;

    for (let d = 0; d <= Math.ceil((n + m) / 2); d++) {
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && vForward[midOffset + k - 1] < vForward[midOffset + k + 1])) {
          x = vForward[midOffset + k + 1];
        } else {
          x = vForward[midOffset + k - 1] + 1;
        }
        let y = x - k;
        const x0 = x, y0 = y;
        while (x < n && y < m && oldLines[aStart + x] === newLines[bStart + y]) {
          x++; y++;
        }
        vForward[midOffset + k] = x;
        if (odd && k >= delta - (d - 1) && k <= delta + (d - 1)) {
          if (x + vBackward[midOffset - k + delta] >= n) {
            return { x: aStart + x0, y: bStart + y0, u: aStart + x, v: bStart + y };
          }
        }
      }
      for (let k = -d; k <= d; k += 2) {
        let x;
        if (k === -d || (k !== d && vBackward[midOffset + k - 1] < vBackward[midOffset + k + 1])) {
          x = vBackward[midOffset + k + 1];
        } else {
          x = vBackward[midOffset + k - 1] + 1;
        }
        let y = x - k;
        while (x < n && y < m && oldLines[aEnd - 1 - x] === newLines[bEnd - 1 - y]) {
          x++; y++;
        }
        vBackward[midOffset + k] = x;
        if (!odd && k >= -delta - d && k <= -delta + d) {
          if (x + vForward[midOffset - k + delta] >= n) {
            const snakeX = aEnd - x, snakeY = bEnd - y;
            return {
              x: snakeX, y: snakeY,
              u: aEnd - (x - (x - (aEnd - snakeX - (y - (bEnd - snakeY))))),
              v: bEnd - (y - (y - (bEnd - snakeY))),
            };
          }
        }
      }
    }
    return null;
  }

  function buildDiff(aStart, aEnd, bStart, bEnd) {
    const ops = [];
    if (aStart >= aEnd && bStart >= bEnd) return ops;
    if (aStart >= aEnd) {
      for (let j = bStart; j < bEnd; j++) {
        ops.push({ op: "insert", newLine: j + 1, text: newLines[j] });
      }
      return ops;
    }
    if (bStart >= bEnd) {
      for (let i = aStart; i < aEnd; i++) {
        ops.push({ op: "delete", oldLine: i + 1, text: oldLines[i] });
      }
      return ops;
    }

    let prefix = 0;
    while (aStart + prefix < aEnd && bStart + prefix < bEnd && oldLines[aStart + prefix] === newLines[bStart + prefix]) {
      prefix++;
    }
    let suffix = 0;
    while (aEnd - 1 - suffix > aStart + prefix - 1 && bEnd - 1 - suffix > bStart + prefix - 1 && oldLines[aEnd - 1 - suffix] === newLines[bEnd - 1 - suffix]) {
      suffix++;
    }

    for (let i = 0; i < prefix; i++) {
      ops.push({ op: "equal", oldLine: aStart + i + 1, newLine: bStart + i + 1, text: newLines[bStart + i] });
    }

    const innerAStart = aStart + prefix;
    const innerAEnd = aEnd - suffix;
    const innerBStart = bStart + prefix;
    const innerBEnd = bEnd - suffix;

    if (innerAStart >= innerAEnd) {
      for (let j = innerBStart; j < innerBEnd; j++) {
        ops.push({ op: "insert", newLine: j + 1, text: newLines[j] });
      }
    } else if (innerBStart >= innerBEnd) {
      for (let i = innerAStart; i < innerAEnd; i++) {
        ops.push({ op: "delete", oldLine: i + 1, text: oldLines[i] });
      }
    } else {
      const innerOps = lcsInnerDiff(oldLines, newLines, innerAStart, innerAEnd, innerBStart, innerBEnd);
      ops.push(...innerOps);
    }

    for (let i = 0; i < suffix; i++) {
      ops.push({ op: "equal", oldLine: aEnd - suffix + i + 1, newLine: bEnd - suffix + i + 1, text: newLines[bEnd - suffix + i] });
    }

    return ops;
  }

  return buildDiff(0, N, 0, M);
}

// ─── LCS Inner Diff ─────────────────────────────────────────────────────────

function lcsInnerDiff(oldLines, newLines, aStart, aEnd, bStart, bEnd) {
  const ops = [];
  const newMap = new Map();
  for (let j = bStart; j < bEnd; j++) {
    const line = newLines[j];
    if (!newMap.has(line)) newMap.set(line, []);
    newMap.get(line).push(j);
  }

  let j = bStart;
  for (let i = aStart; i < aEnd; i++) {
    const positions = newMap.get(oldLines[i]);
    if (positions) {
      const match = positions.find(p => p >= j);
      if (match !== undefined) {
        while (j < match) {
          ops.push({ op: "insert", newLine: j + 1, text: newLines[j] });
          j++;
        }
        ops.push({ op: "equal", oldLine: i + 1, newLine: j + 1, text: oldLines[i] });
        j++;
        continue;
      }
    }
    ops.push({ op: "delete", oldLine: i + 1, text: oldLines[i] });
  }
  while (j < bEnd) {
    ops.push({ op: "insert", newLine: j + 1, text: newLines[j] });
    j++;
  }
  return ops;
}

// ─── Simple Fallback Diff ───────────────────────────────────────────────────

function simpleFallbackDiff(oldLines, newLines) {
  const newMap = new Map();
  for (let j = 0; j < newLines.length; j++) {
    const line = newLines[j];
    if (!newMap.has(line)) newMap.set(line, []);
    newMap.get(line).push(j);
  }

  const ops = [];
  let j = 0;
  for (let i = 0; i < oldLines.length; i++) {
    const positions = newMap.get(oldLines[i]);
    if (positions) {
      const match = positions.find(p => p >= j);
      if (match !== undefined) {
        while (j < match) {
          ops.push({ op: "insert", newLine: j + 1, text: newLines[j] });
          j++;
        }
        ops.push({ op: "equal", oldLine: i + 1, newLine: j + 1, text: oldLines[i] });
        j++;
        continue;
      }
    }
    ops.push({ op: "delete", oldLine: i + 1, text: oldLines[i] });
  }
  while (j < newLines.length) {
    ops.push({ op: "insert", newLine: j + 1, text: newLines[j] });
    j++;
  }
  return ops;
}

// ─── computeDiff ────────────────────────────────────────────────────────────

function computeDiff(oldText, newText) {
  const oldLines = (oldText || "").split("\n");
  const newLines = (newText || "").split("\n");

  const ops = myersDiff(oldLines, newLines);
  const changes = ops.filter(op => op.op !== "equal");
  if (changes.length === 0) return { diff: "", changedLines: [] };

  const changeIndices = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].op !== "equal") changeIndices.push(i);
  }

  const hunks = [];
  let hunkStart = changeIndices[0];
  let hunkEnd = changeIndices[0];
  for (let k = 1; k < changeIndices.length; k++) {
    const gapEqualLines = changeIndices[k] - changeIndices[k - 1] - 1;
    if (gapEqualLines > CONTEXT_LINES * 2) {
      hunks.push({ start: hunkStart, end: hunkEnd });
      hunkStart = changeIndices[k];
    }
    hunkEnd = changeIndices[k];
  }
  hunks.push({ start: hunkStart, end: hunkEnd });

  const output = [];
  const changedLines = [];

  for (const hunk of hunks) {
    const ctxStart = Math.max(0, hunk.start - CONTEXT_LINES);
    const ctxEnd = Math.min(ops.length - 1, hunk.end + CONTEXT_LINES);

    let startNewLine = null;
    for (let i = ctxStart; i <= ctxEnd; i++) {
      if (ops[i].newLine) { startNewLine = ops[i].newLine; break; }
      if (ops[i].oldLine && ops[i].op === "delete") { startNewLine = ops[i].oldLine; break; }
    }
    output.push(`@@ line ${startNewLine || "?"} @@`);

    for (let i = ctxStart; i <= ctxEnd; i++) {
      const op = ops[i];
      if (op.op === "equal") {
        output.push(` ${op.newLine}: ${op.text}`);
      } else if (op.op === "delete") {
        output.push(`-${op.oldLine}: ${op.text}`);
      } else if (op.op === "insert") {
        output.push(`+${op.newLine}: ${op.text}`);
        changedLines.push(op.newLine);
      }
    }
    output.push("---");
  }

  return { diff: output.join("\n"), changedLines };
}

// ─── Truncate at Hunk Boundary ──────────────────────────────────────────────

function truncateDiffAtHunkBoundary(diff, maxLen) {
  if (diff.length <= maxLen) return diff;
  const truncated = diff.substring(0, maxLen);
  const lastHunkEnd = truncated.lastIndexOf("\n---\n");
  if (lastHunkEnd > 0) return truncated.substring(0, lastHunkEnd + 4);
  const lastNewline = truncated.lastIndexOf("\n");
  return lastNewline > 0 ? truncated.substring(0, lastNewline) : truncated;
}

module.exports = {
  CONTEXT_LINES,
  computeDiff,
  truncateDiffAtHunkBoundary,
};
