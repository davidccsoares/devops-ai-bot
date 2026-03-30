/**
 * Sanitises user-provided text before embedding it in an AI prompt.
 *
 * This module provides a lightweight defence against prompt-injection attacks.
 * It is NOT a perfect solution — prompt injection is an open research problem —
 * but it raises the bar significantly by:
 *
 * 1. Trimming and length-capping input to prevent payload bloat.
 * 2. Wrapping user text inside clear delimiters so the AI can distinguish
 *    trusted instructions from user-supplied data.
 */

/** Maximum characters allowed for a single input field. */
const MAX_INPUT_LENGTH = 10000;

/**
 * Trims, length-caps, and wraps a user-supplied string with delimiters
 * so the AI model can distinguish data from instructions.
 *
 * @param {string} value     - The raw user input (title, description, etc.).
 * @param {string} fieldName - A human-readable label (used inside the delimiter).
 * @returns {string}
 */
function sanitizeInput(value, fieldName) {
  if (typeof value !== "string") return "";
  let clean = value.trim();
  if (clean.length === 0) return "";
  if (clean.length > MAX_INPUT_LENGTH) {
    clean = clean.slice(0, MAX_INPUT_LENGTH) + "… [truncated]";
  }
  return `<user-data field="${fieldName}">\n${clean}\n</user-data>`;
}

module.exports = { sanitizeInput, MAX_INPUT_LENGTH };
