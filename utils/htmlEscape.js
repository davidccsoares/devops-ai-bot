/**
 * Escapes a string for safe embedding inside HTML.
 * Prevents XSS / broken rendering from AI-generated content.
 *
 * @param {string} str - The raw string to escape.
 * @returns {string}     The HTML-safe string.
 */
function escapeHtml(str) {
  if (typeof str !== "string") return String(str);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = { escapeHtml };
