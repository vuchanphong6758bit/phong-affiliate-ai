// TikTok credentials must come from Vercel environment variables.
// Do not hardcode the production client key in source code.
const PRODUCTION_CLIENT_KEY = String(process.env.TIKTOK_CLIENT_KEY || "").trim();

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

function getRedirectUri() {
  const value = process.env.TIKTOK_REDIRECT_URI;
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "https://phong-affiliate-ai.vercel.app/api/tiktok/callback";
}

module.exports = { PRODUCTION_CLIENT_KEY, getClientKey, getClientSecret, getRedirectUri };
