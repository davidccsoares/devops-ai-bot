/**
 * Capitalises the first letter of a string.
 *
 * @param {string} str - The input string.
 * @returns {string}     The capitalised string, or the original value if falsy.
 */
function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { capitalize };
