// TikTok production client key is intentionally fixed here so OAuth does not
// break when Vercel environment variables are changed or pasted incorrectly.
// Client keys are identifiers, not client secrets.
const PRODUCTION_CLIENT_KEY = "awqfwxxxuxgj41j2";

function getClientKey(mode) {
  if (mode === "sandbox") {
    const value = process.env.TIKTOK_SANDBOX_CLIENT_KEY;
    return typeof value === "string" ? value.trim() : value;
  }
  return PRODUCTION_CLIENT_KEY;
}

function getClientSecret(mode) {
  const value = mode === "sandbox"
    ? process.env.TIKTOK_SANDBOX_CLIENT_SECRET
    : process.env.TIKTOK_CLIENT_SECRET;
  return typeof value === "string" ? value.trim() : value;
}

module.exports = { PRODUCTION_CLIENT_KEY, getClientKey, getClientSecret };
