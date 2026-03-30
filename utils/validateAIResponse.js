/**
 * Validates and coerces AI response fields with safe defaults.
 * Rather than throwing on invalid data, each function returns a sanitised value.
 */

/**
 * Coerces a value to a number within [min, max], or returns the fallback.
 *
 * @param {*}      value    - The raw value from AI.
 * @param {number} min      - Minimum allowed value.
 * @param {number} max      - Maximum allowed value.
 * @param {*}      fallback - Value to return if invalid.
 * @returns {number|*}
 */
function coerceNumber(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num) || num < min || num > max) return fallback;
  return num;
}

/**
 * Coerces a value to one of the allowed strings (case-insensitive), or returns the fallback.
 *
 * @param {*}        value   - The raw value from AI.
 * @param {string[]} allowed - Allowed lowercase values.
 * @param {string}   fallback - Value to return if invalid.
 * @returns {string}
 */
function coerceEnum(value, allowed, fallback) {
  if (typeof value !== "string") return fallback;
  const lower = value.toLowerCase().trim();
  return allowed.includes(lower) ? lower : fallback;
}

/**
 * Coerces a value to a non-empty string, or returns the fallback.
 *
 * @param {*}      value    - The raw value from AI.
 * @param {string} fallback - Value to return if invalid/empty.
 * @returns {string}
 */
function coerceString(value, fallback) {
  if (typeof value === "string" && value.trim().length > 0) return value;
  return fallback;
}

/**
 * Coerces a value to an array of non-empty strings.
 * Filters out non-string or empty entries.
 *
 * @param {*} value - The raw value from AI.
 * @returns {string[]}
 */
function coerceStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}

module.exports = { coerceNumber, coerceEnum, coerceString, coerceStringArray };
