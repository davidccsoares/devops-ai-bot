const fetch = require("node-fetch");

const AI_API_URL = process.env.AI_API_URL;
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || "mistralai/mistral-7b-instruct:free";

/**
 * Sends a prompt to the AI API and returns the parsed JSON response.
 *
 * @param {string} systemPrompt - The system-level instruction for the AI.
 * @param {string} userMessage  - The user-level message containing data to analyse.
 * @param {object} context      - Azure Function context for logging.
 * @returns {object}              Parsed JSON from the AI response.
 */
async function callAI(systemPrompt, userMessage, context) {
  if (!AI_API_URL || !AI_API_KEY) {
    throw new Error(
      "AI_API_URL and AI_API_KEY environment variables must be set."
    );
  }

  context.log("Calling AI service...");

  const payload = {
    model: AI_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  };

  const response = await fetch(AI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    context.log.error(`AI API error ${response.status}: ${errorBody}`);
    throw new Error(`AI API returned status ${response.status}.`);
  }

  const data = await response.json();

  const rawContent =
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content;

  if (!rawContent) {
    throw new Error("AI response did not contain any content.");
  }

  context.log("AI response received. Parsing JSON...");

  return parseAIResponse(rawContent, context);
}

/**
 * Attempts to parse the AI response as JSON.
 * Falls back to wrapping the raw text if parsing fails.
 */
function parseAIResponse(raw, context) {
  // The model may wrap JSON inside ```json ... ``` fences - strip them.
  let cleaned = raw.trim();

  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    context.log.warn(
      "AI response is not valid JSON. Returning raw text wrapped in an object."
    );
    return { rawResponse: raw };
  }
}

module.exports = { callAI };
