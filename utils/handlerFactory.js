const { callAI } = require("../services/aiService");

/**
 * Creates a webhook handler function from a configuration object.
 *
 * This eliminates the duplicated extract → prompt → AI → format → post pattern
 * across all feature handlers.
 *
 * @param {object} config
 * @param {string}   config.name            - Handler name for logging and response (e.g. "ticketAnalyzer").
 * @param {Function} config.extract         - (payload) => extracted data object.
 * @param {Function} config.logExtracted    - (data, context) => void — logs the extracted data.
 * @param {object}   config.promptModule    - Must export getSystemPrompt() and buildUserMessage(data).
 * @param {Function} config.formatComment   - (aiResult) => string — formats AI output for posting.
 * @param {Function} config.postComment     - (data, comment, context) => Promise — posts the comment.
 * @param {Function} config.buildResult     - (data, aiResult) => object — builds the return value.
 * @returns {Function} async (payload, context) => result
 */
function createHandler(config) {
  const {
    name,
    extract,
    logExtracted,
    promptModule,
    formatComment,
    postComment,
    buildResult,
  } = config;

  return async function handler(payload, context) {
    context.log(`${name} - Start.`);

    // 1. Extract data from the webhook payload.
    const data = extract(payload);
    logExtracted(data, context);

    // 2. Build prompts and call the AI service.
    const systemPrompt = promptModule.getSystemPrompt();
    const userMessage = promptModule.buildUserMessage(data);
    const aiResult = await callAI(systemPrompt, userMessage, context);

    context.log(`${name} - AI processing complete.`);

    // 3. Format and post the comment.
    const comment = formatComment(aiResult);
    await postComment(data, comment, context);

    return buildResult(data, aiResult);
  };
}

module.exports = { createHandler };
