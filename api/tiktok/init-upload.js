const crypto = require("crypto");
const { getToken, updateRefreshedToken } = require("../../lib/tiktok-store");

function timingSafeEqualText(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function getAutomationKey(req) {
  return req.headers["x-tiktok-automation-key"] || req.headers["x-api-key"] || "";
}

function getMode(req, body) {
  return (body?.mode || req.headers["x-tiktok-mode"] || "sandbox") === "production" ? "production" : "sandbox";
}

function config(mode) {
  return mode === "production"
    ? { clientKey: process.env.TIKTOK_CLIENT_KEY, clientSecret: process.env.TIKTOK_CLIENT_SECRET }
    : { clientKey: process.env.TIKTOK_SANDBOX_CLIENT_KEY, clientSecret: process.env.TIKTOK_SANDBOX_CLIENT_SECRET };
}

async function getFreshAccessToken(mode) {
  const cfg = config(mode);
  if (!cfg.clientKey || !cfg.clientSecret) throw new Error(`TikTok ${mode} client credentials are missing.`);
  const stored = await getToken(mode, cfg.clientSecret);
  if (!stored) throw new Error(`TikTok ${mode} is not connected yet.`);
  if (stored.accessExpiresAt > Date.now() + 5 * 60 * 1000) return stored.accessToken;

  const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({
      client_key: cfg.clientKey,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    }).toString(),
  });
  const data = await response.json();
  if (!response.ok || data.error || !data.access_token) throw new Error(data.error_description || data.error || "TikTok access token refresh failed.");
  await updateRefreshedToken({
    mode,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || stored.refreshToken,
    expiresIn: Number(data.expires_in || 86400),
    secret: cfg.clientSecret,
  });
  return data.access_token;
}

async function creatorInfo(accessToken) {
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/creator_info/query/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  return { response, data: await response.json() };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method Not Allowed" });
  const automationKey = process.env.TIKTOK_AUTOMATION_KEY;
  if (!automationKey) return res.status(500).json({ success: false, message: "TIKTOK_AUTOMATION_KEY is not configured." });
  if (!timingSafeEqualText(getAutomationKey(req), automationKey)) return res.status(401).json({ success: false, message: "Invalid automation key." });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const mode = getMode(req, body);

  try {
    if (body.consent !== true) return res.status(400).json({ success: false, message: "consent must be true." });
    if (!body.title) return res.status(400).json({ success: false, message: "Missing title." });

    const accessToken = await getFreshAccessToken(mode);
    const creatorResult = await creatorInfo(accessToken);
    if (!creatorResult.response.ok || creatorResult.data.error?.code !== "ok") {
      return res.status(creatorResult.response.status || 400).json({ success: false, message: "TikTok Creator Info failed.", error: creatorResult.data });
    }
    const creator = creatorResult.data.data || {};
    const privacy = String(body.privacy_level || "SELF_ONLY");
    const options = creator.privacy_level_options || [];
    if (!options.includes(privacy)) return res.status(400).json({ success: false, message: "privacy_level is not allowed by TikTok.", privacy_level_options: options });

    const initResponse = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify({
        post_info: {
          title: String(body.title).slice(0, 2200),
          privacy_level: privacy,
          disable_duet: creator.duet_disabled === true,
          disable_comment: creator.comment_disabled === true,
          disable_stitch: creator.stitch_disabled === true,
          is_aigc: body.is_aigc !== false,
          brand_content_toggle: false,
          brand_organic_toggle: false,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: Number(body.video_size),
          chunk_size: Number(body.video_size),
          total_chunk_count: 1,
        },
      }),
    });
    const initData = await initResponse.json();
    if (!initResponse.ok || initData.error?.code !== "ok" || !initData.data?.upload_url) {
      return res.status(initResponse.status || 400).json({ success: false, message: "TikTok Direct Post initialization failed.", error: initData });
    }
    return res.status(200).json({
      success: true,
      mode,
      publish_id: initData.data.publish_id,
      upload_url: initData.data.upload_url,
      privacy_level: privacy,
      transfer_method: "FILE_UPLOAD",
    });
  } catch (error) {
    console.error("TikTok init-upload error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "TikTok init-upload server error." });
  }
};
