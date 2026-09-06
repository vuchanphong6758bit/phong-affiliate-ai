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
  if (!stored) throw new Error(`TikTok ${mode} is not connected yet. Open /api/tiktok/auth?mode=${mode} once to authorize the account.`);

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
  if (!response.ok || data.error || !data.access_token) {
    throw new Error(data.error_description || data.error || "TikTok access token refresh failed.");
  }

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

function toOwnedVideoUrl(rawUrl) {
  const parsed = new URL(String(rawUrl));
  const allowedHosts = ["backblazeb2.com", "f002.backblazeb2.com"];
  const isBackblaze = allowedHosts.some(
    (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
  );
  if (!isBackblaze) return parsed.toString();
  return `https://phong-affiliate-ai.vercel.app/api/tiktok/media?url=${encodeURIComponent(parsed.toString())}`;
}

async function initPost(accessToken, body) {
  if (!body.video_url) return { ok: false, status: 400, message: "Thiếu video_url." };

  let videoUrl;
  try {
    videoUrl = toOwnedVideoUrl(body.video_url);
  } catch {
    return { ok: false, status: 400, message: "video_url không hợp lệ." };
  }

  if (!videoUrl.startsWith("https://")) return { ok: false, status: 400, message: "video_url phải sử dụng HTTPS." };
  if (body.consent !== true) return { ok: false, status: 400, message: "consent phải là true." };

  const info = await creatorInfo(accessToken);
  if (!info.response.ok || info.data.error?.code !== "ok") return { ok: false, status: info.response.status || 400, data: info.data, message: "TikTok Creator Info failed." };

  const creator = info.data.data || {};
  const options = creator.privacy_level_options || [];
  if (!body.privacy_level || !options.includes(body.privacy_level)) {
    return { ok: false, status: 400, message: "privacy_level không nằm trong danh sách TikTok cho phép.", privacy_level_options: options };
  }

  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      post_info: {
        title: String(body.title || "").slice(0, 2200),
        privacy_level: body.privacy_level,
        disable_duet: creator.duet_disabled === true,
        disable_comment: creator.comment_disabled === true,
        disable_stitch: creator.stitch_disabled === true,
        is_aigc: body.is_aigc === true,
        brand_content_toggle: false,
        brand_organic_toggle: false,
      },
      source_info: { source: "PULL_FROM_URL", video_url: videoUrl },
    }),
  });
  const data = await response.json();
  if (!response.ok || data.error?.code !== "ok") return { ok: false, status: response.status || 400, data, message: "TikTok Direct Post initialization failed." };
  return { ok: true, data: { publish_id: data.data?.publish_id, privacy_level: body.privacy_level, video_url: videoUrl } };
}

async function fetchStatus(accessToken, publishId) {
  const response = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ publish_id: publishId }),
  });
  return { response, data: await response.json() };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ success: false, message: "Method Not Allowed" });

  const automationKey = process.env.TIKTOK_AUTOMATION_KEY;
  if (!automationKey) return res.status(500).json({ success: false, message: "TIKTOK_AUTOMATION_KEY is not configured in Vercel." });
  if (!timingSafeEqualText(getAutomationKey(req), automationKey)) return res.status(401).json({ success: false, message: "Invalid automation key." });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const mode = getMode(req, body);

  try {
    const accessToken = await getFreshAccessToken(mode);

    if (body.action === "status") {
      if (!body.publish_id) return res.status(400).json({ success: false, message: "Thiếu publish_id." });
      const result = await fetchStatus(accessToken, body.publish_id);
      if (!result.response.ok || result.data.error?.code !== "ok") return res.status(result.response.status || 400).json({ success: false, message: "Không lấy được trạng thái TikTok.", error: result.data });
      return res.status(200).json({ success: true, mode, publish_id: body.publish_id, status: result.data.data?.status, fail_reason: result.data.data?.fail_reason || null, publicly_available_post_id: result.data.data?.publicaly_available_post_id || [], data: result.data.data });
    }

    const result = await initPost(accessToken, body);
    if (!result.ok) return res.status(result.status || 400).json({ success: false, message: result.message, error: result.data || null, privacy_level_options: result.privacy_level_options });
    return res.status(200).json({ success: true, mode, publish_id: result.data.publish_id, privacy_level: result.data.privacy_level, video_url: result.data.video_url });
  } catch (error) {
    console.error("TikTok automation error:", error.message);
    return res.status(500).json({ success: false, message: error.message || "TikTok automation server error." });
  }
};
