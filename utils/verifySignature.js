const crypto = require("node:crypto");

/**
 * Validates an Azure DevOps webhook request using a shared secret (HMAC-SHA256).
 *
 * When the `WEBHOOK_SECRET` environment variable is set, this function verifies
 * that the request body matches the signature sent via the `X-Hub-Signature`
 * header (format: `sha256=<hex>`).
 *
 * If `WEBHOOK_SECRET` is not set, validation is skipped (backwards-compatible).
 *
 * @param {object}       req     - The Azure Function request object.
 * @param {string|null}  secret  - The shared secret, or null/undefined to skip.
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyWebhookSignature(req, secret) {
  if (!secret) {
    return { valid: true }; // No secret configured — skip validation
  }

  const signature = req.headers?.["x-hub-signature"];
  if (!signature) {
    return { valid: false, reason: "Missing X-Hub-Signature header." };
  }

  // Expect format: sha256=<hex>
  const parts = signature.split("=");
  if (parts.length !== 2 || parts[0] !== "sha256") {
    return { valid: false, reason: "Invalid signature format. Expected sha256=<hex>." };
  }

  const receivedHex = parts[1];

  // Compute expected HMAC
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  const receivedBuf = Buffer.from(receivedHex, "hex");
  const expectedBuf = Buffer.from(expectedHex, "hex");

  if (receivedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(receivedBuf, expectedBuf)) {
    return { valid: false, reason: "Signature mismatch." };
  }

  return { valid: true };
}

module.exports = { verifyWebhookSignature };
